/* =========================================================
 * ソルバー UI クライアント
 * Web Worker で solver.solve() を実行し、結果の解答手順を
 * 表示・再生する。DOM への書き込みは view へ委譲する。
 * ヒント: 次の一手だけをハイライト+トーストで表示(解答パネルは出さない)。
 * 自動解答: トグルONで解を探索→1手ずつ飛行アニメーションで再生→完了後に全手順パネル表示。
 * 自動解答中は盤面操作をブロックする(app.setAutoSolving)。
 * ========================================================= */

import * as rules from "./rules.js";
import { formatMove } from "./solver.js";

/** ソルバークライアントを生成する */
export function createSolverClient({ app, view }) {
  let worker = null;
  let solution = null;
  let nextRequestId = 1;
  let activeRequest = null;
  let autoSolving = false;
  let replayTimer = null;
  let replayIndex = 0;
  let replayMoves = null;
  let savedAutoMoveEnabled = true;

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

  function boardSnapshot(board) {
    return JSON.stringify(board);
  }

  /** ソルバーUIのbusy状態を mode(hint/auto)付きで view へ伝える */
  function setBusy(busy) {
    // finishAutoSolve 直後は autoSolving が false のため "hint" に倒れるのを防ぐ
    // → 自動解答の終了時は呼び出し側で view.setSolverBusy(false,"auto") を直接呼ぶ
    const mode = (activeRequest && activeRequest.autoPlay) || autoSolving ? "auto" : "hint";
    view.setSolverBusy(busy, mode);
  }

  function clearReplayTimer() {
    if (replayTimer !== null) {
      clearTimeout(replayTimer);
      replayTimer = null;
    }
  }

  function finishAutoSolve() {
    autoSolving = false;
    app.setAutoSolving(false);
    // トグルをOFFに戻す
    const toggle = document.getElementById("auto-solve-toggle");
    if (toggle) {
      toggle.checked = false;
    }
    // 自動ホーム送りを元に戻す
    app.setAutoMoveEnabled(savedAutoMoveEnabled);
    view.setSolverBusy(false, "auto");
    clearReplayTimer();
    replayMoves = null;
  }

  function cancelReplay() {
    clearReplayTimer();
    replayMoves = null;
    replayIndex = 0;
  }

  /** トグルOFFや新規ゲームで自動解答を中断する */
  function cancelAutoSolve() {
    // 再生中 → ラベル復元を含め finishAutoSolve で一括終了
    if (autoSolving && !activeRequest) {
      clearReplayTimer();
      replayMoves = null;
      replayIndex = 0;
      finishAutoSolve();
      return;
    }
    // 計算中に再生が始まっていた場合の保険（通常は到達しない）
    if (autoSolving && activeRequest && activeRequest.autoPlay) {
      clearReplayTimer();
      replayMoves = null;
      replayIndex = 0;
    }
    if (activeRequest && activeRequest.autoPlay) {
      activeRequest = null;
      stopWorker();
      const toggle = document.getElementById("auto-solve-toggle");
      if (toggle) {
        toggle.checked = false;
      }
      if (autoSolving) {
        finishAutoSolve();
      } else {
        view.setSolverBusy(false, "auto");
      }
    } else if (autoSolving) {
      finishAutoSolve();
    } else {
      clearReplayTimer();
      replayMoves = null;
      replayIndex = 0;
    }
  }

  /** 解答の 1 手を現在の状態に適用する(即時) */
  function applyMove(mv) {
    const state = app.getState();
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return false;
    }
    return app.applyMoveInstant(loc, mv.destZone, mv.destIndex).ok;
  }

  /** 解答の 1 手をアニメーション付きで適用する */
  function applyMoveAnimated(mv) {
    const state = app.getState();
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return false;
    }
    if (typeof app.applyMoveAnimated === "function") {
      return app.applyMoveAnimated(loc, mv.destZone, mv.destIndex).ok;
    }
    return app.applyMoveInstant(loc, mv.destZone, mv.destIndex).ok;
  }

  /** 解答手順を 1 手ずつ再生する(自動ホームは無効化して順序を保つ) - 旧API互換(即時再生) */
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

  /** アニメーション付きで1手ずつ再生する(250ms待機を挟む)。完了後に全手順パネル表示 */
  function startAnimatedReplay(moves) {
    if (!moves || moves.length === 0) {
      finishAutoSolve();
      return;
    }
    replayMoves = moves;
    replayIndex = 0;
    // 自動ホーム送りは無効化してソルバーの手順通りに進める（元の設定を保存）
    savedAutoMoveEnabled = typeof app.getAutoMoveEnabled === "function" ? app.getAutoMoveEnabled() : true;
    app.setAutoMoveEnabled(false);
    autoSolving = true;
    app.setAutoSolving(true);
    view.setSolverStage("replay"); // ラベルを「自動解答中…」に

    const step = () => {
      if (!autoSolving || !replayMoves) {
        return;
      }
      if (replayIndex >= replayMoves.length) {
        // 完了: 全手順パネルを表示してトグルOFF
        view.showSolution(replayMoves.map((mv) => formatMove(mv)));
        finishAutoSolve();
        return;
      }
      const mv = replayMoves[replayIndex];
      const ok = applyMoveAnimated(mv);
      replayIndex += 1;
      if (!ok) {
        view.showToast("自動解答の再生に失敗しました");
        finishAutoSolve();
        return;
      }
      // 勝利していたら即座に完了(残り手順は不要)
      if (app.getState().won) {
        view.showSolution(replayMoves.map((m) => formatMove(m)));
        finishAutoSolve();
        return;
      }
      // 飛行完了後に250ms待って次へ
      view.runAfterAnimations(() => {
        if (!autoSolving) {
          return;
        }
        clearReplayTimer();
        replayTimer = setTimeout(step, 250);
      });
    };
    step();
  }

  function showHintMove(mv) {
    const line = formatMove(mv);
    view.showHint(mv);
    view.showToast(`ヒント: ${line}`);
  }

  /** 解答を計算する。autoPlay が true なら完了後に自動再生(アニメ付き)する */
  function requestSolution({ autoPlay }) {
    if (worker) {
      return; // 計算中
    }
    // ヒントは解答パネルを出さない・トースト+ハイライトのみ
    // 自動解答はトグルON状態で開始される想定
    stopWorker();
    const board = boardFromState();
    const requestId = nextRequestId++;
    activeRequest = { requestId, snapshot: boardSnapshot(board), autoPlay };
    if (autoPlay) {
      savedAutoMoveEnabled = typeof app.getAutoMoveEnabled === "function" ? app.getAutoMoveEnabled() : true;
    }
    setBusy(true);
    if (autoPlay) {
      autoSolving = true;
      app.setAutoSolving(true);
      const toggle = document.getElementById("auto-solve-toggle");
      if (toggle) {
        toggle.checked = true;
      }
    }
    worker = new Worker(new URL("./solver.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const res = e.data;
      if (!activeRequest || res.requestId !== activeRequest.requestId) {
        return;
      }
      if (res.type === "stage") {
        view.setSolverStage(res.stage);
        return;
      }
      if (res.type !== "result") {
        return;
      }
      const request = activeRequest;
      activeRequest = null;
      stopWorker();
      // ヒントの場合は busy 解除をここで行う。自動解答は再生完了まで busy 維持
      if (!request.autoPlay) {
        setBusy(false);
      }
      if (boardSnapshot(boardFromState()) !== request.snapshot) {
        if (request.autoPlay) {
          finishAutoSolve();
        }
        return;
      }
      const result = res.result;
      if (result.solved && result.moves.length > 0) {
        solution = result.moves;
        if (request.autoPlay) {
          startAnimatedReplay(result.moves);
        } else {
          showHintMove(result.moves[0]);
        }
      } else if (result.solved) {
        if (request.autoPlay) {
          finishAutoSolve();
        }
        view.showToast("すでにクリア済みです");
      } else {
        if (request.autoPlay) {
          finishAutoSolve();
        }
        view.showToast("探索上限内では解答を発見できませんでした");
      }
    };
    worker.onerror = () => {
      const wasAuto = activeRequest ? activeRequest.autoPlay : false;
      activeRequest = null;
      stopWorker();
      if (wasAuto) {
        finishAutoSolve();
      } else {
        setBusy(false);
      }
      view.showToast("ソルバーでエラーが発生しました");
    };
    worker.postMessage({
      type: "solve",
      requestId,
      board,
      strategy: "fast-safe",
    });
  }

  function cancel() {
    if (autoSolving) {
      cancelAutoSolve();
      return;
    }
    const wasAuto = Boolean(activeRequest && activeRequest.autoPlay);
    clearReplayTimer();
    replayMoves = null;
    replayIndex = 0;
    activeRequest = null;
    stopWorker();
    view.setSolverBusy(false, wasAuto ? "auto" : "hint");
  }

  function isAutoSolving() {
    return autoSolving;
  }

  return {
    requestSolution,
    replaySolution,
    cancel,
    cancelAutoSolve,
    isAutoSolving,
    hasSolution: () => solution !== null,
    clearSolution: () => {
      solution = null;
    },
  };
}
