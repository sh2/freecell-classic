/* =========================================================
 * エントリポイント (唯一の HTML エントリ)
 * view / app / interactions を配線し、初期化を 1 回だけ行う。
 *
 * E2E テストは同じ URL の main.js を dynamic import するため、
 * モジュールキャッシュが働き init() は二重実行されない。
 * テスト API はここから公開する(window へは公開しない)。
 * ========================================================= */

import { createView } from "./view.js";
import { createApp } from "./app.js";
import { createInteractions } from "./interactions.js";
import { createSolverClient } from "./solver-client.js";
import { createDopaMode } from "./dopa.js";

let appInstance = null;
let solverClient = null;
let dopaInstance = null;

export function init() {
  const view = createView();
  const dopa = createDopaMode({ view });
  dopaInstance = dopa;
  const app = createApp({ view, dopa });
  const interactions = createInteractions({ view, app, dopa });
  app.mount(interactions);
  appInstance = app;

  solverClient = createSolverClient({ app, view, dopa });
  document.getElementById("hint-btn").addEventListener("click", () => {
    solverClient.requestSolution({ autoPlay: false });
  });
  const autoToggle = document.getElementById("auto-solve-toggle");
  if (autoToggle) {
    autoToggle.addEventListener("change", () => {
      if (autoToggle.checked) {
        solverClient.requestSolution({ autoPlay: true });
      } else {
        solverClient.cancelAutoSolve();
      }
    });
  }
  // ドパモード: 単一チェックボックスで演出とサウンドをまとめて切り替える。
  // デフォルト OFF・保存しない。OFF 中も ON 中の最初の操作でも AudioContext を解錠する
  const dopaToggle = document.getElementById("dopa-toggle");
  if (dopaToggle) {
    dopaToggle.checked = dopa.isEnabled();
    dopaToggle.addEventListener("change", () => {
      dopa.setEnabled(dopaToggle.checked);
    });
  }
  const unlockDopaAudio = () => {
    if (dopa.isEnabled()) {
      dopa.unlock();
    }
  };
  document.addEventListener("pointerdown", unlockDopaAudio, { passive: true });
  document.addEventListener("keydown", unlockDopaAudio);

  document.getElementById("solution-close-btn").addEventListener("click", () => {
    view.hideSolution();
  });

  // 新しいゲームを開始したら古い解答パネル・ヒント・自動解答をリセットする
  // (解法キャッシュは破棄しない。寿命は盤面照合に一任され、リスタート後の
  // 同一盤面ではキャッシュが即答に使われる)
  const clearSolutionOnNewGame = () => {
    solverClient.cancel();
    solverClient.cancelAutoSolve();
    const t = document.getElementById("auto-solve-toggle");
    if (t) {
      t.checked = false;
    }
    app.setAutoSolving(false);
    view.hideSolution();
    if (view.clearHint) {
      view.clearHint();
    }
  };
  document.getElementById("new-game-btn").addEventListener("click", clearSolutionOnNewGame);
  document.getElementById("start-game-btn").addEventListener("click", clearSolutionOnNewGame);
  document.getElementById("overlay-new-game").addEventListener("click", clearSolutionOnNewGame);

  // やり直し確認ダイアログのボタンと背景クリック
  document.getElementById("confirm-ok-btn").addEventListener("click", () => {
    view.resolveConfirmDialog(true);
  });
  document.getElementById("confirm-cancel-btn").addEventListener("click", () => {
    view.resolveConfirmDialog(false);
  });
  document.getElementById("confirm-dialog").addEventListener("click", (e) => {
    if (e.target.id === "confirm-dialog") {
      view.resolveConfirmDialog(false);
    }
  });

  // やり直し: 進行があるときだけ確認ダイアログを挟む(キャンセルなら盤面維持)。
  // 実行時は新規ゲーム系と同じ後始末をしてから同じ番号で再スタートする
  const requestRestart = () => {
    const doRestart = () => {
      clearSolutionOnNewGame();
      app.restartGame();
    };
    if (app.needsRestartConfirm()) {
      view.showConfirmRestart().then((ok) => {
        if (ok) {
          doRestart();
        }
      });
    } else {
      doRestart();
    }
  };
  document.getElementById("restart-btn").addEventListener("click", requestRestart);
}

/** E2E テスト用の公開 API。init() 後にのみ利用できる */
export function getTestApi() {
  if (!appInstance) {
    throw new Error("getTestApi: init() がまだ呼ばれていません");
  }
  return {
    startGame: appInstance.startGame,
    snapshot: appInstance.snapshot,
    maxMovable: appInstance.maxMovable,
    setBoard: appInstance.setBoard,
    setWinBoard: appInstance.setWinBoard,
    setAutoMoveEnabled: appInstance.setAutoMoveEnabled,
    setAnimationsEnabled: appInstance.setAnimationsEnabled,
    /** ドパモードの ON/OFF(テスト用)。トグル UI も同期する */
    setDopaEnabled: (enabled) => {
      if (dopaInstance) {
        dopaInstance.setEnabled(enabled);
      }
      const toggle = document.getElementById("dopa-toggle");
      if (toggle) {
        toggle.checked = !!enabled;
      }
    },
    isDopaEnabled: () => (dopaInstance ? dopaInstance.isEnabled() : false),
    /** 演出 ID を直接発火する(56 件の機械検証用) */
    triggerDopaEffect: (id, context = {}) => {
      if (!dopaInstance) {
        return false;
      }
      return dopaInstance.triggerEffect(id, context);
    },
    /** ドパモードのデバッグ状態 { enabled, combo, activeEffects, activeVoices, lastRecipe, effects } */
    dopaDebug: () => (dopaInstance ? dopaInstance.debugState() : null),
    /** 解法キャッシュの状態取得。{ active, remainingMoves } を返す */
    solverCacheInfo: () => solverClient.getCacheInfo(),
  };
}

init();
