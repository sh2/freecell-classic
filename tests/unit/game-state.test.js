import { describe, expect, it } from "vitest";
import {
  attemptMove,
  autoMoveHome,
  autoMoveOne,
  checkWin,
  createState,
  dblClickAutoMove,
  hasAutoMove,
  isWon,
  normalizeGameNumber,
  undo,
} from "../../src/js/game-state.js";
import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "../../src/js/constants.js";
import { dealGame } from "../../src/js/deal.js";

/**
 * 状態遷移層 (game-state.js) の単体テスト。
 * DOM・時刻・表示に触れず、state オブジェクトの遷移だけを検証する。
 */

/** テスト用カード。id = (rank-1)*4 + suit (suit: 0=♣, 1=♦, 2=♥, 3=♠) */
function card(rank, suit) {
  return { suit, rank, id: (rank - 1) * 4 + suit };
}

/** id の配列をカードオブジェクトの配列へ変換する */
function cardsOf(ids) {
  return ids.map((id) => card(Math.floor(id / 4) + 1, id % 4));
}

/** 指定スートの 13 枚(A〜K)の id 配列 */
function fullPile(suit) {
  const pile = [];
  for (let r = 1; r <= 13; r++) {
    pile.push((r - 1) * 4 + suit);
  }
  return pile;
}

/** 盤面 fixture から状態を作る。ゾーン未指定は空で埋める */
function stateWith({ cascades = [], freeCells = [], foundations = [] } = {}) {
  const board = {
    cascades: Array.from({ length: NUM_CASCADES }, (_, i) => cardsOf(cascades[i] ?? [])),
    freeCells: Array.from({ length: NUM_FREE }, (_, i) => {
      const id = freeCells[i] ?? null;
      return id === null ? null : card(Math.floor(id / 4) + 1, id % 4);
    }),
    foundations: Array.from({ length: NUM_HOME }, (_, i) => cardsOf(foundations[i] ?? [])),
  };
  return createState(1, board);
}

/** 状態の盤面を id の配列に変換する(比較用) */
function idsOf(state) {
  return {
    cascades: state.cascades.map((pile) => pile.map((c) => c.id)),
    freeCells: state.freeCells.map((c) => (c ? c.id : null)),
    foundations: state.foundations.map((pile) => pile.map((c) => c.id)),
  };
}

describe("createState", () => {
  it("dealGame の盤面から新しい状態を作る", () => {
    const board = dealGame(12);
    const state = createState(12, board);
    expect(state.gameNumber).toBe(12);
    expect(state.moveCount).toBe(0);
    expect(state.historyStack).toEqual([]);
    expect(state.selected).toBeNull();
    expect(state.won).toBe(false);
    expect(state.cascades).toBe(board.cascades);
  });
});

describe("attemptMove", () => {
  it("カスケードの先頭 1 枚をフリーセルへ移動できる", () => {
    const state = createState(1, dealGame(1));
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    expect(res).toEqual({ ok: true });
    expect(idsOf(state).freeCells[0]).toBe(23); // 6S
    expect(idsOf(state).cascades[0]).toEqual([41, 49, 7, 12, 11, 21]);
    expect(state.moveCount).toBe(1);
    expect(state.historyStack.length).toBe(1);
    expect(state.selected).toBeNull();
  });

  it("成功手では手数と履歴が 1 ずつ増える", () => {
    const state = createState(1, dealGame(1));
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    attemptMove(state, { zone: "cascade", index: 3, cardIndex: 6 }, "free", 1);
    expect(state.moveCount).toBe(2);
    expect(state.historyStack.length).toBe(2);
    expect(idsOf(state).freeCells[0]).toBe(23);
    expect(idsOf(state).freeCells[1]).toBe(22); // 6H
  });

  it("フリーセルのカードをホームへ移動できる", () => {
    const state = stateWith({ freeCells: [0] }); // AC
    const res = attemptMove(state, { zone: "free", index: 0 }, "home", 0);
    expect(res).toEqual({ ok: true });
    expect(idsOf(state).foundations[0]).toEqual([0]);
    expect(state.freeCells[0]).toBeNull();
    expect(state.moveCount).toBe(1);
  });

  it("占領済みフリーセルへの移動は occupied で何も変わらない", () => {
    const state = stateWith({ cascades: [[23]], freeCells: [5] });
    const before = idsOf(state);
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "free", 0);
    expect(res).toEqual({ ok: false, reason: "occupied" });
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
    expect(state.historyStack.length).toBe(0);
  });

  it("ホームに置けないカードは invalid で何も変わらない", () => {
    const state = stateWith({ cascades: [[23]] }); // 6S
    const before = idsOf(state);
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "home", 0);
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
  });

  it("正しいホームが別にあればそちらへ誘導される", () => {
    const state = stateWith({ cascades: [[4]], foundations: [[0]] }); // 2C → ♣ ホームへ
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "home", 1);
    expect(res).toEqual({ ok: true });
    expect(idsOf(state).foundations[0]).toEqual([0, 4]);
    expect(state.moveCount).toBe(1);
  });

  it("カスケードへ色・ランク不一致のグループは置けない", () => {
    const state = stateWith({ cascades: [[23], [5]] }); // 6S を 2D の上へ
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "cascade", 1);
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(state.moveCount).toBe(0);
  });

  it("空のグループは invalid", () => {
    const state = stateWith({});
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "free", 0);
    expect(res).toEqual({ ok: false, reason: "invalid" });
    const res2 = attemptMove(state, { zone: "free", index: 0 }, "home", 0);
    expect(res2).toEqual({ ok: false, reason: "invalid" });
  });

  it("won の状態では finished で何も変わらない", () => {
    const state = stateWith({ cascades: [[23]] });
    state.won = true;
    const before = idsOf(state);
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "free", 0);
    expect(res).toEqual({ ok: false, reason: "finished" });
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
  });

  it("失敗手では選択状態も変わらない", () => {
    const state = stateWith({ cascades: [[23], [5]] });
    state.selected = { zone: "cascade", index: 0, cardIndex: 0 };
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "cascade", 1);
    expect(state.selected).toEqual({ zone: "cascade", index: 0, cardIndex: 0 });
  });

  it("成功手でも won は立てない(勝利判定は呼び出し側の責務)", () => {
    // 最終手で 52 枚目がホームに揃っても、attemptMove 自身は won を変更しない
    const state = stateWith({
      cascades: [[48]], // K♣
      foundations: [fullPile(0).slice(0, 12), fullPile(1), fullPile(2), fullPile(3)],
    });
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "home", 0);
    expect(res).toEqual({ ok: true });
    expect(state.won).toBe(false);
    expect(checkWin(state)).toBe(true);
  });
});

describe("複数枚移動", () => {
  it("Game #12 の 9D-8C を 2 枚まとめて移動できる", () => {
    const state = createState(12, dealGame(12));
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 5 }, "cascade", 7);
    expect(res).toEqual({ ok: true });
    expect(idsOf(state).cascades[0]).toEqual([25, 13, 45, 29, 35]);
    expect(idsOf(state).cascades[7]).toEqual([1, 27, 3, 34, 14, 36, 33, 28]);
    expect(state.moveCount).toBe(1);
    expect(state.historyStack.length).toBe(1);
  });

  it("枚数超過は too-many で limit を返し、何も変わらない", () => {
    // 6S..AH の 6 枚連続を 7D の上へ。空きセル 4・空き列 0 なので上限は 5 枚
    const state = stateWith({
      cascades: [[23, 18, 15, 10, 7, 1], [25], [3], [4], [5], [6], [7], [8]],
    });
    const before = idsOf(state);
    const res = attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "cascade", 1);
    expect(res).toEqual({ ok: false, reason: "too-many", limit: 5 });
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
  });
});

describe("undo", () => {
  it("直前の手を巻き戻すと盤面・手数・履歴が戻る", () => {
    const state = createState(1, dealGame(1));
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    expect(undo(state)).toBe(true);
    expect(idsOf(state).cascades[0]).toEqual([41, 49, 7, 12, 11, 21, 23]);
    expect(state.freeCells[0]).toBeNull();
    expect(state.moveCount).toBe(0);
    expect(state.historyStack.length).toBe(0);
  });

  it("2 手後の Undo は 1 手分だけ戻る", () => {
    const state = createState(1, dealGame(1));
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    attemptMove(state, { zone: "cascade", index: 3, cardIndex: 6 }, "free", 1);
    expect(undo(state)).toBe(true);
    expect(state.moveCount).toBe(1);
    expect(state.historyStack.length).toBe(1);
    expect(idsOf(state).freeCells[0]).toBe(23);
    expect(state.freeCells[1]).toBeNull();
  });

  it("選択中のカードは Undo で解除される", () => {
    const state = createState(1, dealGame(1));
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    state.selected = { zone: "cascade", index: 0, cardIndex: 5 };
    undo(state);
    expect(state.selected).toBeNull();
  });

  it("履歴が空なら false で何も変わらない", () => {
    const state = stateWith({ cascades: [[23]] });
    const before = idsOf(state);
    expect(undo(state)).toBe(false);
    expect(idsOf(state)).toEqual(before);
  });

  it("Undo は won フラグを変更しない(既存挙動を維持)", () => {
    const state = stateWith({ cascades: [[23]] });
    attemptMove(state, { zone: "cascade", index: 0, cardIndex: 0 }, "free", 0);
    state.won = true;
    undo(state);
    expect(state.won).toBe(true);
  });
});

describe("autoMoveHome", () => {
  it("Game #12 の AC をホームへ送る", () => {
    const state = createState(12, dealGame(12));
    expect(autoMoveHome(state).map((c) => c.id)).toEqual([0]);
    expect(idsOf(state).foundations.flat()).toContain(0);
    expect(idsOf(state).cascades[6]).toEqual([21, 37, 30, 26, 24]);
    expect(state.moveCount).toBe(1);
  });

  it("複数枚を送っても履歴はカード 1 枚単位で積まれる", () => {
    // 3C-2C-AC を ♣ ホーム(空)へ、♦/♥ は 2 まで積まれた状態
    const state = stateWith({
      cascades: [[8, 4, 0]],
      foundations: [[], [1, 5], [2, 6], [3, 7]],
    });
    // 積み上げの下から順番に送られる
    expect(autoMoveHome(state).map((c) => c.id)).toEqual([0, 4, 8]);
    expect(idsOf(state).foundations[0]).toEqual([0, 4, 8]);
    expect(idsOf(state).cascades[0]).toEqual([]);
    expect(state.moveCount).toBe(3);
    expect(state.historyStack.length).toBe(3);
  });

  it("1 枚ずつ Undo できる", () => {
    const state = stateWith({
      cascades: [[8, 4, 0]],
      foundations: [[], [1, 5], [2, 6], [3, 7]],
    });
    autoMoveHome(state);
    undo(state);
    expect(idsOf(state).foundations[0]).toEqual([0, 4]);
    expect(state.moveCount).toBe(2);
    undo(state);
    expect(idsOf(state).foundations[0]).toEqual([0]);
    expect(state.moveCount).toBe(1);
    undo(state);
    expect(idsOf(state).foundations[0]).toEqual([]);
    expect(state.moveCount).toBe(0);
  });

  it("送れるカードがなければ空配列で何も変わらない", () => {
    const state = createState(1, dealGame(1));
    const before = idsOf(state);
    expect(autoMoveHome(state)).toEqual([]);
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
  });

  it("won の状態では移動せず空配列", () => {
    const state = createState(12, dealGame(12));
    state.won = true;
    expect(autoMoveHome(state)).toEqual([]);
    expect(state.moveCount).toBe(0);
  });
});

describe("autoMoveOne", () => {
  it("フリーセル経由の 2 段階移動を正しい順序で 1 枚ずつ動かす", () => {
    // ♠1(id 3) の上に ♠2(id 7) が積まれた列で、♠2 をフリーセルへ退避済みの盤面。
    // ♠2 はまだホームへ行けない(♠A が無い)ため、先に ♠1 がホームへ行く。
    const state = stateWith({
      cascades: [[3]],
      freeCells: [7, null, null, null],
    });
    // 1 枚目: ♠1 がホームへ(最初の空きホーム index 0 に置かれる)
    expect(hasAutoMove(state)).toBe(true);
    expect(autoMoveOne(state).id).toBe(3);
    expect(idsOf(state).foundations[0]).toEqual([3]);
    // 2 枚目: 露出した ♠2 がフリーセルからホームへ
    expect(autoMoveOne(state).id).toBe(7);
    expect(idsOf(state).foundations[0]).toEqual([3, 7]);
    expect(idsOf(state).freeCells[0]).toBe(null);
    // 3 枚目以降は無い
    expect(hasAutoMove(state)).toBe(false);
    expect(autoMoveOne(state)).toBe(null);
  });

  it("won の状態では移動しない", () => {
    const state = stateWith({
      cascades: [[3]],
      freeCells: [7, null, null, null],
    });
    state.won = true;
    expect(hasAutoMove(state)).toBe(false);
    expect(autoMoveOne(state)).toBe(null);
    expect(state.moveCount).toBe(0);
  });
});

describe("dblClickAutoMove", () => {
  it("ホームへ行けるカードはホームへ移動する(ホーム優先)", () => {
    const state = createState(12, dealGame(12));
    const moved = dblClickAutoMove(state, { zone: "cascade", index: 6, cardIndex: 5 }); // AC
    expect(moved).toBe(true);
    expect(idsOf(state).foundations.flat()).toContain(0);
    expect(state.moveCount).toBe(1);
  });

  it("ホームへ行けないカードは空きフリーセルへ移動する", () => {
    const state = createState(1, dealGame(1));
    const moved = dblClickAutoMove(state, { zone: "cascade", index: 0, cardIndex: 6 }); // 6S
    expect(moved).toBe(true);
    expect(idsOf(state).freeCells).toContain(23);
    expect(idsOf(state).cascades[0]).toEqual([41, 49, 7, 12, 11, 21]);
    expect(state.moveCount).toBe(1);
  });

  it("ホームも空きフリーセルもなければ false で何も変わらない", () => {
    const state = stateWith({ cascades: [[23]], freeCells: [5, 6, 10, 14] });
    const before = idsOf(state);
    const moved = dblClickAutoMove(state, { zone: "cascade", index: 0, cardIndex: 0 }); // 6S
    expect(moved).toBe(false);
    expect(idsOf(state)).toEqual(before);
    expect(state.moveCount).toBe(0);
  });

  it("フリーセルのカードはフリーセル同士を移動しない", () => {
    const state = stateWith({ freeCells: [23, 5] });
    const moved = dblClickAutoMove(state, { zone: "free", index: 0 }); // 6S(ホームへは行けない)
    expect(moved).toBe(false);
    expect(idsOf(state).freeCells[0]).toBe(23);
    expect(state.moveCount).toBe(0);
  });

  it("先頭 1 枚以外は移動しない", () => {
    const state = createState(12, dealGame(12));
    const moved = dblClickAutoMove(state, { zone: "cascade", index: 0, cardIndex: 4 }); // 9H-9D-8C
    expect(moved).toBe(false);
    expect(state.moveCount).toBe(0);
  });
});

describe("勝利判定", () => {
  /** 全 52 枚がホームに揃った状態 */
  function wonState() {
    return stateWith({ foundations: [fullPile(0), fullPile(1), fullPile(2), fullPile(3)] });
  }

  it("全カードがホームに揃うと isWon が true になる", () => {
    expect(isWon(wonState())).toBe(true);
  });

  it("checkWin は勝利状態で won を true にして true を返す", () => {
    const state = wonState();
    expect(state.won).toBe(false);
    expect(checkWin(state)).toBe(true);
    expect(state.won).toBe(true);
  });

  it("未完成なら false で won は変わらない", () => {
    const state = createState(1, dealGame(1));
    expect(isWon(state)).toBe(false);
    expect(checkWin(state)).toBe(false);
    expect(state.won).toBe(false);
  });
});

describe("normalizeGameNumber", () => {
  it("有効な整数はそのまま返す", () => {
    expect(normalizeGameNumber("1")).toBe(1);
    expect(normalizeGameNumber("12")).toBe(12);
    expect(normalizeGameNumber("32000")).toBe(32000);
  });

  it("小数は小数点以下を切り捨てる", () => {
    expect(normalizeGameNumber("12.9")).toBe(12);
    expect(normalizeGameNumber("12.1")).toBe(12);
    expect(normalizeGameNumber("32000.9")).toBe(32000);
  });

  it("空値と空白のみは null", () => {
    expect(normalizeGameNumber("")).toBeNull();
    expect(normalizeGameNumber("  ")).toBeNull();
  });

  it("非数値は null", () => {
    expect(normalizeGameNumber("abc")).toBeNull();
    expect(normalizeGameNumber("12abc")).toBeNull();
    expect(normalizeGameNumber("NaN")).toBeNull();
  });

  it("範囲外は null", () => {
    expect(normalizeGameNumber("0")).toBeNull();
    expect(normalizeGameNumber("-5")).toBeNull();
    expect(normalizeGameNumber("32001")).toBeNull();
    expect(normalizeGameNumber("99999")).toBeNull();
  });

  it("前後の空白は許容する(現行の Number 変換と同じ)", () => {
    expect(normalizeGameNumber("  7  ")).toBe(7);
  });
});
