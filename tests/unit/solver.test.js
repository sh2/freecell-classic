import { describe, expect, it } from "vitest";
import { solve, formatMove, cardName } from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";
import { createState, attemptMove } from "../../src/js/game-state.js";
import { findCardLocation } from "../../src/js/rules.js";
import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "../../src/js/constants.js";

/**
 * フリーセル ソルバー (solver.js) の単体テスト。
 * 盤面はカード id の配列で与え、探索結果の勝ち手順がゲームの
 * 状態遷移層 (attemptMove) で再現できることを確認する。
 */

/** id からカードオブジェクトを作る */
function card(id) {
  return { suit: id % 4, rank: Math.floor(id / 4) + 1, id };
}

/** 指定スートの A〜K(13 枚)の id 配列 */
function fullPile(suit) {
  const pile = [];
  for (let r = 1; r <= 13; r++) {
    pile.push((r - 1) * 4 + suit);
  }
  return pile;
}

/** id の盤面をカードオブジェクトの盤面へ変換する(state 生成用) */
function boardWithIds({ cascades = [], freeCells = [], foundations = [] } = {}) {
  return {
    cascades: Array.from({ length: NUM_CASCADES }, (_, i) => (cascades[i] ?? []).map(card)),
    freeCells: Array.from({ length: NUM_FREE }, (_, i) => {
      const id = freeCells[i] ?? null;
      return id === null ? null : card(id);
    }),
    foundations: Array.from({ length: NUM_HOME }, (_, i) => (foundations[i] ?? []).map(card)),
  };
}

/** id の盤面に含まれるカード総数 */
function countCardsInBoard(board) {
  let n = 0;
  for (const pile of board.cascades ?? []) {
    n += pile.length;
  }
  for (const id of board.freeCells ?? []) {
    if (id !== null) {
      n++;
    }
  }
  for (const pile of board.foundations ?? []) {
    n += pile.length;
  }
  return n;
}

/** 勝ち手順を state に適用し、実際に全カードがホームへ揃うことを検証する */
function replayAndVerify(board, moves) {
  const state = createState(1, boardWithIds(board));
  for (const mv of moves) {
    const loc = findCardLocation(state, mv.cardId);
    expect(loc).not.toBeNull();
    const res = attemptMove(state, loc, mv.destZone, mv.destIndex);
    expect(res.ok).toBe(true);
  }
  const homeCount = state.foundations.reduce((n, p) => n + p.length, 0);
  expect(homeCount).toBe(countCardsInBoard(board));
}

describe("solve: 勝利済みの盤面", () => {
  it("全カードがホームに揃っていれば 0 手で解ける", () => {
    const board = {
      cascades: [],
      freeCells: [],
      foundations: [fullPile(0), fullPile(1), fullPile(2), fullPile(3)],
    };
    const res = solve(board);
    expect(res.solved).toBe(true);
    expect(res.status).toBe("solved");
    expect(res.moves).toEqual([]);
  });

  it("空の盤面(0 枚)も 0 手で解ける", () => {
    const res = solve({ cascades: [], freeCells: [], foundations: [] });
    expect(res.solved).toBe(true);
    expect(res.moves).toEqual([]);
  });
});

describe("solve: 自動ホーム", () => {
  it("あと 1 手の盤面は 1 手で解ける", () => {
    // ♠ が A〜Q までホームにあり、♠K(id 51) がフリーセルにある
    const board = {
      cascades: [],
      freeCells: [null, null, null, 51],
      foundations: [fullPile(0), fullPile(1), fullPile(2), fullPile(3).slice(0, 12)],
    };
    const res = solve(board);
    expect(res.solved).toBe(true);
    expect(res.moves).toHaveLength(1);
    expect(res.moves[0].cardId).toBe(51);
    expect(res.moves[0].destZone).toBe("home");
    replayAndVerify(board, res.moves);
  });

  it("4 枚の A がフリーセルにあれば 4 手でホームへ送られる", () => {
    const board = {
      cascades: [],
      freeCells: [0, 1, 2, 3], // ♣A, ♦A, ♥A, ♠A
      foundations: [],
    };
    const res = solve(board);
    expect(res.solved).toBe(true);
    expect(res.moves).toHaveLength(4);
    expect(res.moves.every((m) => m.destZone === "home")).toBe(true);
    replayAndVerify(board, res.moves);
  });
});

describe("solve: 分岐手(退避)が必要な盤面", () => {
  it("先頭カードを退避して A を露出させると解ける", () => {
    // col0 [♠A, ♥3]: 先頭 ♥3 が ♠A を隠している
    // col1 [♥2, ♠3]: 先頭 ♠3 が ♥2 を隠している
    // free: ♠2, ♥A。♥A だけホームへ送った後、♥3 を空き列(またはフリーセル)へ
    // 退避して ♠A を露出 → 残りは自動ホームで連鎖する。
    const board = {
      cascades: [[3, 10], [6, 11]],
      freeCells: [7, 2, null, null],
      foundations: [],
    };
    const res = solve(board);
    expect(res.solved).toBe(true);
    expect(res.moves).toHaveLength(7);
    // ホームへの移動が 6 手、退避(非ホーム)が 1 手
    const homeMoves = res.moves.filter((m) => m.destZone === "home");
    const branchMoves = res.moves.filter((m) => m.destZone !== "home");
    expect(homeMoves).toHaveLength(6);
    expect(branchMoves).toHaveLength(1);
    expect(branchMoves[0].cardId).toBe(10); // ♥3 の退避
    replayAndVerify(board, res.moves);
  });
});

describe("solve: 実ゲーム", () => {
  it("Game #1 を解き、勝ち手順が再現できる", () => {
    const board = {
      cascades: dealGame(1).cascades.map((p) => p.map((c) => c.id)),
      freeCells: [null, null, null, null],
      foundations: [],
    };
    const res = solve(board, { maxNodes: 2000000, maxTimeMs: 30000 });
    expect(res.solved).toBe(true);
    replayAndVerify(board, res.moves);
  });
});

describe("solve: 解けない盤面と上限", () => {
  it("必要な下位カードが無い盤面は解けない(unsolvable)と判定される", () => {
    // col0 [♦2, ♠A]: ♠A はホームへ送られるが ♦2 は ♦A が無く詰む。
    // 列正規化により状態空間が小さく、全状態を探索し尽くして「解けない」と
    // 完全に証明できる(unsolvable を返す)。
    const board = {
      cascades: [[5, 3]],
      freeCells: [],
      foundations: [],
    };
    const res = solve(board, { maxNodes: 20000, maxTimeMs: 60000 });
    expect(res.solved).toBe(false);
    expect(res.status).toBe("unsolvable");
    expect(res.moves).toEqual([]);
  });

  it("探索ノード上限に達すると node-limit を返す", () => {
    const board = {
      cascades: dealGame(1).cascades.map((p) => p.map((c) => c.id)),
      freeCells: [null, null, null, null],
      foundations: [],
    };
    const res = solve(board, { maxNodes: 1000, maxTimeMs: 60000 });
    expect(res.solved).toBe(false);
    expect(res.status).toBe("node-limit");
  });
});

describe("solve: 決定的な結果", () => {
  it("同じ盤面を 2 回解いても同じ結果になる(経過時間は除く)", () => {
    const board = {
      cascades: dealGame(12).cascades.map((p) => p.map((c) => c.id)),
      freeCells: [null, null, null, null],
      foundations: [],
    };
    const pick = (r) => ({ solved: r.solved, status: r.status, moves: r.moves, nodes: r.nodes });
    const a = solve(board, { maxNodes: 5000 });
    const b = solve(board, { maxNodes: 5000 });
    expect(pick(a)).toEqual(pick(b));
  });
});

describe("cardName / formatMove", () => {
  it("カード id を表示名に変換できる", () => {
    expect(cardName(0)).toBe("♣A");
    expect(cardName(51)).toBe("♠K");
    expect(cardName(12)).toBe("♣4");
  });

  it("手を表示用文字列に変換できる", () => {
    expect(formatMove({ cardId: 0, destZone: "home", destIndex: 0, count: 1 })).toBe("♣A → ホーム");
    expect(formatMove({ cardId: 51, destZone: "free", destIndex: 2, count: 1 })).toBe("♠K → フリーセル3");
    expect(formatMove({ cardId: 51, destZone: "cascade", destIndex: 0, count: 3 })).toBe("♠K → 列1(3枚)");
  });
});
