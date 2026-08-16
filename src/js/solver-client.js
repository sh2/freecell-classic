/* =========================================================
 * ソルバー UI クライアント
 * Web Worker で solver.solve() を実行し、結果の解答手順を
 * 表示・再生する。DOM への書き込みは view へ委譲する。
 * ========================================================= */

import * as rules from "./rules.js";
import { formatMove } from "./solver.js";

/** ソルバークライアントを生成する */
export function createSolverClient({ app, view }) {
  let worker = null;
  let solution = null;

  /** 現在の盤面をカード id の配列へ変換する(solver の入力形式) */
  function boardFromState() {
    const s = app.getState();
    return {
      cascades: s.cascades.map((p) => p.map((c) => c.id)),
      freeCells: s.freeCells.map((c) => (c ? c.id : null)),
      foundations: s.foundations.map((p) => p.map((c) => c.id)),
    };
  }

  function stopWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  /** 解答の 1 手を現在の状態に適用する */
  function applyMove(mv) {
    const state = app.getState();
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return false;
    }
    return app.applyMoveInstant(loc, mv.destZone, mv.destIndex).ok;
  }

  /** 解答手順を 1 手ずつ再生する(自動ホームは無効化して順序を保つ) */
  function replaySolution() {
    if (!solution || solution.length === 0) {
      return false;
    }
    app.setAutoMoveEnabled(false);
    let ok = true;
    for (const mv of solution) {
      if (!applyMove(mv)) {
        ok = false;
        break;
      }
    }
    app.setAutoMoveEnabled(true);
    return ok;
  }

  /** 解答を計算する。autoPlay が true なら完了後に自動再生する */
  function requestSolution({ autoPlay }) {
    if (worker) {
      return; // 計算中
    }
    stopWorker();
    view.setSolverBusy(true);
    worker = new Worker(new URL("./solver.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const res = e.data;
      stopWorker();
      view.setSolverBusy(false);
      if (res.solved && res.moves.length > 0) {
        solution = res.moves;
        view.showSolution(res.moves.map((mv) => formatMove(mv)));
        if (autoPlay) {
          replaySolution();
        }
      } else if (res.solved) {
        view.showToast("すでにクリア済みです");
      } else if (res.status === "time-limit") {
        view.showToast("時間内に解けませんでした");
      } else if (res.status === "node-limit") {
        view.showToast("探索上限に達しました");
      } else {
        view.showToast("解けませんでした");
      }
    };
    worker.onerror = () => {
      stopWorker();
      view.setSolverBusy(false);
      view.showToast("ソルバーでエラーが発生しました");
    };
    worker.postMessage({ board: boardFromState(), maxNodes: 2000000, maxTimeMs: 60000 });
  }

  function cancel() {
    stopWorker();
    view.setSolverBusy(false);
  }

  return {
    requestSolution,
    replaySolution,
    cancel,
    hasSolution: () => solution !== null,
    clearSolution: () => {
      solution = null;
    },
  };
}
