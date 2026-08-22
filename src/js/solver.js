/* =========================================================
 * フリーセル ソルバー (純粋探索エンジン)
 * DOM・時刻表示・乱数には触れない。盤面はカード id (0〜51) の配列で受け取る。
 *   id % 4 = スート (0=♣, 1=♦, 2=♥, 3=♠)、Math.floor(id / 4) + 1 = ランク。
 * アルゴリズム:
 *   IDA* (反復深化 A*) + 自動ホーム + 置換表 (Zobrist ハッシュ 64bit)。
 * ホーム(土台)への移動は常に安全なため、分岐としてではなく決定的な
 * 「自動ホーム」として必ず適用する(状態空間を大幅に削減する)。
 * ========================================================= */

import { SUITS, RANKS } from "./constants.js";

const NUM_FREE = 4;
const NUM_CASCADES = 8;
const NUM_HOME = 4;
const MAX_COL_LEN = 19; // 列の最大長(実際は 13 で十分だが余裕を持つ)

/** UI とベンチマークで共有する探索モード設定。呼び出し側で直接変更しない。 */
export const SOLVER_PROFILES = Object.freeze({
  fast: Object.freeze({
    maxNodes: 1_000_000,
    maxTimeMs: 30_000,
    safeFoundationMoves: false,
    allowUnsolvable: false,
  }),
  // fast + safe の二本構成。旧 safe(10M/w1.1)+safe2(2M/w1.5)を統合し、
  // 単一探索内で tailStart 重みを段階的に上げる(案B)。
  // 固定 w1.1 は #10353/#13331 が、固定 w1.5 は #17978 が解けないため、
  // 適応スケジュールで全難関を 10M 以内でカバーする。
  safe: Object.freeze({
    maxNodes: 10_000_000,
    maxTimeMs: 180_000,
    safeFoundationMoves: true,
    allowUnsolvable: true,
    disableReversePruning: false,
    tailStartWeight: 1.2,
    tailStartWeightMax: 1.5,
    adaptiveWeight: true,
  }),
});

/** カード id からランク(1〜13)とスート(0〜3)を得る */
const rankOf = (id) => (id >> 2) + 1;
const suitOf = (id) => id & 3;
const isRed = (id) => (id & 3) === 1 || (id & 3) === 2;

/* =========================================================
 * 手のパック表現 (32bit 整数)
 *
 * 探索のホットパスで毎回 move オブジェクト { cardId, fromZone, ... } を生成
 * すると GC 圧迫の要因になるため、手を 32bit 整数にパックして扱う (フェーズB)。
 * 探索終了時にオブジェクト形式へアンパックして返す。
 *
 * bit 割り当て:
 *   [5:0]   cardId     (0..51)
 *   [7:6]   fromZone   (0=free, 1=cascade, 2=home)
 *   [10:8]  fromIndex  (0..7)
 *   [12:11] destZone   (0=free, 1=cascade, 2=home)
 *   [15:13] destIndex  (0..7)
 *   [20:16] count      (1..19)
 * ========================================================= */
const ZONE_FREE = 0;
const ZONE_CASCADE = 1;
const ZONE_HOME = 2;
const ZONE_NAMES = ["free", "cascade", "home"];

const MV_CARD_SHIFT = 0;
const MV_CARD_MASK = 0x3f;
const MV_FROM_ZONE_SHIFT = 6;
const MV_FROM_ZONE_MASK = 0x3;
const MV_FROM_INDEX_SHIFT = 8;
const MV_FROM_INDEX_MASK = 0x7;
const MV_DEST_ZONE_SHIFT = 11;
const MV_DEST_ZONE_MASK = 0x3;
const MV_DEST_INDEX_SHIFT = 13;
const MV_DEST_INDEX_MASK = 0x7;
const MV_COUNT_SHIFT = 16;
const MV_COUNT_MASK = 0x1f;

const packMove = (cardId, fromZone, fromIndex, destZone, destIndex, count) =>
  cardId
  | (fromZone << MV_FROM_ZONE_SHIFT)
  | (fromIndex << MV_FROM_INDEX_SHIFT)
  | (destZone << MV_DEST_ZONE_SHIFT)
  | (destIndex << MV_DEST_INDEX_SHIFT)
  | (count << MV_COUNT_SHIFT);
const mvCardId = (mv) => mv & MV_CARD_MASK;
const mvFromZone = (mv) => (mv >> MV_FROM_ZONE_SHIFT) & MV_FROM_ZONE_MASK;
const mvFromIndex = (mv) => (mv >> MV_FROM_INDEX_SHIFT) & MV_FROM_INDEX_MASK;
const mvDestZone = (mv) => (mv >> MV_DEST_ZONE_SHIFT) & MV_DEST_ZONE_MASK;
const mvDestIndex = (mv) => (mv >> MV_DEST_INDEX_SHIFT) & MV_DEST_INDEX_MASK;
const mvCount = (mv) => (mv >> MV_COUNT_SHIFT) & MV_COUNT_MASK;

/** パック済みの手を外部向けオブジェクト形式へ変換する */
const unpackMove = (mv) => ({
  cardId: mvCardId(mv),
  fromZone: ZONE_NAMES[mvFromZone(mv)],
  fromIndex: mvFromIndex(mv),
  destZone: ZONE_NAMES[mvDestZone(mv)],
  destIndex: mvDestIndex(mv),
  count: mvCount(mv),
});

/**
 * Horne's Rule に基づき、カードを土台へ送って安全か判定する。
 *
 * カードを土台へ送ると、そのカードは tableau の受け皿として使えなくなる。
 * 反対色の両スートが rank - 2 まで進んでいれば、rank のカードを失っても
 * それらのカードを受け皿として必要とする局面は生じない。A は常に安全である。
 * foundationRanks は各スートの現在の先頭ランク(0〜13)を受け取る。
 */
export function isSafeFoundationMove(cardId, foundationRanks) {
  const rank = rankOf(cardId);
  if (rank <= 1) {
    return true;
  }
  const oppositeRanks = [];
  for (let otherSuit = 0; otherSuit < NUM_HOME; otherSuit++) {
    if (isRed(cardId) === (otherSuit === 1 || otherSuit === 2)) {
      continue;
    }
    oppositeRanks.push(foundationRanks[otherSuit] ?? 0);
  }
  return rank <= Math.min(...oppositeRanks) + 1;
}

/** search() の戻り値用の特殊値 */
const FOUND = -1;
const INF = 0x7fffffff;

/* =========================================================
 * Zobrist ハッシュ (64bit = 32bit × 2)
 * ========================================================= */

// 列の順序だけを正規化するため、列ごとのハッシュを計算してからソートして
// 状態キーへ結合する。全列のカードを位置ごとに XOR するだけでは列の境界を
// 失い、異なる列構成まで同一状態として扱ってしまうため、この方式を使う。
const COL_SIZE = MAX_COL_LEN * 52;
const FOUND_BASE = COL_SIZE;
const FREE_BASE = FOUND_BASE + NUM_HOME * 14;
const TOTAL_KEYS = FREE_BASE + 52;

const zColIndex = (pos, card) => pos * 52 + card;
const zFoundIndex = (suit, rank) => FOUND_BASE + suit * 14 + rank;
const zFreeIndex = (card) => FREE_BASE + card;

/** 列の順序だけを無視した正規化結果(テスト用)。列境界と列内順序は保持する。 */
export function canonicalizeColumns(cascades) {
  return (cascades ?? [])
    .map((pile) => [...pile])
    .sort((a, b) => {
      const lengthDiff = a.length - b.length;
      if (lengthDiff !== 0) {
        return lengthDiff;
      }
      for (let i = 0; i < a.length; i++) {
        const cardDiff = a[i] - b[i];
        if (cardDiff !== 0) {
          return cardDiff;
        }
      }
      return 0;
    });
}

/** 決定的な 32bit 乱数列を生成する(splitmix32)。ハッシュ値の再現性のため */
function splitmix32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

function buildZobristTables() {
  const z1 = new Uint32Array(TOTAL_KEYS);
  const z2 = new Uint32Array(TOTAL_KEYS);
  const r1 = splitmix32(0x1234abcd);
  const r2 = splitmix32(0x9e3779b9);
  for (let i = 0; i < TOTAL_KEYS; i++) {
    z1[i] = r1();
    z2[i] = r2();
  }
  return { z1, z2 };
}

/* =========================================================
 * 置換表 (オープンアドレス法 + 線形探索)
 * ========================================================= */

function createTranspositionTable(capacityBits = 22) {
  const size = 1 << capacityBits;
  const h1 = new Uint32Array(size);
  const h2 = new Uint32Array(size);
  const g = new Int32Array(size);
  g.fill(-1); // -1 = 空
  const MAX_PROBE = 40;
  let probes = 0;
  let maxProbe = 0;
  let overwrites = 0;
  let used = 0; // 使用中スロット数 (stats() で配列を全走査しないためのカウンタ)
  return {
    /** 64bit Zobrist ハッシュが一致すれば同一状態として扱う。 */
    lookup(k1, k2) {
      let i = k1 & (size - 1);
      for (let n = 0; n < MAX_PROBE; n++) {
        probes++;
        maxProbe = Math.max(maxProbe, n + 1);
        const gh = g[i];
        if (gh === -1) {
          return -1;
        }
        if (h1[i] === k1 && h2[i] === k2) {
          return gh;
        }
        i = (i + 1) & (size - 1);
      }
      return -1;
    },
    /** g を記録する(同じ鍵なら小さい方を保持) */
    store(k1, k2, gg) {
      let i = k1 & (size - 1);
      for (let n = 0; n < MAX_PROBE; n++) {
        probes++;
        maxProbe = Math.max(maxProbe, n + 1);
        const gh = g[i];
        if (gh === -1) {
          h1[i] = k1;
          h2[i] = k2;
          g[i] = gg;
          used++;
          return;
        }
        if (h1[i] === k1 && h2[i] === k2) {
          if (gg < gh) {
            g[i] = gg;
          }
          return;
        }
        i = (i + 1) & (size - 1);
      }
      // 満杯に近い場合はプローブ窓内で最も g が大きい (= 枝刈り価値が低い) エントリを
      // 置き換える (フェーズC)。候補の g がその最大 g 以上なら挿入しない (浅い
      // エントリを保護)。置換方針は枝刈り効率にのみ影響し、安全性には影響しない。
      // 窓内は全て埋まっているため、空きスロットの考慮は不要。
      const start = k1 & (size - 1);
      let worstI = start;
      let worstG = g[start];
      for (let n = 1; n < MAX_PROBE; n++) {
        const idx = (start + n) & (size - 1);
        if (g[idx] > worstG) {
          worstG = g[idx];
          worstI = idx;
        }
      }
      if (gg < worstG) {
        overwrites++;
        h1[worstI] = k1;
        h2[worstI] = k2;
        g[worstI] = gg;
      }
    },
    clear() {
      g.fill(-1);
      used = 0;
    },
    stats() {
      return { used, capacity: size, loadFactor: used / size, probes, maxProbe, overwrites };
    },
  };
}

/** 盤面からカード総数(勝利判定の分母)を数える */
function countCards(board) {
  let n = 0;
  for (let i = 0; i < NUM_CASCADES; i++) {
    n += (board.cascades?.[i] ?? []).length;
  }
  for (let f = 0; f < NUM_FREE; f++) {
    if ((board.freeCells?.[f] ?? null) !== null) {
      n++;
    }
  }
  for (let h = 0; h < NUM_HOME; h++) {
    n += (board.foundations?.[h] ?? []).length;
  }
  return n;
}

/** カード id を表示名 ("♠A" など) に変換する */
export function cardName(id) {
  return SUITS[id & 3] + RANKS[(id >> 2) + 1];
}

/** ソルバーが返す手 (move) を表示用文字列に変換する */
export function formatMove(mv) {
  const c = cardName(mv.cardId);
  let dest;
  if (mv.destZone === "home") {
    dest = "ホーム";
  } else if (mv.destZone === "free") {
    dest = `フリーセル${mv.destIndex + 1}`;
  } else {
    dest = `列${mv.destIndex + 1}`;
  }
  const n = mv.count > 1 ? `(${mv.count}枚)` : "";
  return `${c} → ${dest}${n}`;
}

/**
 * 盤面を解く。
 * @param {{cascades: number[][], freeCells: (number|null)[], foundations: number[][]}} board
 * @param {{maxNodes?: number, maxTimeMs?: number, safeFoundationMoves?: boolean,
 *   disableReversePruning?: boolean, allowUnsolvable?: boolean,
 *   trackCounters?: boolean}} options
 *   `trackCounters: true` のとき、stats.profile に関数別の呼び出し回数
 *   (getStateHash / generateMoves / moveScore / movesGenerated / ttLookup /
 *   ttStore / makeMove / findHomeMove) を記録する (フェーズA のプロファイリング用)。
 * @returns {{solved: boolean, moves: object[], nodes: number, timeMs: number,
 *   status: "solved" | "unsolvable" | "search-exhausted" | "node-limit" | "time-limit"}}
 *   solved=true のとき moves は勝ち手順(初手→終手)。各 move は
 *   { cardId, fromZone, fromIndex, destZone, destIndex, count }。
 *   `unsolvable` は64bit Zobristハッシュの衝突を無視した探索上の解なしであり、
 *   数学的な完全証明ではない。`allowUnsolvable: false` の場合は同じ結果を
 *   `search-exhausted` として返す。
 */
export function solve(board, options = {}) {
  const maxNodes = options.maxNodes ?? 2000000;
  const maxTimeMs = options.maxTimeMs ?? 60000;
  const safeFoundationMoves = options.safeFoundationMoves ?? true;
  const disableReversePruning = options.disableReversePruning ?? false;
  const allowUnsolvable = options.allowUnsolvable ?? true;
  // ヒューリスティックの tailStart 重み。fast は 1.1、safe 改は適応スケジュールで
  // 1.2 → 1.5 へ段階的に上げる(単一探索内で旧 safe(10M/w1.1)+safe2(2M/w1.5)を統合)。
  const tailStartWeight = options.tailStartWeight ?? 1.1;
  const tailStartWeightMax = options.tailStartWeightMax ?? tailStartWeight;
  const adaptiveWeight = !!options.adaptiveWeight;
  // 適応スケジュールは探索進行率で重みを上げる。
  // 10M では 50%/85% (5M/8.5M) で 1.2→1.35→1.5。17978 は w1.2 で 3.35M
  // 必要なため 50% より早く上げない。13331 は w1.2 でも 3.43M で解ける
  // ため、遅めでも解決率に影響しない。
  const adaptiveThreshold1 = Math.floor(maxNodes * 0.5);
  const adaptiveThreshold2 = Math.floor(maxNodes * 0.85);
  let currentTailWeight = tailStartWeight;
  // Date.now() は VirtualBox Guest Additions などによる時刻補正で逆行し得る。
  // performance.now() は単調増加する経過時間用タイマーなので、探索時間の測定に使う。
  const startedAt = performance.now();

  /* ---------------- 状態(検索中は 1 つの可変状態を使い回す) ---------------- */

  const cols = Array.from({ length: NUM_CASCADES }, () => []);
  const free = new Int8Array(NUM_FREE);
  free.fill(-1);
  const found = new Int8Array(NUM_HOME); // 各スートの土台先頭ランク(0=空)
  let totalHome = 0;

  for (let i = 0; i < NUM_CASCADES; i++) {
    for (const id of board.cascades?.[i] ?? []) {
      cols[i].push(id);
    }
  }
  for (let f = 0; f < NUM_FREE; f++) {
    const id = board.freeCells?.[f] ?? null;
    if (id !== null) {
      free[f] = id;
    }
  }
  for (let h = 0; h < NUM_HOME; h++) {
    for (const id of board.foundations?.[h] ?? []) {
      found[suitOf(id)] = rankOf(id);
      totalHome++;
    }
  }

  const totalCards = countCards(board);
  const path = []; // 初手から現在までの手順(自動ホーム含む)
  const stats = {
    unsafeHomeGenerated: 0,
    unsafeHomeTried: 0,
    unsafeHomeSolved: 0,
    unsafeHomeDeadEnds: 0,
    transpositionHits: 0,
    deadEndNodes: 0,
    maxSearchDepth: 0,
  };

  // プロファイリング用の呼び出し回数カウンタ (trackCounters 時のみ加算)。
  // 探索ノード数が同じでも、関数ごとの呼び出し回数は CPU 時間の分布を
  // 定量化するために有用 (フェーズA)。
  const profileCounters = {
    getStateHash: 0,
    generateMoves: 0,
    moveScore: 0,
    movesGenerated: 0,
    ttLookup: 0,
    ttStore: 0,
    makeMove: 0,
    findHomeMove: 0,
  };
  const track = !!options.trackCounters;

  /* ---------------- Zobrist ハッシュ ---------------- */

  const { z1, z2 } = buildZobristTables();
  const colH1 = new Uint32Array(NUM_CASCADES);
  const colH2 = new Uint32Array(NUM_CASCADES);
  let h1 = 0;
  let h2 = 0;
  const xorCol = (col, pos, card) => {
    const k = zColIndex(pos, card);
    colH1[col] ^= z1[k];
    colH2[col] ^= z2[k];
  };
  const xorFound = (suit, rank) => {
    const k = zFoundIndex(suit, rank);
    h1 ^= z1[k];
    h2 ^= z2[k];
  };
  const xorFree = (card) => {
    const k = zFreeIndex(card);
    h1 ^= z1[k];
    h2 ^= z2[k];
  };

  // 初期盤面のハッシュを計算
  for (let f = 0; f < NUM_FREE; f++) {
    if (free[f] !== -1) {
      xorFree(free[f]);
    }
  }
  for (let s = 0; s < NUM_HOME; s++) {
    if (found[s] !== 0) {
      xorFound(s, found[s]);
    }
  }
  for (let i = 0; i < NUM_CASCADES; i++) {
    for (let p = 0; p < cols[i].length; p++) {
      xorCol(i, p, cols[i][p]);
    }
  }

  // 列の並び替え用の再利用バッファ (毎ノードの Array.from + sort の
  // アロケーションと、sort 比較器コールバックのオーバーヘッドを削減する)。
  // 8列固定なので、毎回 [0..7] に初期化してから安定挿入ソートする。
  const colOrder = new Array(NUM_CASCADES);

  function getStateHash() {
    if (track) {
      profileCounters.getStateHash++;
    }
    for (let i = 0; i < NUM_CASCADES; i++) {
      colOrder[i] = i;
    }
    // colH1 / colH2 の昇順に安定ソート (Array.prototype.sort と同じ順序)。
    // 8列固定のため比較回数は高々 28 回で、比較器の関数呼び出しもない。
    for (let i = 1; i < NUM_CASCADES; i++) {
      const key = colOrder[i];
      const h1i = colH1[key];
      const h2i = colH2[key];
      let j = i - 1;
      while (j >= 0) {
        const cur = colOrder[j];
        if (colH1[cur] < h1i || (colH1[cur] === h1i && colH2[cur] <= h2i)) {
          break;
        }
        colOrder[j + 1] = cur;
        j--;
      }
      colOrder[j + 1] = key;
    }
    let k1 = h1 >>> 0;
    let k2 = h2 >>> 0;
    for (let i = 0; i < NUM_CASCADES; i++) {
      const col = colOrder[i];
      k1 = (Math.imul(k1 ^ colH1[col], 0x9e3779b1) + 0x85ebca6b) >>> 0;
      k2 = (Math.imul(k2 ^ colH2[col], 0xc2b2ae35) + 0x27d4eb2f) >>> 0;
    }
    return [k1, k2];
  }

  /* ---------------- 手の適用 / 取り消し ---------------- */

  function doApply(mv) {
    const cardId = mvCardId(mv);
    const destZone = mvDestZone(mv);
    const fromZone = mvFromZone(mv);
    const fromIndex = mvFromIndex(mv);
    const destIndex = mvDestIndex(mv);
    if (destZone === ZONE_HOME) {
      const suit = suitOf(cardId);
      const rank = rankOf(cardId);
      if (fromZone === ZONE_FREE) {
        free[fromIndex] = -1;
        xorFree(cardId);
      } else {
        cols[fromIndex].pop();
        xorCol(fromIndex, cols[fromIndex].length, cardId);
      }
      xorFound(suit, found[suit]);
      found[suit] = rank;
      xorFound(suit, rank);
      totalHome++;
    } else if (destZone === ZONE_FREE) {
      cols[fromIndex].pop();
      xorCol(fromIndex, cols[fromIndex].length, cardId);
      free[destIndex] = cardId;
      xorFree(cardId);
    } else {
      // destZone === "cascade"
      if (fromZone === ZONE_FREE) {
        free[fromIndex] = -1;
        xorFree(cardId);
        const base = cols[destIndex].length;
        cols[destIndex].push(cardId);
        xorCol(destIndex, base, cardId);
      } else {
        const src = cols[fromIndex];
        const p = src.length - mvCount(mv);
        const tail = src.splice(p);
        const count = mvCount(mv);
        for (let t = 0; t < count; t++) {
          xorCol(fromIndex, p + t, tail[t]);
        }
        const base = cols[destIndex].length;
        for (let t = 0; t < count; t++) {
          cols[destIndex].push(tail[t]);
          xorCol(destIndex, base + t, tail[t]);
        }
      }
    }
  }

  function doUnapply(mv) {
    const cardId = mvCardId(mv);
    const destZone = mvDestZone(mv);
    const fromZone = mvFromZone(mv);
    const fromIndex = mvFromIndex(mv);
    const destIndex = mvDestIndex(mv);
    if (destZone === ZONE_HOME) {
      const suit = suitOf(cardId);
      const rank = rankOf(cardId);
      xorFound(suit, found[suit]);
      found[suit] = rank - 1;
      xorFound(suit, rank - 1);
      totalHome--;
      if (fromZone === ZONE_FREE) {
        free[fromIndex] = cardId;
        xorFree(cardId);
      } else {
        cols[fromIndex].push(cardId);
        xorCol(fromIndex, cols[fromIndex].length - 1, cardId);
      }
    } else if (destZone === ZONE_FREE) {
      free[destIndex] = -1;
      xorFree(cardId);
      cols[fromIndex].push(cardId);
      xorCol(fromIndex, cols[fromIndex].length - 1, cardId);
    } else {
      if (fromZone === ZONE_FREE) {
        cols[destIndex].pop();
        xorCol(destIndex, cols[destIndex].length, cardId);
        free[fromIndex] = cardId;
        xorFree(cardId);
      } else {
        const base = cols[destIndex].length - mvCount(mv);
        const tail = cols[destIndex].splice(base);
        const count = mvCount(mv);
        for (let t = 0; t < count; t++) {
          xorCol(destIndex, base + t, tail[t]);
        }
        const p = cols[fromIndex].length;
        for (let t = 0; t < count; t++) {
          cols[fromIndex].push(tail[t]);
          xorCol(fromIndex, p + t, tail[t]);
        }
      }
    }
  }

  /* ---------------- 手の生成 ---------------- */

  // 移動先ごとの移動可能枚数上限 (generateMoves の冒頭で再計算する)。
  // 手生成中は盤面が不変なので、canPlace 内で毎回空きフリーセル数と空列数を
  // 走査し直さずに済む (フェーズB)。上限の最大値は (4+1) * 2^7 = 640 で
  // Int16Array に収まる。
  const maxMoveByDest = new Int16Array(NUM_CASCADES);

  /** カード群(先頭=最下位カード)を列 dest に置けるか。count は枚数 */
  function canPlace(bottomCard, count, dest) {
    const pile = cols[dest];
    if (pile.length === 0) {
      return count <= maxMoveByDest[dest];
    }
    const top = pile[pile.length - 1];
    if (!(rankOf(top) === rankOf(bottomCard) + 1 && isRed(top) !== isRed(bottomCard))) {
      return false;
    }
    return count <= maxMoveByDest[dest];
  }

  function moveScore(mv) {
    if (track) {
      profileCounters.moveScore++;
    }
    const destZone = mvDestZone(mv);
    const cardId = mvCardId(mv);
    const fromZone = mvFromZone(mv);
    const fromIndex = mvFromIndex(mv);
    const destIndex = mvDestIndex(mv);
    const count = mvCount(mv);
    if (destZone === ZONE_HOME) {
      return 12000 + rankOf(cardId) * 500; // 実験3: ランクが高いホーム移動を優先する
    }
    if (destZone === ZONE_CASCADE) {
      let s = count * 10000;
      if (cols[destIndex].length > 0) {
        // fast(通常ゲーム)では既存列優先を強めると 5.6% 削減。safe改(難関)は
        // tailStart の詰まりを解す空列生成も重要なため、fast のみ加点を上げる。
        s += safeFoundationMoves ? 5000 : 8000;
      }
      if (fromZone === ZONE_CASCADE) {
        const srcLen = cols[fromIndex].length;
        if (count === srcLen) {
          s += 20000; // 移動元が空になる(空き列の価値が高い)
        } else {
          const revealed = cols[fromIndex][srcLen - count - 1];
          const r = rankOf(revealed);
          if (found[suitOf(revealed)] === r - 1) {
            s += 15000; // 露出したカードが自動ホーム対象になる
          } else if (r <= 3) {
            s += 6000; // 低ランクの露出は将来のホーム送りに有効 (フェーズC)
          }
        }
      }
      return s;
    }
    if (destZone === ZONE_FREE) {
      let s = 2000;
      if (fromZone === ZONE_CASCADE) {
        const srcLen = cols[fromIndex].length;
        if (srcLen === 1) {
          s += 20000; // 移動元の列が空になる
        } else {
          const revealed = cols[fromIndex][srcLen - 2];
          const r = rankOf(revealed);
          if (found[suitOf(revealed)] === r - 1) {
            s += 15000; // 露出したカードが自動ホーム対象になる
          } else if (r <= 3) {
            s += 6000; // 低ランクの露出は将来のホーム送りに有効 (フェーズC)
          }
        }
      }
      return s;
    }
    return 0;
  }

  /** 直前の分岐手の逆手なら true(無意味な往復を避ける) */
  function isReverse(mv) {
    if (!prevBranch) {
      return false;
    }
    return (
      mvFromZone(mv) === mvDestZone(prevBranch) &&
      mvFromIndex(mv) === mvDestIndex(prevBranch) &&
      mvDestZone(mv) === mvFromZone(prevBranch) &&
      mvDestIndex(mv) === mvFromIndex(prevBranch) &&
      mvCardId(mv) === mvCardId(prevBranch) &&
      mvCount(mv) === mvCount(prevBranch)
    );
  }

  /** ホームへ送れるカードを 1 枚探す(あれば move、無ければ null) */
  function findHomeMove() {
    if (track) {
      profileCounters.findHomeMove++;
    }
    for (let f = 0; f < NUM_FREE; f++) {
      const c = free[f];
      if (
        c !== -1
        && found[suitOf(c)] === rankOf(c) - 1
        && (!safeFoundationMoves || isSafeFoundationMove(c, found))
      ) {
        return packMove(c, ZONE_FREE, f, ZONE_HOME, suitOf(c), 1);
      }
    }
    for (let i = 0; i < NUM_CASCADES; i++) {
      const len = cols[i].length;
      if (len === 0) {
        continue;
      }
      const c = cols[i][len - 1];
      if (
        found[suitOf(c)] === rankOf(c) - 1
        && (!safeFoundationMoves || isSafeFoundationMove(c, found))
      ) {
        return packMove(c, ZONE_CASCADE, i, ZONE_HOME, suitOf(c), 1);
      }
    }
    return null;
  }

  /** 分岐手を列挙する(ホーム手は含まない。自動ホームで消化済み) */
  function generateMoves() {
    if (track) {
      profileCounters.generateMoves++;
    }
    // 手は 32bit 整数にパックして保持し、スコアは並列配列で管理する
    // (move オブジェクト生成と sort 比較器コールバックを削減、フェーズB)。
    const moves = [];
    const scores = [];

    // 移動可能枚数の上限を移動先ごとに1回だけ計算する (canPlace が再利用)。
    // 空きフリーセル数と空列数は手生成中は不変なので、候補ごとに走査し直さない。
    let freeEmpty = 0;
    for (let f = 0; f < NUM_FREE; f++) {
      if (free[f] === -1) {
        freeEmpty++;
      }
    }
    let emptyCascTotal = 0;
    for (let i = 0; i < NUM_CASCADES; i++) {
      if (cols[i].length === 0) {
        emptyCascTotal++;
      }
    }
    for (let j = 0; j < NUM_CASCADES; j++) {
      let e = emptyCascTotal;
      if (cols[j].length === 0) {
        e -= 1; // 移動先自身は数えない
      }
      maxMoveByDest[j] = (freeEmpty + 1) * (1 << e);
    }

    // 安全でないホーム移動は、解に必要な場合があるため探索分岐として残す。
    // findHomeMove() が安全な移動を先に全て自動適用しているため、ここで列挙
    // されるホーム移動は常に「合法だが安全条件を満たさない」ものだけである。
    if (safeFoundationMoves) {
      for (let f = 0; f < NUM_FREE; f++) {
        const cardId = free[f];
        if (
          cardId !== -1
          && found[suitOf(cardId)] === rankOf(cardId) - 1
          && !isSafeFoundationMove(cardId, found)
        ) {
          const mv = packMove(cardId, ZONE_FREE, f, ZONE_HOME, suitOf(cardId), 1);
          moves.push(mv);
          scores.push(moveScore(mv));
          stats.unsafeHomeGenerated++;
        }
      }
      for (let i = 0; i < NUM_CASCADES; i++) {
        const len = cols[i].length;
        if (len === 0) {
          continue;
        }
        const cardId = cols[i][len - 1];
        if (
          found[suitOf(cardId)] === rankOf(cardId) - 1
          && !isSafeFoundationMove(cardId, found)
        ) {
          const mv = packMove(cardId, ZONE_CASCADE, i, ZONE_HOME, suitOf(cardId), 1);
          moves.push(mv);
          scores.push(moveScore(mv));
          stats.unsafeHomeGenerated++;
        }
      }
    }

    // 空列の移動先は 1 つ(先頭の空列)に正規化する。列正規化によりどの空列へ
    // 動かしても同一状態になるため、複数の空列へ同じ手を生成する必要はない。
    let firstEmptyCol = -1;
    for (let j = 0; j < NUM_CASCADES; j++) {
      if (cols[j].length === 0) {
        firstEmptyCol = j;
        break;
      }
    }

    // フリーセルの移動先も先頭の空きスロットに正規化する (フェーズC)。
    // フリーセルはスロット番号を状態ハッシュが区別しないため、どの空きスロットへ
    // 動かしても同一状態になり、複数の空きスロットへ同じ手を生成する必要はない。
    let firstEmptyFree = -1;
    for (let f = 0; f < NUM_FREE; f++) {
      if (free[f] === -1) {
        firstEmptyFree = f;
        break;
      }
    }

    // 列 → 列(スーパームーブ含む)。列の上から順に有効な連続列の末尾を試す
    for (let i = 0; i < NUM_CASCADES; i++) {
      const len = cols[i].length;
      for (let p = len - 1; p >= 0; p--) {
        if (p < len - 1) {
          const a = cols[i][p];
          const b = cols[i][p + 1];
          if (!(rankOf(a) === rankOf(b) + 1 && isRed(a) !== isRed(b))) {
            break; // これより下(長い末尾)は連続列にならない
          }
        }
        const count = len - p;
        const bottom = cols[i][p];
        for (let j = 0; j < NUM_CASCADES; j++) {
          if (j === i) {
            continue;
          }
          if (cols[j].length === 0 && j !== firstEmptyCol) {
            continue; // 空列の移動先は先頭の空列に正規化
          }
          if (count === len && cols[j].length === 0) {
            continue; // 列全体を空列へ移すのは列ラベルの入れ替え(自己対称遷移、フェーズC)
          }
          if (!canPlace(bottom, count, j)) {
            continue;
          }
          const mv = packMove(bottom, ZONE_CASCADE, i, ZONE_CASCADE, j, count);
          if (!disableReversePruning && isReverse(mv)) {
            continue;
          }
          moves.push(mv);
          scores.push(moveScore(mv));
        }
      }
    }

    // 列 → フリーセル (移動先は先頭の空きスロットに正規化、フェーズC)
    if (firstEmptyFree !== -1) {
      for (let i = 0; i < NUM_CASCADES; i++) {
        const len = cols[i].length;
        if (len === 0) {
          continue;
        }
        const cardId = cols[i][len - 1];
        const mv = packMove(cardId, ZONE_CASCADE, i, ZONE_FREE, firstEmptyFree, 1);
        if (!disableReversePruning && isReverse(mv)) {
          continue;
        }
        moves.push(mv);
        scores.push(moveScore(mv));
      }
    }

    // フリーセル → 列
    for (let f = 0; f < NUM_FREE; f++) {
      const cardId = free[f];
      if (cardId === -1) {
        continue;
      }
      for (let j = 0; j < NUM_CASCADES; j++) {
        if (cols[j].length === 0 && j !== firstEmptyCol) {
          continue; // 空列の移動先は先頭の空列に正規化
        }
        if (!canPlace(cardId, 1, j)) {
          continue;
        }
        const mv = packMove(cardId, ZONE_FREE, f, ZONE_CASCADE, j, 1);
        if (!disableReversePruning && isReverse(mv)) {
          continue;
        }
        moves.push(mv);
        scores.push(moveScore(mv));
      }
    }

    // スコア降順の安定挿入ソート (moves と scores を連動して並べ替える)。
    // 手数は高々数十なので、Array.prototype.sort の比較器呼び出しより安価。
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i];
      const s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < s) {
        moves[j + 1] = moves[j];
        scores[j + 1] = scores[j];
        j--;
      }
      moves[j + 1] = m;
      scores[j + 1] = s;
    }
    if (track) {
      profileCounters.movesGenerated += moves.length;
    }
    return moves;
  }

  /* ---------------- 検索 ---------------- */

  const tt = createTranspositionTable();
  let prevBranch = null;
  let nodes = 0;
  let solutionMoves = null; // 勝利検出時の手順(探索の巻き戻しで消えないよう即時保存)
  let aborted = null; // null | "node-limit" | "time-limit"
  const ABORT = Symbol("abort");

  function isWon() {
    return totalHome === totalCards;
  }

  /**
   * 探索の閾値と手順を決める評価。最短解や完全性は保証しない。
   * h = 未ホーム数 + Σ ceil(tailStart × w)。w は tailStartWeight を基本とし、
   * safe 改では進行率に応じて tailStartWeightMax まで段階的に上げる(案B)。
   * 固定 w1.1 は #10353/#13331 が、固定 w1.5 は #17978 が解けないため、
   * 単一探索内で重みをランプさせることで 12M 以内に全難関を収める。
   */
  function orderingHeuristic() {
    let w = currentTailWeight;
    let h = totalCards - totalHome;
    for (const pile of cols) {
      let tailStart = pile.length - 1;
      while (tailStart > 0) {
        const a = pile[tailStart - 1];
        const b = pile[tailStart];
        if (rankOf(a) === rankOf(b) + 1 && isRed(a) !== isRed(b)) {
          tailStart--;
        } else {
          break;
        }
      }
      h += Math.ceil(tailStart * w);
    }
    return h;
  }

  /** 反復境界で tailStart 重みを更新する(適応スケジュール)。 */
  function refreshAdaptiveWeight() {
    if (!adaptiveWeight) {
      return false;
    }
    let nextW;
    if (nodes >= adaptiveThreshold2) {
      nextW = tailStartWeightMax;
    } else if (nodes >= adaptiveThreshold1) {
      nextW = (tailStartWeight + tailStartWeightMax) / 2;
    } else {
      nextW = tailStartWeight;
    }
    if (nextW !== currentTailWeight) {
      currentTailWeight = nextW;
      return true;
    }
    return false;
  }

  function makeMove(mv) {
    if (track) {
      profileCounters.makeMove++;
    }
    const savedPrev = prevBranch;
    const applied = [];
    doApply(mv);
    applied.push(mv);
    path.push(mv);
    prevBranch = mv;
    let autoHomed = false;
    let home = findHomeMove();
    while (home) {
      autoHomed = true;
      doApply(home);
      applied.push(home);
      path.push(home);
      home = findHomeMove();
    }
    if (autoHomed) {
      prevBranch = null;
    }
    return { moves: applied, prev: savedPrev };
  }

  function unmakeMove(rec) {
    for (let i = rec.moves.length - 1; i >= 0; i--) {
      doUnapply(rec.moves[i]);
      path.pop();
    }
    prevBranch = rec.prev;
  }

  function search(g, bound) {
    if (g > stats.maxSearchDepth) {
      stats.maxSearchDepth = g;
    }
    nodes++;
    if (nodes >= maxNodes) {
      aborted = "node-limit";
      throw ABORT;
    }
    if ((nodes & 1023) === 0 && performance.now() - startedAt >= maxTimeMs) {
      aborted = "time-limit";
      throw ABORT;
    }
    refreshAdaptiveWeight();

    const f = g + orderingHeuristic();
    if (f > bound) {
      return f;
    }
    if (isWon()) {
      solutionMoves = path.slice();
      return FOUND;
    }

    const [stateH1, stateH2] = getStateHash();
    if (track) {
      profileCounters.ttLookup++;
    }
    const stored = tt.lookup(stateH1, stateH2);
    if (stored !== -1 && stored <= g) {
      stats.transpositionHits++;
      return INF; // 同等か浅い経路で既知の状態は刈る
    }
    if (track) {
      profileCounters.ttStore++;
    }
    tt.store(stateH1, stateH2, g);

    const moves = generateMoves();
    if (moves.length === 0) {
      stats.deadEndNodes++;
      return INF; // 行き止まり(自動ホーム済みで分岐手も無い)
    }

    let min = INF;
    for (const mv of moves) {
      const unsafeHome = mvDestZone(mv) === ZONE_HOME && !isSafeFoundationMove(mvCardId(mv), found);
      if (unsafeHome) {
        stats.unsafeHomeTried++;
      }
      const rec = makeMove(mv);
      const t = search(g + rec.moves.length, bound);
      unmakeMove(rec);
      if (t === FOUND) {
        if (unsafeHome) {
          stats.unsafeHomeSolved++;
        }
        return FOUND;
      }
      if (unsafeHome && t >= INF) {
        stats.unsafeHomeDeadEnds++;
      }
      if (t < min) {
        min = t;
      }
    }
    return min;
  }

  /* ---------------- 実行 ---------------- */

  const finish = (solved, status) => ({
    solved,
    status,
    moves: solutionMoves !== null ? solutionMoves.map(unpackMove) : [],
    nodes,
    timeMs: Math.round(performance.now() - startedAt),
    stats: {
      ...stats,
      transposition: tt.stats(),
      ...(track ? { profile: { ...profileCounters } } : {}),
    },
  });

  try {
    // 初期盤面の自動ホーム
    let home = findHomeMove();
    while (home) {
      doApply(home);
      path.push(home);
      home = findHomeMove();
    }
    if (isWon()) {
      solutionMoves = path.slice();
      return finish(true, "solved");
    }

    let g0 = path.length;
    let bound = g0 + orderingHeuristic();
    while (true) {
      // 置換表の「最小 g で刈る」最適化は同一イテレーション内でのみ正しい。
      // イテレーション(閾値)が上がると過去に浅い g で刈った状態も再展開が
      // 必要になるため、反復ごとにクリアする。
      // 適応スケジュールでは反復境界と探索中(1024ノードごと)の両方で重みを
      // 進める。大量ノードの反復では境界が長時間訪れないため、search 内でも
      // 更新する。境界での再計算は、更新直後の反復が古い bound のまま
      // 始まらないようにするための補正である。
      if (refreshAdaptiveWeight()) {
        bound = g0 + orderingHeuristic();
      }
      tt.clear();
      const t = search(g0, bound);
      if (t === FOUND) {
        return finish(true, "solved");
      }
      if (t >= INF) {
        return finish(false, allowUnsolvable ? "unsolvable" : "search-exhausted");
      }
      bound = t;
    }
  } catch (e) {
    if (e === ABORT) {
      return finish(false, aborted ?? "node-limit");
    }
    throw e;
  }
}

/**
 * 高速探索に失敗した場合、同じ初期盤面から安全探索を実行する。
 * 各 solve は盤面を変更しないため、段階間で探索状態を共有しない。
 * safe 改(案B)は単一探索内で tailStart 重みを段階的に上げるため、
 * 外部からは fast + safe の二本構成に見える(旧 safe2 は safe に統合)。
 */
export function solveWithFallback(board, options = {}) {
  const strategy = options.strategy ?? "fast-safe";
  if (strategy !== "fast" && strategy !== "safe" && strategy !== "fast-safe") {
    throw new Error(`未知のソルバー戦略: ${strategy}`);
  }
  const fastOptions = { ...SOLVER_PROFILES.fast, ...(options.fastOptions ?? {}) };
  const safeOptions = { ...SOLVER_PROFILES.safe, ...(options.safeOptions ?? {}) };
  if (options.trackCounters) {
    fastOptions.trackCounters = true;
    safeOptions.trackCounters = true;
  }
  const attempts = { fast: null, safe: null };

  const run = (mode, solverOptions) => {
    options.onStageChange?.(mode);
    const result = solve(board, solverOptions);
    attempts[mode] = {
      status: result.status,
      solved: result.solved,
      nodes: result.nodes,
      timeMs: result.timeMs,
    };
    return result;
  };

  let finalMode;
  let result;
  if (strategy === "fast") {
    finalMode = "fast";
    result = run("fast", fastOptions);
  } else if (strategy === "safe") {
    finalMode = "safe";
    result = run("safe", safeOptions);
  } else {
    result = run("fast", fastOptions);
    finalMode = "fast";
    if (!result.solved) {
      result = run("safe", safeOptions);
      finalMode = "safe";
    }
  }

  const totalNodes = Object.values(attempts).reduce((sum, attempt) => sum + (attempt?.nodes ?? 0), 0);
  const totalTimeMs = Object.values(attempts).reduce((sum, attempt) => sum + (attempt?.timeMs ?? 0), 0);
  return {
    ...result,
    finalMode,
    strategy,
    fallbackUsed: strategy === "fast-safe" && attempts.safe !== null,
    totalNodes,
    totalTimeMs,
    attempts,
  };
}
