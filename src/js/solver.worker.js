/* =========================================================
 * ソルバー Web Worker
 * メインスレッドをブロックせずに solve() を実行する。
 * 受信メッセージ: { board, maxNodes, maxTimeMs }
 * 送信メッセージ: solve() の結果 { solved, moves, nodes, timeMs, status }
 * ========================================================= */

import { solve } from "./solver.js";

self.onmessage = (e) => {
  const { board, maxNodes, maxTimeMs } = e.data;
  const result = solve(board, { maxNodes, maxTimeMs });
  self.postMessage(result);
};
