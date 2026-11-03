/* =========================================================
 * 配布アニメーション (deal animation)
 * 新しいゲームの開始時だけ、盤面上部中央の起点から 52 枚を
 * 横一列ずつ各カスケードへ飛ばして配る。
 * DOM への適用は view が担当し、ここでは定数・配布順・総時間・
 * 起点位置の計算（純粋関数）だけを扱う。
 * ========================================================= */

/* ---------------- 調整用定数 ---------------- */

/** 隣り合うカードを配り始める間隔 (ミリ秒) */
export const DEAL_STAGGER_MS = 14;

/** 1 枚が起点から着地するまでに飛ぶ時間 (ミリ秒) */
export const DEAL_FLIGHT_MS = 190;

/** 配布全体の上限 (ミリ秒)。52 枚でこの値を超えないこと */
export const MAX_DEAL_TOTAL_MS = 950;

/** 飛行の加減速。起点から着地へ向けて減速する */
export const DEAL_EASING = "ease-out";

/* ---------------- 純粋な計算 ---------------- */

/**
 * カスケードの並びから、行優先の配布順を作る。
 * 第 1 段は列 0→7、第 2 段は列 0→7 … の順に、存在するカードだけを返す。
 * カードはオブジェクト（id を持つ）でも、カード id そのものでもよい。
 *
 * @param {Array<Array<object|number>>} cascades 各列のカード配列
 * @returns {Array<{cardId: number, cascadeIndex: number, cardIndex: number, row: number, col: number}>}
 */
export function buildDealOrder(cascades) {
  if (!Array.isArray(cascades)) {
    return [];
  }
  let maxLength = 0;
  for (const pile of cascades) {
    if (Array.isArray(pile) && pile.length > maxLength) {
      maxLength = pile.length;
    }
  }
  const order = [];
  for (let row = 0; row < maxLength; row++) {
    for (let col = 0; col < cascades.length; col++) {
      const pile = cascades[col];
      if (!Array.isArray(pile) || row >= pile.length) {
        continue;
      }
      const card = pile[row];
      if (card === null || card === undefined) {
        continue;
      }
      const cardId = typeof card === "object" ? card.id : card;
      if (!Number.isInteger(cardId)) {
        continue;
      }
      order.push({ cardId, cascadeIndex: col, cardIndex: row, row, col });
    }
  }
  return order;
}

/** 枚数ぶんの配布を終えるまでの総時間 (ミリ秒)。0 枚なら 0 */
export function dealTotalDurationMs(cardCount) {
  if (!Number.isFinite(cardCount) || cardCount <= 0) {
    return 0;
  }
  const count = Math.floor(cardCount);
  return (count - 1) * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
}

/** index 番目（0 始まり）のカードを配り始めるまでの遅延 (ミリ秒) */
export function dealDelayMs(index) {
  if (!Number.isFinite(index) || index <= 0) {
    return 0;
  }
  return Math.floor(index) * DEAL_STAGGER_MS;
}

/**
 * 配布カードが現れる起点の位置をレイアウトから求める。
 * 縦はフリーセル／ホームセルの段（トップ行）の上端に揃える。
 * 横はフリーセル群の右端とホームセル群の左端の間の中央。隙間が
 * カード幅より狭い場合も隙間の中心に置く（配布開始時は両隣が空なので、
 * 枠への多少の重なりは許容する）。カスケードのカードには重ならないよう、
 * 下端がカスケード先頭カードの上端を超えない位置に収める。
 *
 * @param {{topArea?: object, cascadeArea?: object, game?: object,
 *          freeArea?: object, homeArea?: object,
 *          cardWidth?: number, cardHeight?: number}} layout
 * @returns {{left: number, top: number, width: number, height: number} | null}
 */
export function computeDealOrigin(layout) {
  if (!layout) {
    return null;
  }
  const { topArea, cascadeArea, game, freeArea, homeArea, cardWidth, cardHeight } = layout;
  if (!topArea || !game) {
    return null;
  }
  if (!Number.isFinite(cardWidth) || cardWidth <= 0) {
    return null;
  }
  if (!Number.isFinite(cardHeight) || cardHeight <= 0) {
    return null;
  }

  // 横: フリーセル群とホームセル群の隙間の中央。隙間が取れない
  // レイアウト（縦積みなど）では盤面中央へフォールバックする。
  let centerX = game.left + game.width / 2;
  if (
    freeArea &&
    homeArea &&
    Number.isFinite(freeArea.right) &&
    Number.isFinite(homeArea.left) &&
    homeArea.left > freeArea.right
  ) {
    centerX = (freeArea.right + homeArea.left) / 2;
  }
  let left = Math.round(centerX - cardWidth / 2);
  const minLeft = Math.round(game.left);
  const maxLeft = Math.round(game.left + game.width - cardWidth);
  if (maxLeft >= minLeft) {
    left = Math.min(maxLeft, Math.max(minLeft, left));
  }

  // 縦: トップ行の上端。カスケード先頭カードに重なる場合は上へ逃がす。
  let top = Math.round(topArea.top);
  if (cascadeArea && Number.isFinite(cascadeArea.top) && top + cardHeight > cascadeArea.top) {
    top = Math.round(cascadeArea.top - cardHeight);
  }
  return { left, top, width: cardWidth, height: cardHeight };
}

/* ---------------- E2E 検証専用のデバッグ情報 ---------------- */

/** 配布アニメーションのデバッグ情報 (window.__dealDebug に公開する) */
export const dealDebug = {
  plays: 0, // startDeal が呼ばれた回数
  active: false, // 配布中か
  dealtCount: 0, // 着地済み（スキップ・無効時は全枚数）の枚数
  skipped: false, // 直前の配布が入力でスキップされたか
  cardCount: 0, // 直前の配布対象枚数
  durationMs: 0, // 直前の予定総時間
  immediate: 0, // アニメーションせず即配置した回数
  forced: 0, // 再描画などで強制完了した回数
};

if (typeof window !== "undefined") {
  window.__dealDebug = dealDebug;
}
