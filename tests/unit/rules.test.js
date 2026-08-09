import { describe, expect, it } from "vitest";
import {
  isRed,
  isValidSequence,
  foundationRank,
  foundationTargetFor,
  canDropOnHome,
  canDropOnCascade,
  maxMovable,
  canAutoHome,
  findCardLocation,
  isGrabbable,
} from "../../src/js/rules.js";
import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "../../src/js/constants.js";

/** テスト用カード。id = (rank-1)*4 + suit (suit: 0=♣, 1=♦, 2=♥, 3=♠) */
function card(rank, suit) {
  return { suit, rank, id: (rank - 1) * 4 + suit };
}

/** 空の盤面(カスケード 8 列・フリーセル 4・ホーム 4) */
function emptyZones() {
  return {
    cascades: Array.from({ length: NUM_CASCADES }, () => []),
    freeCells: Array(NUM_FREE).fill(null),
    foundations: Array.from({ length: NUM_HOME }, () => []),
  };
}

/** 指定ホーム列だけを持つ 4 列のホーム配列 */
function foundationsOf(piles) {
  return Array.from({ length: NUM_HOME }, (_, i) => piles[i] ?? []);
}

describe("isRed", () => {
  it("♦ と ♥ は赤", () => {
    expect(isRed(card(1, 1))).toBe(true);
    expect(isRed(card(7, 2))).toBe(true);
  });

  it("♣ と ♠ は黒", () => {
    expect(isRed(card(1, 0))).toBe(false);
    expect(isRed(card(13, 3))).toBe(false);
  });
});

describe("isValidSequence", () => {
  it("色交互の降順連続なら true", () => {
    expect(isValidSequence([card(10, 1), card(9, 0), card(8, 1)])).toBe(true); // 10♦ 9♣ 8♦
    expect(isValidSequence([card(10, 0), card(9, 2), card(8, 3), card(7, 1)])).toBe(true);
  });

  it("1 枚・空配列も true", () => {
    expect(isValidSequence([card(7, 0)])).toBe(true);
    expect(isValidSequence([])).toBe(true);
  });

  it("同色が連続すると false", () => {
    expect(isValidSequence([card(10, 1), card(9, 1)])).toBe(false); // 10♦ 9♦
  });

  it("ランクが連続でないと false", () => {
    expect(isValidSequence([card(8, 1), card(9, 0)])).toBe(false); // 昇順
    expect(isValidSequence([card(10, 1), card(8, 0)])).toBe(false); // 1 つ飛ばし
  });
});

describe("foundationRank", () => {
  it("ホームが空なら 0", () => {
    expect(foundationRank(foundationsOf([]), 0)).toBe(0);
    expect(foundationRank(foundationsOf([]), 3)).toBe(0);
  });

  it("指定スートのホームの先頭ランクを返す", () => {
    const f = foundationsOf([[card(1, 0), card(2, 0), card(3, 0)], [card(1, 1), card(2, 1)]]);
    expect(foundationRank(f, 0)).toBe(3);
    expect(foundationRank(f, 1)).toBe(2);
  });

  it("ホームにないスートは 0", () => {
    const f = foundationsOf([[card(1, 0)]]);
    expect(foundationRank(f, 2)).toBe(0);
  });
});

describe("canDropOnHome", () => {
  it("空ホームは A のみ受け入れる", () => {
    const f = foundationsOf([]);
    expect(canDropOnHome(f, card(1, 0), 0)).toBe(true);
    expect(canDropOnHome(f, card(2, 0), 0)).toBe(false);
  });

  it("同スートの次のランクのみ受け入れる", () => {
    const f = foundationsOf([[card(1, 0), card(2, 0)]]);
    expect(canDropOnHome(f, card(3, 0), 0)).toBe(true);
    expect(canDropOnHome(f, card(4, 0), 0)).toBe(false); // ランクが飛ぶ
    expect(canDropOnHome(f, card(3, 1), 0)).toBe(false); // 別スート
  });
});

describe("foundationTargetFor", () => {
  it("受け入れ可能なホームのインデックスを返す", () => {
    const f = foundationsOf([[card(1, 0), card(2, 0)], [card(1, 1)]]);
    expect(foundationTargetFor(f, card(3, 0))).toBe(0);
    expect(foundationTargetFor(f, card(2, 1))).toBe(1);
  });

  it("受け入れ可能なホームがなければ -1", () => {
    const f = foundationsOf([[card(1, 0), card(2, 0)]]);
    expect(foundationTargetFor(f, card(3, 1))).toBe(-1);
    expect(foundationTargetFor(f, card(2, 0))).toBe(-1); // すでに 2♣ がある
  });

  it("空ホームは A の行き先になる", () => {
    const f = foundationsOf([]);
    expect(foundationTargetFor(f, card(1, 3))).toBe(0);
    expect(foundationTargetFor(f, card(2, 3))).toBe(-1);
  });
});

describe("canDropOnCascade", () => {
  it("空列には任意のグループを置ける", () => {
    const z = emptyZones();
    expect(canDropOnCascade(z.cascades, [card(10, 1), card(9, 0)], 0)).toBe(true);
  });

  it("先頭カードが 1 ランク下かつ反対色なら true", () => {
    const z = emptyZones();
    z.cascades[0] = [card(9, 0)]; // 9♣
    expect(canDropOnCascade(z.cascades, [card(8, 1)], 0)).toBe(true); // 8♦
  });

  it("同色・ランク不一致は false", () => {
    const z = emptyZones();
    z.cascades[0] = [card(9, 0)]; // 9♣
    expect(canDropOnCascade(z.cascades, [card(8, 0)], 0)).toBe(false); // 8♣ 同色
    expect(canDropOnCascade(z.cascades, [card(7, 1)], 0)).toBe(false); // 7♦ ランク差
  });

  it("複数枚グループは先頭カードだけで判定する", () => {
    const z = emptyZones();
    z.cascades[0] = [card(9, 0)];
    expect(canDropOnCascade(z.cascades, [card(8, 1), card(7, 0)], 0)).toBe(true);
  });
});

describe("maxMovable", () => {
  it("空きセル・空き列がなければ 1", () => {
    const z = emptyZones();
    z.cascades = z.cascades.map((_, i) => [card(i + 1, 0)]);
    z.freeCells = [card(1, 0), card(2, 0), card(3, 0), card(4, 0)];
    expect(maxMovable(z.freeCells, z.cascades, 0)).toBe(1);
  });

  it("空きフリーセル 4 つなら 5 枚", () => {
    const z = emptyZones();
    z.cascades = z.cascades.map((_, i) => [card(i + 1, 0)]);
    z.freeCells = [null, null, null, null];
    expect(maxMovable(z.freeCells, z.cascades, 0)).toBe(5);
  });

  it("空き列は倍加する(移動先自身は除く)", () => {
    const z = emptyZones();
    z.cascades = z.cascades.map((_, i) => [card(i + 1, 0)]);
    z.cascades[1] = [];
    z.freeCells = [null, null, null, null];
    expect(maxMovable(z.freeCells, z.cascades, 1)).toBe(5); // 移動先自身は数えない
    expect(maxMovable(z.freeCells, z.cascades, 0)).toBe(10); // 別の空き列は数える
    expect(maxMovable(z.freeCells, z.cascades, null)).toBe(10); // 列指定なし
  });

  it("空きセル 2 + 空き列 1(移動先以外)なら 6 枚", () => {
    const z = emptyZones();
    z.cascades = z.cascades.map((_, i) => [card(i + 1, 0)]);
    z.cascades[2] = [];
    z.freeCells = [null, null, card(1, 0), card(2, 0)];
    expect(maxMovable(z.freeCells, z.cascades, 0)).toBe(6); // (2+1) * 2^1
  });
});

describe("canAutoHome", () => {
  it("A と 2 は常に安全", () => {
    expect(canAutoHome(foundationsOf([]), card(1, 0))).toBe(true);
    expect(canAutoHome(foundationsOf([]), card(2, 1))).toBe(true);
  });

  it("反対色ホームが 1 つでも足りなければ false", () => {
    // ♦ は 2、♥ は 1 → 3♣ の反対色 ♥ が 2 に届かない
    const f = foundationsOf([[card(1, 1), card(2, 1)], [card(1, 2)]]);
    expect(canAutoHome(f, card(3, 0))).toBe(false);
  });

  it("反対色ホームがすべて進んでいれば true", () => {
    const f = foundationsOf([[card(1, 1), card(2, 1)], [card(1, 2), card(2, 2)]]);
    expect(canAutoHome(f, card(3, 0))).toBe(true);
    expect(canAutoHome(f, card(4, 0))).toBe(false); // 4♣ には 3 が必要
  });

  it("同色ホームの進み具合は考慮しない", () => {
    // ♦ は 1 のままでも、反対色 ♣/♠ が 2 まで進んでいれば 3♦ は安全
    const f = foundationsOf([[card(1, 0), card(2, 0)], [card(1, 3), card(2, 3)], [card(1, 1)]]);
    expect(canAutoHome(f, card(3, 1))).toBe(true);
  });
});

describe("findCardLocation", () => {
  it("フリーセルのカードを free として見つける", () => {
    const z = emptyZones();
    z.freeCells[2] = card(5, 1);
    expect(findCardLocation(z, card(5, 1).id)).toEqual({ zone: "free", index: 2, cardIndex: 0 });
  });

  it("カスケードのカードを位置付きで見つける", () => {
    const z = emptyZones();
    z.cascades[3] = [card(10, 0), card(9, 1), card(8, 0)];
    expect(findCardLocation(z, card(9, 1).id)).toEqual({ zone: "cascade", index: 3, cardIndex: 1 });
  });

  it("ホームのカードを見つける", () => {
    const z = emptyZones();
    z.foundations[1] = [card(1, 1), card(2, 1)];
    expect(findCardLocation(z, card(2, 1).id)).toEqual({ zone: "home", index: 1 });
  });

  it("盤面にないカードは null", () => {
    expect(findCardLocation(emptyZones(), card(1, 0).id)).toBeNull();
  });
});

describe("isGrabbable", () => {
  it("フリーセルは常につかめる", () => {
    expect(isGrabbable([], { zone: "free", index: 0, cardIndex: 0 })).toBe(true);
  });

  it("ホームからは戻せない", () => {
    expect(isGrabbable([], { zone: "home", index: 0 })).toBe(false);
  });

  it("カスケードは先頭から連続していればつかめる", () => {
    const z = emptyZones();
    z.cascades[0] = [card(10, 1), card(9, 0), card(8, 1)];
    expect(isGrabbable(z.cascades, { zone: "cascade", index: 0, cardIndex: 1 })).toBe(true);
    expect(isGrabbable(z.cascades, { zone: "cascade", index: 0, cardIndex: 2 })).toBe(true);
  });

  it("連続していない位置はつかめない", () => {
    const z = emptyZones();
    z.cascades[0] = [card(10, 1), card(9, 1), card(8, 0)]; // 10♦ と 9♦ が同色
    expect(isGrabbable(z.cascades, { zone: "cascade", index: 0, cardIndex: 0 })).toBe(false);
    expect(isGrabbable(z.cascades, { zone: "cascade", index: 0, cardIndex: 1 })).toBe(true);
  });
});
