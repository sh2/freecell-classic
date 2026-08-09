/* =========================================================
 * ルール判定 (純粋関数)
 * 盤面の配列は引数で受け取り、グローバル参照・DOM・時刻には触れない。
 * 配列は読み取り専用に扱い、変更は呼び出し側が行う。
 * ========================================================= */

import { NUM_FREE, NUM_CASCADES, NUM_HOME } from "./constants.js";

/** 赤(♦/♥)かどうか */
export function isRed(card) {
  return card.suit === 1 || card.suit === 2;
}

/** 色交互の降順連続になっているか。空配列・1 枚は true */
export function isValidSequence(cards) {
  for (let i = 0; i + 1 < cards.length; i++) {
    if (cards[i].rank !== cards[i + 1].rank + 1) {
      return false;
    }
    if (isRed(cards[i]) === isRed(cards[i + 1])) {
      return false;
    }
  }
  return true;
}

/** 指定スートのホーム先頭の現在ランク。ホームがなければ 0 */
export function foundationRank(foundations, suit) {
  for (const pile of foundations) {
    if (pile.length > 0 && pile[0].suit === suit) {
      return pile[pile.length - 1].rank;
    }
  }
  return 0;
}

/** そのカードを受け入れられるホームのインデックス。なければ -1 */
export function foundationTargetFor(foundations, card) {
  for (let i = 0; i < NUM_HOME; i++) {
    if (canDropOnHome(foundations, card, i)) {
      return i;
    }
  }
  return -1;
}

/** 指定ホームにカードを置けるか */
export function canDropOnHome(foundations, card, homeIndex) {
  const pile = foundations[homeIndex];
  if (pile.length === 0) {
    return card.rank === 1;
  }
  return pile[0].suit === card.suit && pile[pile.length - 1].rank === card.rank - 1;
}

/** 指定カスケード列にグループを置けるか(列が空なら常に可) */
export function canDropOnCascade(cascades, group, cascadeIndex) {
  const pile = cascades[cascadeIndex];
  if (pile.length === 0) {
    return true;
  }
  const top = pile[pile.length - 1];
  return top.rank === group[0].rank + 1 && isRed(top) !== isRed(group[0]);
}

/** 空きセル・空き列から、一度に動かせる最大の枚数 */
export function maxMovable(freeCells, cascades, destCascadeIndex) {
  const freeEmpty = freeCells.filter((c) => c === null).length;
  let emptyCasc = cascades.filter((c) => c.length === 0).length;
  if (destCascadeIndex !== null && cascades[destCascadeIndex].length === 0) {
    emptyCasc -= 1; // 移動先自身は数えない
  }
  return (freeEmpty + 1) * (1 << emptyCasc);
}

/** 安全にホームへ送れるかの判定(自動移動用) */
export function canAutoHome(foundations, card) {
  if (card.rank <= 2) {
    return true;
  }
  const need = card.rank - 1;
  for (let s = 0; s < 4; s++) {
    if (isRed({ suit: s }) !== isRed(card) && foundationRank(foundations, s) < need) {
      return false;
    }
  }
  return true;
}

/** カード id から位置を探す。見つからなければ null */
export function findCardLocation(state, cardId) {
  const { freeCells, cascades, foundations } = state;
  for (let i = 0; i < NUM_FREE; i++) {
    if (freeCells[i] && freeCells[i].id === cardId) {
      return { zone: "free", index: i, cardIndex: 0 };
    }
  }
  for (let i = 0; i < NUM_CASCADES; i++) {
    const pos = cascades[i].findIndex((c) => c.id === cardId);
    if (pos >= 0) {
      return { zone: "cascade", index: i, cardIndex: pos };
    }
  }
  for (let i = 0; i < NUM_HOME; i++) {
    if (foundations[i].some((c) => c.id === cardId)) {
      return { zone: "home", index: i };
    }
  }
  return null;
}

/** そのカード(列)をつかめるか */
export function isGrabbable(cascades, loc) {
  if (loc.zone === "free") {
    return true;
  }
  if (loc.zone === "cascade") {
    return isValidSequence(cascades[loc.index].slice(loc.cardIndex));
  }
  return false; // ホームからは戻せない
}
