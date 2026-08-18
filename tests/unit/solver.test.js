import { describe, expect, it } from "vitest";
import {
  solve,
  formatMove,
  cardName,
  canonicalizeColumns,
  isSafeFoundationMove,
  solveWithFallback,
} from "../../src/js/solver.js";
import { dealGame } from "../../src/js/deal.js";
import { createState, attemptMove } from "../../src/js/game-state.js";
import { findCardLocation } from "../../src/js/rules.js";
import { NUM_CASCADES, NUM_FREE, NUM_HOME } from "../../src/js/constants.js";
import { createSolverWorkerHandler } from "../../src/js/solver.worker.js";

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

describe("列正規化", () => {
  it("列の順序だけを入れ替えた盤面は同じ正規化結果になる", () => {
    const a = canonicalizeColumns([[0, 5], [10], [], [20, 25]]);
    const b = canonicalizeColumns([[20, 25], [], [0, 5], [10]]);
    expect(b).toEqual(a);
  });

  it("列の境界が異なる盤面は同じカード集合でも別の結果になる", () => {
    const a = canonicalizeColumns([[0, 5], [10, 15]]);
    const b = canonicalizeColumns([[0, 10], [5, 15]]);
    expect(b).not.toEqual(a);
  });

  it("列内の順序を保持する", () => {
    const a = canonicalizeColumns([[0, 5], [10]]);
    const b = canonicalizeColumns([[5, 0], [10]]);
    expect(b).not.toEqual(a);
  });
});

describe("自動ホームの安全条件", () => {
  it("A は常に安全にホームへ送れる", () => {
    expect(isSafeFoundationMove(0, [0, 0, 0, 0])).toBe(true);
    expect(isSafeFoundationMove(1, [0, 0, 0, 0])).toBe(true);
  });

  it("2 は反対色の A が両方揃うまで安全ではない", () => {
    // ♣2。反対色は ♦ / ♥。
    expect(isSafeFoundationMove(4, [1, 0, 0, 0])).toBe(false);
    expect(isSafeFoundationMove(4, [1, 1, 1, 0])).toBe(true);
  });

  it("3 は反対色の 2 が両方揃うまで安全ではない", () => {
    // ♣3。反対色の両方が 2 まで進んだ場合だけ安全。
    expect(isSafeFoundationMove(8, [2, 1, 2, 0])).toBe(false);
    expect(isSafeFoundationMove(8, [2, 2, 2, 0])).toBe(true);
  });
});

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

describe("solveWithFallback: 二段階探索", () => {
  const solvedBoard = {
    cascades: [],
    freeCells: [],
    foundations: [fullPile(0), fullPile(1), fullPile(2), fullPile(3)],
  };

  it("高速モードで解けた場合は安全モードを実行しない", () => {
    const stages = [];
    const res = solveWithFallback(solvedBoard, {
      onStageChange: (stage) => stages.push(stage),
    });
    expect(res.solved).toBe(true);
    expect(res.finalMode).toBe("fast");
    expect(res.fallbackUsed).toBe(false);
    expect(stages).toEqual(["fast"]);
    expect(res.attempts.safe).toBeNull();
  });

  it("高速モードが未解決なら元盤面で安全モードへフォールバックする", () => {
    const stages = [];
    const board = {
      cascades: [[4]],
      freeCells: [],
      foundations: [],
    };
    const res = solveWithFallback(board, {
      fastOptions: { maxNodes: 1, maxTimeMs: 60000 },
      safeOptions: { maxNodes: 1, maxTimeMs: 60000 },
      onStageChange: (stage) => stages.push(stage),
    });
    expect(stages).toEqual(["fast", "safe"]);
    expect(res.fallbackUsed).toBe(true);
    expect(res.finalMode).toBe("safe");
    expect(res.totalNodes).toBe(res.attempts.fast.nodes + res.attempts.safe.nodes);
    expect(res.totalTimeMs).toBe(res.attempts.fast.timeMs + res.attempts.safe.timeMs);
  });

  it("安全モード単独ではフォールバック扱いにしない", () => {
    const res = solveWithFallback(solvedBoard, { strategy: "safe" });
    expect(res.finalMode).toBe("safe");
    expect(res.fallbackUsed).toBe(false);
    expect(res.attempts.fast).toBeNull();
  });

  it("未知の戦略を拒否する", () => {
    expect(() => solveWithFallback(solvedBoard, { strategy: "unknown" })).toThrow(
      "未知のソルバー戦略",
    );
  });

  it("Workerプロトコルは段階通知と結果通知を requestId 付きで送る", () => {
    const messages = [];
    const handler = createSolverWorkerHandler((message) => messages.push(message), () => {
      return {
        solved: true,
        status: "solved",
        moves: [],
        nodes: 2,
        timeMs: 3,
      };
    });
    handler({ data: { requestId: 42, board: solvedBoard, strategy: "fast-safe" } });
    expect(messages).toEqual([
      { type: "result", requestId: 42, result: expect.objectContaining({ status: "solved" }) },
    ]);

    messages.length = 0;
    const stagedHandler = createSolverWorkerHandler((message) => messages.push(message), (_board, options) => {
      options.onStageChange("fast");
      options.onStageChange("safe");
      return { solved: false, status: "node-limit", moves: [], nodes: 4, timeMs: 5 };
    });
    stagedHandler({ data: { requestId: 7, board: solvedBoard, strategy: "fast-safe" } });
    expect(messages[0]).toEqual({ type: "stage", requestId: 7, stage: "fast" });
    expect(messages[1]).toEqual({ type: "stage", requestId: 7, stage: "safe" });
    expect(messages[2].type).toBe("result");
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
    // ホームへの移動が 6 手。安全でないホーム移動を探索分岐に残すため、
    // 退避とホーム移動の順序によって手数は 7 手以上になり得る。
    const homeMoves = res.moves.filter((m) => m.destZone === "home");
    const branchMoves = res.moves.filter((m) => m.destZone !== "home");
    expect(homeMoves).toHaveLength(6);
    expect(branchMoves.length).toBeGreaterThanOrEqual(1);
    replayAndVerify(board, res.moves);
  });

  it("逆手除外の有効・無効で小規模盤面の解決可能性が一致する", () => {
    const board = {
      cascades: [[3, 10], [6, 11]],
      freeCells: [7, 2, null, null],
      foundations: [],
    };
    const pruned = solve(board, {
      maxNodes: 20000,
      maxTimeMs: 60000,
      disableReversePruning: false,
    });
    const unpruned = solve(board, {
      maxNodes: 20000,
      maxTimeMs: 60000,
      disableReversePruning: true,
    });
    expect(unpruned.solved).toBe(pruned.solved);
    if (unpruned.solved) {
      replayAndVerify(board, unpruned.moves);
    }
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

  it("安全モードの unsolvable はハッシュ衝突を無視した探索結果である", () => {
    const board = {
      cascades: [[5, 3]],
      freeCells: [],
      foundations: [],
    };
    const res = solve(board, {
      safeFoundationMoves: true,
      useAdmissibleBound: true,
      allowUnsolvable: true,
      maxNodes: 20000,
      maxTimeMs: 60000,
    });
    expect(res.solved).toBe(false);
    expect(res.status).toBe("unsolvable");
  });

  it("置換表の状態照合と探索統計を記録する", () => {
    const res = solve({ cascades: [[0]], freeCells: [], foundations: [] });
    expect(res.stats.transposition).toEqual(
      expect.objectContaining({
        capacity: expect.any(Number),
        used: expect.any(Number),
        loadFactor: expect.any(Number),
        maxProbe: expect.any(Number),
        overwrites: expect.any(Number),
      }),
    );
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
