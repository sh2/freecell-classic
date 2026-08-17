/* =========================================================
 * ソルバー Web Worker
 * メインスレッドをブロックせずに solve() を実行する。
 * 受信メッセージ: { board, maxNodes, maxTimeMs }
 * 送信メッセージ: solve() の結果 { solved, moves, nodes, timeMs, status }
 * ========================================================= */

import { solveWithFallback } from "./solver.js";

self.onmessage = (e) => {
  const { requestId, board, strategy, fastOptions, safeOptions } = e.data;
  const result = solveWithFallback(board, {
    strategy,
    fastOptions,
    safeOptions,
    onStageChange: (stage) => self.postMessage({ type: "stage", requestId, stage }),
  });
  self.postMessage({ type: "result", requestId, result });
};
