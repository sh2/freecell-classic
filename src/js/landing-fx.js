/* =========================================================
 * セル着地エフェクト (スナップ + 行き先別の追加要素)
 * フリーセル / ホームセルへの着地時だけ発火する小さな演出。
 * このモジュールは調整用定数と純粋ヘルパーだけを持ち、
 * DOM の読み書きは view.js 側で行う。
 *
 * 配分:
 *  - フリーセル        : スナップのみ
 *  - ホーム (全ランク) : スナップ + 小破裂
 * ========================================================= */

/* ---------------- スナップフィット ---------------- */

/** 着地直後の実カードの拡大率 (ここから 1 へ収める) */
export const SNAP_SCALE_START = 1.07;

/** スナップの所要時間 (ミリ秒) */
export const SNAP_DURATION_MS = 170;

/** スナップのイージング */
export const SNAP_EASING = "cubic-bezier(0.34, 1.45, 0.64, 1)";

/** 着地先スロットの枠を光らせる時間 (ミリ秒) */
export const SLOT_GLOW_DURATION_MS = 260;

/** スロットの枠を光らせる色 (RGB 3 値。不透明度は別途付ける) */
export const SLOT_GLOW_RGB = "230, 193, 90";

/** スロットの枠の光のピーク不透明度 */
export const SLOT_GLOW_PEAK_ALPHA = 0.85;

/* ---------------- 小破裂 (ホーム着地・全ランク) ---------------- */

/** 1 回の小破裂で出す破片の本数 */
export const SHARD_COUNT = 14;

/** 小破裂が消えるまでの時間 (ミリ秒) */
export const SHARD_DURATION_MS = 260;

/** 破片の初速の範囲 (px/s) */
export const SHARD_SPEED_MIN = 130;
export const SHARD_SPEED_MAX = 260;

/** 破片の線の太さ (px) */
export const SHARD_WIDTH = 2.5;

/** 破片の線分の長さ (px) */
export const SHARD_LENGTH = 10;

/** 破片の色 (赤スート / 黒スート) */
export const SHARD_RED = "#ff7a72";
export const SHARD_BLACK = "#9fd8ff";

/** 同時に存在できる小破裂の上限。超過分は捨てる */
export const MAX_SHARD_BURSTS = 3;

/* ---------------- 純粋ヘルパー ---------------- */

/** スートが赤 (♦/♥) かどうか */
export function isRedSuit(suit) {
  return suit === 1 || suit === 2;
}

/** 小破裂の色をスートから決める */
export function shardColorForSuit(suit) {
  return isRedSuit(suit) ? SHARD_RED : SHARD_BLACK;
}

/**
 * 着地先ゾーンから、スナップに追加する効果を返す。
 * "burst" = 小破裂、 null = 追加効果なし。
 * フリーセルと列への着地はスナップだけ (追加効果なし)。
 * ホームセルはランクを問わず小破裂を添える。
 */
export function extraEffectFor(zone) {
  return zone === "home" ? "burst" : null;
}

/**
 * 小破裂の破片 (角度と初速) を生成する。random はテスト用に差し替え可能。
 * 角度は 0〜2π の放射状、速度は SHARD_SPEED_MIN〜SHARD_SPEED_MAX。
 */
export function createShards(random = Math.random, count = SHARD_COUNT) {
  const shards = [];
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const speed = SHARD_SPEED_MIN + random() * (SHARD_SPEED_MAX - SHARD_SPEED_MIN);
    shards.push({ angle, speed });
  }
  return shards;
}

/** 小破裂の進行度 (0〜1) から不透明度を返す。寿命末で 0 になる */
export function shardAlphaAt(progress) {
  const p = Math.min(1, Math.max(0, progress));
  return 1 - p;
}
