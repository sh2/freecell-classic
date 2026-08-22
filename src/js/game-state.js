/* =========================================================
 * 状態遷移層 (純粋な状態遷移のみ)
 * DOM・時刻・表示には触れない。state オブジェクトをその場で更新する。
 * カードオブジェクトは不変として扱い、履歴スナップショットは配列だけを
 * 複製してカード自体は共有してよい。
 * ========================================================= */

import { NUM_FREE, NUM_CASCADES, MAX_GAME_NUMBER } from "./constants.js";
import * as rules from "./rules.js";

/**
 * 新しいゲーム状態を生成する。
 * @param {number} gameNumber ゲーム番号 (1〜MAX_GAME_NUMBER)
 * @param {{ cascades: object[][], freeCells: (object|null)[], foundations: object[][] }} board
 *   dealGame() の返り値
 */
export function createState(gameNumber, board) {
  return {
    gameNumber,
    cascades: board.cascades,
    freeCells: board.freeCells,
    foundations: board.foundations,
    moveCount: 0,
    historyStack: [],
    selected: null,
    won: false,
    stuck: false,
  };
}

/** 指定位置のカード群を返す(フリーセルは 1 枚、カスケードは cardIndex 以降) */
export function groupFrom(state, loc) {
  if (loc.zone === "free") {
    const c = state.freeCells[loc.index];
    return c ? [c] : [];
  }
  if (loc.zone === "cascade") {
    return state.cascades[loc.index].slice(loc.cardIndex);
  }
  return [];
}

/** 選択中のカード群を返す */
export function selectedGroup(state) {
  return state.selected ? groupFrom(state, state.selected) : [];
}

/** 履歴保存用に現在の盤面を複製する(カードオブジェクト自体は共有) */
function captureHistoryState(state) {
  return {
    cascades: state.cascades.map((pile) => pile.slice()),
    freeCells: state.freeCells.slice(),
    foundations: state.foundations.map((pile) => pile.slice()),
    moveCount: state.moveCount,
  };
}

function restore(state, snap) {
  state.cascades = snap.cascades.map((pile) => pile.slice());
  state.freeCells = snap.freeCells.slice();
  state.foundations = snap.foundations.map((pile) => pile.slice());
  state.moveCount = snap.moveCount;
}

function takeGroup(state, loc) {
  if (loc.zone === "free") {
    const c = state.freeCells[loc.index];
    state.freeCells[loc.index] = null;
    return [c];
  }
  return state.cascades[loc.index].splice(loc.cardIndex);
}

function placeGroup(state, group, dest) {
  if (dest.zone === "free") {
    state.freeCells[dest.index] = group[0];
  } else if (dest.zone === "home") {
    state.foundations[dest.index].push(group[0]);
  } else {
    state.cascades[dest.index].push(...group);
  }
}

/**
 * 移動を試みる。成功時は {ok:true}、失敗時は {ok:false, reason} を返す。
 * 失敗手では状態・履歴・手数を変更しない。
 * 成功手では履歴と手数を 1 増やし、選択を解除する。
 * 描画・タイマー・トースト・勝利オーバーレイは呼び出さない(呼び出し側の責務)。
 * 勝利判定も呼び出さないため、成功手で won は更新されない。
 * グループのシーケンス妥当性(isValidSequence)は検証しない。呼び出し側(UI 層)が
 * isGrabbable や 1 枚制限で保証する(旧実装と同じ契約)。
 */
export function attemptMove(state, from, destZone, destIndex) {
  if (state.won) {
    return { ok: false, reason: "finished" };
  }
  const group = groupFrom(state, from);
  if (group.length === 0) {
    return { ok: false, reason: "invalid" };
  }

  if (destZone === "free") {
    if (group.length !== 1) {
      return { ok: false, reason: "invalid" };
    }
    if (state.freeCells[destIndex] !== null) {
      return { ok: false, reason: "occupied" };
    }
  } else if (destZone === "home") {
    if (group.length !== 1) {
      return { ok: false, reason: "invalid" };
    }
    if (!rules.canDropOnHome(state.foundations, group[0], destIndex)) {
      // 正しいホームが別にある場合はそちらへ誘導
      const alt = rules.foundationTargetFor(state.foundations, group[0]);
      if (alt < 0) {
        return { ok: false, reason: "invalid" };
      }
      destIndex = alt;
    }
  } else {
    if (!rules.canDropOnCascade(state.cascades, group, destIndex)) {
      return { ok: false, reason: "invalid" };
    }
    const limit = rules.maxMovable(state.freeCells, state.cascades, destIndex);
    if (group.length > limit) {
      return { ok: false, reason: "too-many", limit };
    }
  }

  state.historyStack.push(captureHistoryState(state));
  placeGroup(state, takeGroup(state, from), { zone: destZone, index: destIndex });
  state.moveCount++;
  state.selected = null;
  return { ok: true };
}

/** 直前の手を巻き戻す。巻き戻せたら true、履歴が空なら false */
export function undo(state) {
  if (state.historyStack.length === 0) {
    return false;
  }
  restore(state, state.historyStack.pop());
  state.selected = null;
  state.stuck = false; // 1手戻すと必ず手が残るため詰みは解除される
  return true;
}

/** 全カードがホームに揃っていれば true(勝利判定) */
export function isWon(state) {
  return state.foundations.reduce((n, pile) => n + pile.length, 0) === 52;
}

/** 勝利判定。勝利していれば won を true にして true を返す */
export function checkWin(state) {
  if (isWon(state)) {
    state.won = true;
    return true;
  }
  return false;
}

/**合法手が 1 つでも残っているか(詰み判定用の純粋関数)。
 * 複数枚グループの移動は「空きフリーセルまたは空きカスケード」が必須で、
 * その場合は必ず単独カードの移動も成立するため、単独カードの移動だけを
 * 確認すれば十分(maxMovable 判定は不要)。
 * フリーセル→フリーセルの移動は無意味なシャッフルのため合法手に数えない。
 */
export function hasAnyMove(state) {
  if (state.won) {
    return false;
  }

  const freeEmpty = state.freeCells.some((c) => c === null);

  // カスケードの先頭カード(単独で動かせるのは先頭のみ)
  for (let i = 0; i < NUM_CASCADES; i++) {
    const pile = state.cascades[i];
    if (pile.length === 0) {
      continue;
    }
    const top = pile[pile.length - 1];

    if (rules.foundationTargetFor(state.foundations, top) >= 0) {
      return true; // ホームへ
    }
    if (freeEmpty) {
      return true; // 空きフリーセルへ
    }
    for (let j = 0; j < NUM_CASCADES; j++) {
      if (j === i) {
        continue;
      }
      if (rules.canDropOnCascade(state.cascades, [top], j)) {
        return true; // 別カスケードへ
      }
    }
  }

  // フリーセルのカード
  for (let i = 0; i < NUM_FREE; i++) {
    const c = state.freeCells[i];
    if (!c) {
      continue;
    }
    if (rules.foundationTargetFor(state.foundations, c) >= 0) {
      return true; // ホームへ
    }
    for (let j = 0; j < NUM_CASCADES; j++) {
      if (rules.canDropOnCascade(state.cascades, [c], j)) {
        return true; // カスケードへ
      }
    }
  }

  return false;
}

/** 詰み判定。詰んでいれば stuck を true にして true を返す。
 *  勝利済みの場合は詰み扱いにしない(stuck は false のまま)。 */
export function checkStuck(state) {
  if (state.won) {
    state.stuck = false;
    return false;
  }
  state.stuck = !hasAnyMove(state);
  return state.stuck;
}

/**
 * 
 * 安全にホームへ送れるカードを 1 枚だけ探す(状態は変更しない)。
 * 見つからなければ null を返す。
 */
function findAutoMoveCard(state) {
  if (state.won) {
    return null;
  }
  // フリーセルとカスケードの先頭から、安全にホームへ送れるカードを探す
  const candidates = [];
  for (let i = 0; i < NUM_FREE; i++) {
    if (state.freeCells[i]) {
      candidates.push({ loc: { zone: "free", index: i }, card: state.freeCells[i] });
    }
  }
  for (let i = 0; i < NUM_CASCADES; i++) {
    const pile = state.cascades[i];
    if (pile.length > 0) {
      candidates.push({ loc: { zone: "cascade", index: i, cardIndex: pile.length - 1 }, card: pile[pile.length - 1] });
    }
  }
  for (const { loc, card } of candidates) {
    const target = rules.foundationTargetFor(state.foundations, card);
    if (target >= 0 && rules.canAutoHome(state.foundations, card)) {
      return { loc, card };
    }
  }
  return null;
}

/**
 * 安全にホームへ送れるカードを 1 枚だけ自動移動する。
 * 移動したカードを返す。送れるカードがなければ null を返す。
 */
export function autoMoveOne(state) {
  const found = findAutoMoveCard(state);
  if (!found) {
    return null;
  }
  const target = rules.foundationTargetFor(state.foundations, found.card);
  return attemptMove(state, found.loc, "home", target).ok ? found.card : null;
}

/** 安全にホームへ送れるカードが 1 枚でもあれば true(状態は変更しない) */
export function hasAutoMove(state) {
  return findAutoMoveCard(state) !== null;
}

/**
 * ダブルクリック時の自動移動。移動できたら true を返す。
 * ホームへ行けるカードはホームへ、無理なら空きフリーセルへ(先頭 1 枚のみ)。
 */
export function dblClickAutoMove(state, loc) {
  if (loc.zone === "home") {
    return false;
  }
  const group = groupFrom(state, loc);
  if (group.length !== 1) {
    return false; // 先頭 1 枚のみ対象
  }

  const card = group[0];
  const target = rules.foundationTargetFor(state.foundations, card);
  if (target >= 0) {
    return attemptMove(state, loc, "home", target).ok;
  }
  if (loc.zone === "free") {
    return false; // フリーセル同士の移動はしない
  }
  const emptyFree = state.freeCells.findIndex((c) => c === null);
  if (emptyFree >= 0) {
    return attemptMove(state, loc, "free", emptyFree).ok;
  }
  return false;
}

/**
 * ゲーム番号の入力補正(純粋関数)。
 * 入力欄の文字列を受け取り、数値変換と 1〜MAX_GAME_NUMBER の範囲検証を行う。
 * 数値変換は Number() と同等(前後空白は許容。16 進や指数表記も Number() の
 * 解釈に従う)で、現行の入力補正挙動をそのまま維持する。
 * 有効値は小数点以下を切り捨てたゲーム番号を返し、空値・非数値・範囲外は
 * null を返す。呼び出し側は null の場合にランダム番号を生成する。
 */
export function normalizeGameNumber(rawValue) {
  const num = Math.floor(Number(rawValue));
  if (!Number.isFinite(num) || num < 1 || num > MAX_GAME_NUMBER) {
    return null;
  }
  return num;
}
