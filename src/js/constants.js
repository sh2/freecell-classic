/* =========================================================
 * 定数 (名前付き export)
 * Microsoft 版 FreeCell 互換の配置生成で参照する値だけを集約する。
 * ========================================================= */

export const SUITS = ["♣", "♦", "♥", "♠"]; // Microsoft 版と同じスート順
export const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const NUM_CASCADES = 8;
export const NUM_FREE = 4;
export const NUM_HOME = 4;
export const MAX_GAME_NUMBER = 32000; // Microsoft 版 FreeCell と同じ互換範囲
