/* =========================================================
 * ソルバー UI クライアント
 * Web Worker で solver.solve() を実行し、結果の解答手順を
 * 表示・再生する。DOM への書き込みは view へ委譲する。
 * ヒント: 次の一手だけをハイライト+トーストで表示。
 * 自動解答: トグルONで解を探索→1手ずつ飛行アニメーションで再生→完了後は通常の
 * 勝利フロー(カスケード→クリアモーダル)に任せる。
 * 自動解答中は盤面操作をブロックする(app.setAutoSolving)。
 * ========================================================= */

import * as rules from "./rules.js";
import { formatMove } from "./solver.js";
import { boardFingerprint, buildSolutionCacheEntry, findProgressIndex } from "./solution-cache.js";
import { groupFrom } from "./game-state.js";

/** ソルバークライアントを生成する */
export function createSolverClient({ app, view }) {
  let worker = null;
  let cacheEntry = null; // 直近の解のキャッシュ({ boards, moves })。エントリは常に 1 つ
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

  /** トグルOFFや新規ゲームで自動解答を中断する */
  function cancelAutoSolve() {
    // 自動解答の計算(activeRequest)と再生(replayMoves)を停止してアイドルへ戻す。
    // 計算中は Worker を止めて activeRequest をクリアし、再生中は finishAutoSolve
    // がラベル復元・トグルOFF・自動ホーム送りの復元まで一括で行う。
    if (activeRequest && activeRequest.autoPlay) {
      activeRequest = null;
      stopWorker();
    }
    if (autoSolving) {
      finishAutoSolve();
    } else {
      clearReplayTimer();
      replayMoves = null;
      replayIndex = 0;
    }
  }

  /** 解答の 1 手をアニメーション付きで適用する */
  function applyMoveAnimated(mv) {
    const state = app.getState();
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return false;
    }
    return app.applyMoveAnimated(loc, mv.destZone, mv.destIndex).ok;
  }

  /** アニメーション付きで1手ずつ再生する(250ms待機を挟む)。完了時は finishAutoSolve のみ */
  function startAnimatedReplay(moves) {
    if (!moves || moves.length === 0) {
      finishAutoSolve();
      return;
    }
    replayMoves = moves;
    replayIndex = 0;
    // 自動ホーム送りは無効化してソルバーの手順通りに進める（元の設定を保存）
    savedAutoMoveEnabled = app.getAutoMoveEnabled();
    app.setAutoMoveEnabled(false);
    autoSolving = true;
    app.setAutoSolving(true);
    view.setSolverStage("replay"); // ラベルを「自動解答中…」に

    const step = () => {
      if (!autoSolving || !replayMoves) {
        return;
      }
      if (replayIndex >= replayMoves.length) {
        // 完了: トグルOFF(勝利演出は app 側の勝利判定に任せる)
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

  /** キャッシュ先頭手の防御チェック。現在盤面に対して合法なら count を
   *  再計算した手を返し、違えば null を返す(設計 4.4) */
  function validatedCachedMove(mv) {
    const state = app.getState();
    const loc = rules.findCardLocation(state, mv.cardId);
    if (!loc || loc.zone === "home") {
      return null;
    }
    const group = groupFrom(state, loc);
    if (mv.destZone === "free") {
      if (group.length !== 1 || state.freeCells[mv.destIndex] !== null) {
        return null;
      }
    } else if (mv.destZone === "home") {
      // 指定ホームが受け入れ不可でも attemptMove が別 home へ誘導するため、
      // ここでは行き先さえあればよく、destIndex の再解決は不要
      if (group.length !== 1 || rules.foundationTargetFor(state.foundations, group[0]) < 0) {
        return null;
      }
    } else {
      if (
        !rules.canDropOnCascade(state.cascades, group, mv.destIndex) ||
        group.length > rules.maxMovable(state.freeCells, state.cascades, mv.destIndex)
      ) {
        return null;
      }
    }
    return { ...mv, count: group.length };
  }

  /** 現在盤面のキャッシュ照合(設計 4.3)。残り手順を返すか、
   *  供給できなければキャッシュを破棄して null を返す */
  function takeFromCache(board) {
    if (!cacheEntry) {
      return null;
    }
    const j = findProgressIndex(cacheEntry, board);
    // 勝利盤面(最終盤面)は供給対象外として破棄する
    if (j < 0 || j === cacheEntry.boards.length - 1) {
      cacheEntry = null;
      return null;
    }
    const remaining = cacheEntry.moves.slice(j);
    const first = validatedCachedMove(remaining[0]);
    if (!first) {
      cacheEntry = null;
      return null;
    }
    remaining[0] = first;
    return remaining;
  }

  /** 解答を計算する。autoPlay が true なら完了後に自動再生(アニメ付き)する */
  function requestSolution({ autoPlay }) {
    if (worker) {
      return; // 計算中
    }
    // キャッシュ照合(設計 4.3): 現在盤面が解パス上にあれば Worker を起動せず供給する
    const board = boardFromState();
    const cached = takeFromCache(board);
    if (cached) {
      if (autoPlay) {
        // 自動解答のキャッシュヒット: 既存の Worker パスと同じ事前準備をしてから
        // 再生する。busy 表示は直上の setBusy() が担当し、自動ホーム送りの
        // 一時無効化とステージ表示は startAnimatedReplay 側が行う
        savedAutoMoveEnabled = app.getAutoMoveEnabled();
        autoSolving = true;
        app.setAutoSolving(true);
        setBusy(true); // autoSolving 済みなので mode は "auto" になる
        const toggle = document.getElementById("auto-solve-toggle");
        if (toggle) {
          toggle.checked = true;
        }
        startAnimatedReplay(cached);
      } else {
        // ヒント: 同期で表示する(busy 表示なし・Worker 起動なし)
        showHintMove(cached[0]);
      }
      return;
    }
    // ヒントはトースト+ハイライトのみ
    // 自動解答はトグルON状態で開始される想定
    stopWorker();
    const requestId = nextRequestId++;
    activeRequest = { requestId, snapshot: boardFingerprint(board), autoPlay };
    if (autoPlay) {
      savedAutoMoveEnabled = app.getAutoMoveEnabled();
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
      if (boardFingerprint(boardFromState()) !== request.snapshot) {
        if (request.autoPlay) {
          finishAutoSolve();
        }
        return;
      }
      const result = res.result;
      if (result.solved && result.moves.length > 0) {
        // 解を受信したら B0 から勝利までの盤面列を構築してキャッシュする(設計 4.3)
        const entry = buildSolutionCacheEntry(board, result.moves);
        if (entry) {
          cacheEntry = entry;
        }
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
    // ヒント計算中またはアイドル: 計算と再生状態をクリアして busy を解除する。
    // activeRequest.autoPlay=true なら常に autoSolving=true のため、ここでは
    // ヒント(またはアイドル)のみが対象となり mode は "hint" で固定できる。
    clearReplayTimer();
    replayMoves = null;
    replayIndex = 0;
    activeRequest = null;
    stopWorker();
    view.setSolverBusy(false, "hint");
  }

  function isAutoSolving() {
    return autoSolving;
  }

  return {
    requestSolution,
    cancel,
    cancelAutoSolve,
    isAutoSolving,
    /** キャッシュ状態の取得(E2E テスト用)。
     *  active は次のヒント要求でキャッシュが使えるか、remainingMoves は残り手数 */
    getCacheInfo: () => {
      if (!cacheEntry) {
        return { active: false, remainingMoves: 0 };
      }
      const j = findProgressIndex(cacheEntry, boardFromState());
      if (j >= 0 && j < cacheEntry.boards.length - 1) {
        return { active: true, remainingMoves: cacheEntry.moves.length - j };
      }
      return { active: false, remainingMoves: 0 };
    },
  };
}
