/* =========================================================
 * ソルバー Web Worker
 * メインスレッドをブロックせずに solve() を実行する。
 * 受信メッセージ: { board, maxNodes, maxTimeMs }
 * 送信メッセージ: solve() の結果 { solved, moves, nodes, timeMs, status }
 * ========================================================= */

import { solveWithFallback } from "./solver.js";

export function createSolverWorkerHandler(postMessage, solve = solveWithFallback) {
  return (e) => {
    const { requestId, board, strategy } = e.data;
    const result = solve(board, {
      strategy,
      onStageChange: (stage) => postMessage({ type: "stage", requestId, stage }),
    });
    postMessage({ type: "result", requestId, result });
  };
}

if (typeof self !== "undefined") {
  self.onmessage = createSolverWorkerHandler((message) => self.postMessage(message));
}
