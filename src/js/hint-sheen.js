/* =========================================================
 * ヒント時のカード発光 (hint sheen)
 * ヒント表示の瞬間、移動元カードの見えている範囲へ光の帯を 1 回だけ走らせる。
 * 音・テキスト・画面シェイクは伴わない。下の「調整用定数」だけを変更すれば
 * 見た目を調整できる。
 * DOM への適用は view が担当し、ここでは定数と純粋な判定だけを扱う。
 * ========================================================= */

/* ---------------- 調整用定数 ---------------- */

/** 光の帯が走り抜けるのにかける時間 (ミリ秒)。900ms 以下に保つ */
export const SWEEP_DURATION_MS = 620;

/** 帯の幅。カード幅に対する比率 */
export const SWEEP_BAND_RATIO = 0.5;

/** 帯の傾き (度)。進行方向に対して斜めに走らせる */
export const SWEEP_SKEW_DEG = 14;

/** 帯の前縁（淡い金）の濃さ */
export const SWEEP_LEAD = "rgba(255, 226, 150, 0.45)";

/** 帯の主色（金）の最大の濃さ */
export const SWEEP_MAIN = "rgba(238, 186, 55, 0.55)";

/** 帯の中心（暖かい白）のハイライト */
export const SWEEP_WHITE = "rgba(255, 251, 235, 0.92)";

/** 帯の後縁（金）の濃さ */
export const SWEEP_TAIL = "rgba(238, 186, 55, 0.45)";

/** 帯の外側のにじみ（カード面をほんのり照らす） */
export const SWEEP_GLOW = "rgba(255, 203, 92, 0.35)";

/** reduced-motion / アニメーション無効時に添える静止光の表示時間 (ミリ秒) */
export const STATIC_DURATION_MS = 460;

/** 静止光の中心（淡い金の白） */
export const STATIC_TOP = "rgba(255, 242, 205, 0.5)";

/** 静止光の外縁（金） */
export const STATIC_BOTTOM = "rgba(238, 190, 70, 0.3)";

/** 静止光の縁のにじみ */
export const STATIC_GLOW = "rgba(255, 208, 105, 0.3)";

/* ---------------- 純粋な判定 ---------------- */

/**
 * 帯を走らせるか、静止光にするかを決める。
 * ゲーム内アニメーション無効、または reduced-motion のどちらでも静止光。
 */
export function chooseSheenMode(animationsEnabled, reducedMotion) {
  return animationsEnabled && !reducedMotion ? "sweep" : "still";
}

/**
 * 移動元カードのうち、後続カードに隠れず見えている高さを返す。
 * coverRect は直後に重なるカードの矩形。無ければカード全体の高さ。
 * 数値が不正な場合もカード全体へフォールバックする。
 */
export function visibleSheenHeight(rect, coverRect) {
  if (!rect || !Number.isFinite(rect.height) || !Number.isFinite(rect.top)) {
    return 0;
  }
  const height = Math.max(0, rect.height);
  if (!coverRect || !Number.isFinite(coverRect.top)) {
    return height;
  }
  const cut = coverRect.top - rect.top;
  // 後続カードが上端以前、または下端以降なら隠れていない
  if (!(cut > 0) || cut >= height) {
    return height;
  }
  return cut;
}

/* ---------------- E2E 検証専用のデバッグ情報 ---------------- */

/**
 * E2E から発光の有無・種類・対象カード・位置を判定するための情報。
 * - plays: 発光した回数 (clearHint → showHint のたびに増える)
 * - active: いま発光中か
 * - mode: "sweep" | "still" | null
 * - cardId: 直近の発光対象カード ID
 * - left/top/width/height: 直近の発光要素の位置と見えている高さ
 */
export const hintSheenDebug = {
  plays: 0,
  active: false,
  mode: null,
  cardId: null,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
};
if (typeof window !== "undefined") {
  window.__hintSheenDebug = hintSheenDebug;
}
