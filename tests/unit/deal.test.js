import { describe, expect, it } from "vitest";
import { NUM_CASCADES, NUM_HOME } from "../../src/js/constants.js";
import { dealGame, msRng } from "../../src/js/deal.js";

/** 盤面のカードを id の配列に変換する(比較用) */
function idsOf(board) {
  return {
    cascades: board.cascades.map((pile) => pile.map((card) => card.id)),
    freeCells: board.freeCells.map((card) => (card ? card.id : null)),
    foundations: board.foundations.map((pile) => pile.map((card) => card.id)),
  };
}

describe("dealGame", () => {
  it("Game #1 が Microsoft FreeCell 互換の配置になる", () => {
    const board = dealGame(1);
    expect(idsOf(board).cascades).toEqual([
      [41, 49, 7, 12, 11, 21, 23], // JD KD 2S 4C 3S 6D 6S
      [5, 48, 51, 16, 37, 31, 32], // 2D KC KS 5C 10D 8S 9C
      [34, 35, 33, 39, 15, 29, 6], // 9H 9S 9D 10S 4S 8D 2H
      [40, 19, 45, 46, 38, 47, 22], // JC 5S QD QH 10H QS 6H
      [17, 1, 43, 14, 30, 20], // 5D AD JS 4H 8H 6C
      [26, 44, 3, 0, 4, 9], // 7H QC AS AC 2C 3D
      [24, 50, 2, 13, 42, 28], // 7C KH AH 4D JH 8C
      [18, 10, 8, 27, 25, 36], // 5H 3H 3C 7S 7D 10C
    ]);
  });

  it("52 枚すべてが一意で、各カードの suit/rank が id と一致する", () => {
    const board = dealGame(1);
    const all = board.cascades.flat();
    expect(all.length).toBe(52);
    expect(new Set(all.map((card) => card.id)).size).toBe(52);
    for (const card of all) {
      expect(card.suit).toBe(card.id % 4);
      expect(card.rank).toBe(Math.floor(card.id / 4) + 1);
    }
  });

  it("列長は 7,7,7,7,6,6,6,6 で、フリーセルとホームは空", () => {
    const board = dealGame(1);
    expect(board.cascades.map((pile) => pile.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(board.freeCells).toEqual([null, null, null, null]);
    expect(board.foundations).toEqual([[], [], [], []]);
  });

  it("同じゲーム番号からは常に同じ配置が生成される(決定性)", () => {
    expect(idsOf(dealGame(12))).toEqual(idsOf(dealGame(12)));
    expect(idsOf(dealGame(32000))).toEqual(idsOf(dealGame(32000)));
  });

  it("呼び出しごとに新しい配列を返し、互いの参照を共有しない", () => {
    const a = dealGame(1);
    const b = dealGame(1);
    expect(a).not.toBe(b);
    expect(a.cascades).not.toBe(b.cascades);
    expect(a.freeCells).not.toBe(b.freeCells);
    expect(a.foundations).not.toBe(b.foundations);
    for (let i = 0; i < NUM_CASCADES; i++) {
      expect(a.cascades[i]).not.toBe(b.cascades[i]);
    }
    for (let i = 0; i < NUM_HOME; i++) {
      expect(a.foundations[i]).not.toBe(b.foundations[i]);
    }
    // 返り値の配列を書き換えても他の盤面へ影響しない
    a.cascades[0].length = 0;
    expect(b.cascades[0]).toHaveLength(7);
  });

  it("番号ごとに異なる配置が生成される", () => {
    expect(idsOf(dealGame(1))).not.toEqual(idsOf(dealGame(2)));
  });
});

describe("msRng", () => {
  it("同じシードから同じ数列を生成し、別シードとは異なる", () => {
    const seq = (seed) => {
      const rand = msRng(seed);
      return Array.from({ length: 5 }, () => rand());
    };
    expect(seq(1)).toEqual(seq(1));
    expect(seq(1)).not.toEqual(seq(2));
  });
});
