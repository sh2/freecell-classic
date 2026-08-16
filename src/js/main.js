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

let appInstance = null;
let solverClient = null;

export function init() {
  const view = createView();
  const app = createApp({ view });
  const interactions = createInteractions({ view, app });
  app.mount(interactions);
  appInstance = app;

  solverClient = createSolverClient({ app, view });
  document.getElementById("hint-btn").addEventListener("click", () => {
    solverClient.requestSolution({ autoPlay: false });
  });
  document.getElementById("solve-btn").addEventListener("click", () => {
    solverClient.requestSolution({ autoPlay: true });
  });
  document.getElementById("solution-close-btn").addEventListener("click", () => {
    view.hideSolution();
  });

  // 新しいゲームを開始したら古い解答パネルを閉じる
  const clearSolutionOnNewGame = () => {
    solverClient.clearSolution();
    view.hideSolution();
  };
  document.getElementById("new-game-btn").addEventListener("click", clearSolutionOnNewGame);
  document.getElementById("restart-btn").addEventListener("click", clearSolutionOnNewGame);
  document.getElementById("start-game-btn").addEventListener("click", clearSolutionOnNewGame);
  document.getElementById("overlay-new-game").addEventListener("click", clearSolutionOnNewGame);
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
    requestSolution: (autoPlay) => solverClient.requestSolution({ autoPlay: Boolean(autoPlay) }),
    replaySolution: () => solverClient.replaySolution(),
    hasSolverSolution: () => solverClient.hasSolution(),
  };
}

init();
