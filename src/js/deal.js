/* =========================================================
 * ディール (Microsoft FreeCell 互換)
 * グローバル状態を変更せず、ゲーム番号から新しい初期盤面を返す。
 * カードオブジェクトは不変として扱い、複数盤面間で共有してよい。
 * ========================================================= */

import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "./constants.js";

/** Microsoft C ランタイム互換 LCG: state = (214013*state + 2531011) mod 2^31 */
export function msRng(seed) {
  const MASK = 2147483648; // 2^31
  // s < 2^31 のとき s*214013 + 2531011 < 2^53 なので倍精度浮動小数点で厳密に計算できる
  let s = ((seed % MASK) + MASK) % MASK;
  return function () {
    s = (s * 214013 + 2531011) % MASK;
    return Math.floor(s / 65536); // state >> 16
  };
}

/**
 * ゲーム番号から新しい初期盤面を生成して返す。
 * 既存のグローバル配列は変更しない。毎回新しい配列を生成するため、
 * 返り値の配列を書き換えても他の盤面へ影響しない。
 *
 * @param {number} num ゲーム番号 (1〜MAX_GAME_NUMBER)
 * @returns {{ cascades: object[][], freeCells: (object|null)[], foundations: object[][] }}
 */
export function dealGame(num) {
  const rand = msRng(num);
  const deck = [];
  for (let i = 0; i < 52; i++) {
    deck.push({ suit: i % 4, rank: Math.floor(i / 4) + 1, id: i });
  }
  const cascades = Array.from({ length: NUM_CASCADES }, () => []);
  // Microsoft 版と同じ「選んだカードを末尾と交換して取り出す」方式
  let n = deck.length;
  let col = 0;
  while (n > 0) {
    const j = rand() % n;
    const card = deck[j];
    deck[j] = deck[n - 1];
    n--;
    cascades[col].push(card);
    col = (col + 1) % NUM_CASCADES;
  }
  const freeCells = Array(NUM_FREE).fill(null);
  const foundations = Array.from({ length: NUM_HOME }, () => []);
  return { cascades, freeCells, foundations };
}
