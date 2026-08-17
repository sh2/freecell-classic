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

/** カード id からランク(1〜13)とスート(0〜3)を得る */
const rankOf = (id) => (id >> 2) + 1;
const suitOf = (id) => id & 3;
const isRed = (id) => (id & 3) === 1 || (id & 3) === 2;

/**
 * Horne's Rule に基づき、カードを土台へ送って安全か判定する。
 *
 * カードを土台へ送ると、そのカードは tableau の受け皿として使えなくなる。
 * 反対色の両スートが rank - 2 まで進んでいれば、rank のカードを失っても
 * それらのカードを受け皿として必要とする局面は生じない。A は常に安全である。
 * foundationRanks は各スートの現在の先頭ランク(0〜13)を受け取る。
 */
export function isSafeFoundationMove(cardId, foundationRanks) {
  const suit = suitOf(cardId);
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
  return {
    /** 見つかれば最小 g を返す。無ければ -1 */
    lookup(k1, k2) {
      let i = k1 & (size - 1);
      for (let n = 0; n < MAX_PROBE; n++) {
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
        const gh = g[i];
        if (gh === -1) {
          h1[i] = k1;
          h2[i] = k2;
          g[i] = gg;
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
      // 満杯に近い場合は先頭スロットを上書き(枝刈り情報を失うだけで安全性は保たれる)
      i = k1 & (size - 1);
      h1[i] = k1;
      h2[i] = k2;
      g[i] = gg;
    },
    clear() {
      g.fill(-1);
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
 * @param {{maxNodes?: number, maxTimeMs?: number}} options
 * @returns {{solved: boolean, moves: object[], nodes: number, timeMs: number, status: string}}
 *   solved=true のとき moves は勝ち手順(初手→終手)。各 move は
 *   { cardId, fromZone, fromIndex, destZone, destIndex, count }。
 *   solved=false のとき status は "unsolvable" | "node-limit" | "time-limit"。
 */
export function solve(board, options = {}) {
  const maxNodes = options.maxNodes ?? 2000000;
  const maxTimeMs = options.maxTimeMs ?? 60000;
  const safeFoundationMoves = options.safeFoundationMoves ?? true;
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

  function getStateHash() {
    const order = Array.from({ length: NUM_CASCADES }, (_, i) => i);
    order.sort((a, b) => colH1[a] - colH1[b] || colH2[a] - colH2[b]);
    let k1 = h1 >>> 0;
    let k2 = h2 >>> 0;
    for (const col of order) {
      k1 = (Math.imul(k1 ^ colH1[col], 0x9e3779b1) + 0x85ebca6b) >>> 0;
      k2 = (Math.imul(k2 ^ colH2[col], 0xc2b2ae35) + 0x27d4eb2f) >>> 0;
    }
    return [k1, k2];
  }

  /* ---------------- 手の適用 / 取り消し ---------------- */

  function doApply(mv) {
    const cardId = mv.cardId;
    if (mv.destZone === "home") {
      const suit = suitOf(cardId);
      const rank = rankOf(cardId);
      if (mv.fromZone === "free") {
        free[mv.fromIndex] = -1;
        xorFree(cardId);
      } else {
        cols[mv.fromIndex].pop();
        xorCol(mv.fromIndex, cols[mv.fromIndex].length, cardId);
      }
      xorFound(suit, found[suit]);
      found[suit] = rank;
      xorFound(suit, rank);
      totalHome++;
    } else if (mv.destZone === "free") {
      cols[mv.fromIndex].pop();
      xorCol(mv.fromIndex, cols[mv.fromIndex].length, cardId);
      free[mv.destIndex] = cardId;
      xorFree(cardId);
    } else {
      // destZone === "cascade"
      if (mv.fromZone === "free") {
        free[mv.fromIndex] = -1;
        xorFree(cardId);
        const base = cols[mv.destIndex].length;
        cols[mv.destIndex].push(cardId);
        xorCol(mv.destIndex, base, cardId);
      } else {
        const src = cols[mv.fromIndex];
        const p = src.length - mv.count;
        const tail = src.splice(p);
        for (let t = 0; t < mv.count; t++) {
          xorCol(mv.fromIndex, p + t, tail[t]);
        }
        const base = cols[mv.destIndex].length;
        for (let t = 0; t < mv.count; t++) {
          cols[mv.destIndex].push(tail[t]);
          xorCol(mv.destIndex, base + t, tail[t]);
        }
      }
    }
  }

  function doUnapply(mv) {
    const cardId = mv.cardId;
    if (mv.destZone === "home") {
      const suit = suitOf(cardId);
      const rank = rankOf(cardId);
      xorFound(suit, found[suit]);
      found[suit] = rank - 1;
      xorFound(suit, rank - 1);
      totalHome--;
      if (mv.fromZone === "free") {
        free[mv.fromIndex] = cardId;
        xorFree(cardId);
      } else {
        cols[mv.fromIndex].push(cardId);
        xorCol(mv.fromIndex, cols[mv.fromIndex].length - 1, cardId);
      }
    } else if (mv.destZone === "free") {
      free[mv.destIndex] = -1;
      xorFree(cardId);
      cols[mv.fromIndex].push(cardId);
      xorCol(mv.fromIndex, cols[mv.fromIndex].length - 1, cardId);
    } else {
      if (mv.fromZone === "free") {
        cols[mv.destIndex].pop();
        xorCol(mv.destIndex, cols[mv.destIndex].length, cardId);
        free[mv.fromIndex] = cardId;
        xorFree(cardId);
      } else {
        const base = cols[mv.destIndex].length - mv.count;
        const tail = cols[mv.destIndex].splice(base);
        for (let t = 0; t < mv.count; t++) {
          xorCol(mv.destIndex, base + t, tail[t]);
        }
        const p = cols[mv.fromIndex].length;
        for (let t = 0; t < mv.count; t++) {
          cols[mv.fromIndex].push(tail[t]);
          xorCol(mv.fromIndex, p + t, tail[t]);
        }
      }
    }
  }

  /* ---------------- 手の生成 ---------------- */

  function freeEmptyCount() {
    let n = 0;
    for (let f = 0; f < NUM_FREE; f++) {
      if (free[f] === -1) {
        n++;
      }
    }
    return n;
  }

  function maxMovableTo(dest) {
    let emptyCasc = 0;
    for (let i = 0; i < NUM_CASCADES; i++) {
      if (cols[i].length === 0) {
        emptyCasc++;
      }
    }
    if (cols[dest].length === 0) {
      emptyCasc -= 1; // 移動先自身は数えない
    }
    return (freeEmptyCount() + 1) * (1 << emptyCasc);
  }

  /** カード群(先頭=最下位カード)を列 dest に置けるか。count は枚数 */
  function canPlace(bottomCard, count, dest) {
    const pile = cols[dest];
    if (pile.length === 0) {
      return count <= maxMovableTo(dest);
    }
    const top = pile[pile.length - 1];
    if (!(rankOf(top) === rankOf(bottomCard) + 1 && isRed(top) !== isRed(bottomCard))) {
      return false;
    }
    return count <= maxMovableTo(dest);
  }

  function moveScore(mv) {
    if (mv.destZone === "home") {
      return 12000 + rankOf(mv.cardId) * 500; // 実験3: ランクが高いホーム移動を優先する
    }
    if (mv.destZone === "cascade") {
      let s = mv.count * 10000;
      if (cols[mv.destIndex].length > 0) {
        s += 5000; // 空き列より既存列への積み重ねを優先
      }
      if (mv.fromZone === "cascade") {
        const srcLen = cols[mv.fromIndex].length;
        if (mv.count === srcLen) {
          s += 20000; // 移動元が空になる(空き列の価値が高い)
        } else {
          const revealed = cols[mv.fromIndex][srcLen - mv.count - 1];
          if (found[suitOf(revealed)] === rankOf(revealed) - 1) {
            s += 15000; // 露出したカードが自動ホーム対象になる
          }
        }
      }
      return s;
    }
    if (mv.destZone === "free") {
      let s = 2000;
      if (mv.fromZone === "cascade") {
        const srcLen = cols[mv.fromIndex].length;
        if (srcLen === 1) {
          s += 20000; // 移動元の列が空になる
        } else {
          const revealed = cols[mv.fromIndex][srcLen - 2];
          if (found[suitOf(revealed)] === rankOf(revealed) - 1) {
            s += 15000; // 露出したカードが自動ホーム対象になる
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
      mv.fromZone === prevBranch.destZone &&
      mv.fromIndex === prevBranch.destIndex &&
      mv.destZone === prevBranch.fromZone &&
      mv.destIndex === prevBranch.fromIndex &&
      mv.cardId === prevBranch.cardId
    );
  }

  /** ホームへ送れるカードを 1 枚探す(あれば move、無ければ null) */
  function findHomeMove() {
    for (let f = 0; f < NUM_FREE; f++) {
      const c = free[f];
      if (
        c !== -1
        && found[suitOf(c)] === rankOf(c) - 1
        && (!safeFoundationMoves || isSafeFoundationMove(c, found))
      ) {
        return { cardId: c, fromZone: "free", fromIndex: f, destZone: "home", destIndex: suitOf(c), count: 1 };
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
        return { cardId: c, fromZone: "cascade", fromIndex: i, destZone: "home", destIndex: suitOf(c), count: 1 };
      }
    }
    return null;
  }

  /** 分岐手を列挙する(ホーム手は含まない。自動ホームで消化済み) */
  function generateMoves() {
    const moves = [];

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
        const mv = { cardId, fromZone: "free", fromIndex: f, destZone: "home", destIndex: suitOf(cardId), count: 1 };
        mv.score = moveScore(mv);
        moves.push(mv);
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
        const mv = { cardId, fromZone: "cascade", fromIndex: i, destZone: "home", destIndex: suitOf(cardId), count: 1 };
        mv.score = moveScore(mv);
        moves.push(mv);
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
          if (!canPlace(bottom, count, j)) {
            continue;
          }
          const mv = { cardId: bottom, fromZone: "cascade", fromIndex: i, destZone: "cascade", destIndex: j, count };
          if (isReverse(mv)) {
            continue;
          }
          mv.score = moveScore(mv);
          moves.push(mv);
        }
      }
    }

    // 列 → フリーセル
    for (let i = 0; i < NUM_CASCADES; i++) {
      const len = cols[i].length;
      if (len === 0) {
        continue;
      }
      const cardId = cols[i][len - 1];
      for (let f = 0; f < NUM_FREE; f++) {
        if (free[f] !== -1) {
          continue;
        }
        const mv = { cardId, fromZone: "cascade", fromIndex: i, destZone: "free", destIndex: f, count: 1 };
        if (isReverse(mv)) {
          continue;
        }
        mv.score = moveScore(mv);
        moves.push(mv);
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
        const mv = { cardId, fromZone: "free", fromIndex: f, destZone: "cascade", destIndex: j, count: 1 };
        if (isReverse(mv)) {
          continue;
        }
        mv.score = moveScore(mv);
        moves.push(mv);
      }
    }

    moves.sort((a, b) => b.score - a.score);
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

  /** ヒューリスティック: 残りカード数 + 各列の「可動末尾より下」のカード数。
   *  列の先頭から連続した降順交互列(スーパームーブで動かせる範囲)より下の
   *  カードは、上を退けてからでないと動かせないため 1 手分を加算する。
   *  (やや過大評価になり得るが、解を「最短でなくても見つける」用途では有効) */
  function heuristic() {
    let h = totalCards - totalHome;
    for (let i = 0; i < NUM_CASCADES; i++) {
      const pile = cols[i];
      const n = pile.length;
      if (n <= 1) {
        continue;
      }
      let tailStart = n - 1;
      while (tailStart > 0) {
        const a = pile[tailStart - 1];
        const b = pile[tailStart];
        if (rankOf(a) === rankOf(b) + 1 && isRed(a) !== isRed(b)) {
          tailStart--;
        } else {
          break;
        }
      }
      h += tailStart; // 可動末尾より下にあるカード
    }
    return h;
  }

  function makeMove(mv) {
    const savedPrev = prevBranch;
    const applied = [];
    doApply(mv);
    applied.push(mv);
    path.push(mv);
    prevBranch = mv;
    let home = findHomeMove();
    while (home) {
      doApply(home);
      applied.push(home);
      path.push(home);
      home = findHomeMove();
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

    const f = g + heuristic();
    if (f > bound) {
      return f;
    }
    if (isWon()) {
      solutionMoves = path.slice();
      return FOUND;
    }

    const [stateH1, stateH2] = getStateHash();
    const stored = tt.lookup(stateH1, stateH2);
    if (stored !== -1 && stored <= g) {
      stats.transpositionHits++;
      return INF; // 同等か浅い経路で既知の状態は刈る
    }
    tt.store(stateH1, stateH2, g);

    const moves = generateMoves();
    if (moves.length === 0) {
      stats.deadEndNodes++;
      return INF; // 行き止まり(自動ホーム済みで分岐手も無い)
    }

    let min = INF;
    for (const mv of moves) {
      const unsafeHome = mv.destZone === "home" && !isSafeFoundationMove(mv.cardId, found);
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
    moves: solutionMoves !== null ? solutionMoves.slice() : [],
    nodes,
    timeMs: Math.round(performance.now() - startedAt),
    stats: { ...stats },
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
    let bound = g0 + heuristic();
    while (true) {
      // 置換表の「最小 g で刈る」最適化は同一イテレーション内でのみ正しい。
      // イテレーション(閾値)が上がると過去に浅い g で刈った状態も再展開が
      // 必要になるため、反復ごとにクリアする。
      tt.clear();
      const t = search(g0, bound);
      if (t === FOUND) {
        return finish(true, "solved");
      }
      if (t >= INF) {
        return finish(false, "unsolvable");
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
