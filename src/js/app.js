/* =========================================================
 * アプリケーション層 (ゲーム開始・モデルと View の調停・タイマー)
 * モデル操作後の副作用順(タイマー開始 → 描画 → 勝利処理)を管理する。
 * 現在時刻・interval・乱数は deps で差し替え可能(テストでは fake を注入)。
 * 既定値にはブラウザーの Date.now / setInterval / clearInterval /
 * Math.random を使用する。
 * ========================================================= */

import { NUM_CASCADES, NUM_FREE, NUM_HOME, MAX_GAME_NUMBER } from "./constants.js";
import { dealGame } from "./deal.js";
import * as rules from "./rules.js";
import * as gameState from "./game-state.js";

/** アプリを生成する。view は必須、deps はテスト用の差し替え依存 */
export function createApp({ view, deps = {} }) {
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearInterval ?? ((handle) => clearInterval(handle));
  const random = deps.random ?? (() => Math.random());

  let state = null; // ゲーム状態(状態遷移層 game-state.js が所有・更新する)
  let timerStart = null; // タイマー状態(ゲーム状態には含めない)
  let timerHandle = null;
  let interactions = null; // mount() で登録される入力層
  let autoMoveEnabled = true; // 成功手の直後に安全なカードを自動でホームへ送るか

  /* ---------------- タイマー ---------------- */

  /** 1〜MAX_GAME_NUMBER の範囲でランダムなゲーム番号を生成 */
  function randomGameNumber() {
    return 1 + Math.floor(random() * MAX_GAME_NUMBER);
  }

  /** 経過秒数から "M:SS" 形式の文字列を生成する */
  function formatTime(totalSec) {
    return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
  }

  /** タイマー状態から経過時間の "M:SS" 文字列を生成する(表示・勝利メッセージ用) */
  function formatElapsedTime() {
    if (!timerStart) {
      return "0:00";
    }
    const totalSec = Math.floor((now() - timerStart) / 1000);
    return formatTime(totalSec);
  }

  function updateTimerLabel() {
    view.setTimerLabel(formatElapsedTime());
  }

  function startTimerIfNeeded() {
    if (!timerStart && !state.won) {
      timerStart = now();
      timerHandle = setIntervalFn(updateTimerLabel, 500);
    }
  }

  /** interval を止めてタイマー状態を初期化する */
  function stopTimer() {
    if (timerHandle) {
      clearIntervalFn(timerHandle);
    }
    timerHandle = null;
    timerStart = null;
  }

  /* ---------------- モデル操作後の副作用 ---------------- */

  /** 成功手の共通副作用: lastClick リセット → タイマー開始 → 描画 → 勝利・詰み処理 */
  function onMoveSucceeded() {
    if (interactions) {
      interactions.resetLastClick();
    }
    startTimerIfNeeded();
    view.render(state);
    checkWin();
    checkStuck();
  }

  /** 盤面上の動かし得るカード(フリーセル・カスケード全枚)の現在の矩形を集める。
   *  自動移動の前に取得することで、はしご状アニメーションの移動元になる */
  function collectAllCardRects() {
    const ids = [];
    for (const c of state.freeCells) {
      if (c) {
        ids.push(c.id);
      }
    }
    for (const pile of state.cascades) {
      for (const c of pile) {
        ids.push(c.id);
      }
    }
    return view.getCardRects(ids);
  }

  /** 自動ホーム送りを 1 枚ずつ「描画 → 飛行」の連鎖で進める。
   *  移動元の矩形は前の描画が終わった DOM から毎回収集するため、フリーセル経由の
   *  2 段階移動(例: ♠2 をフリーセルへ → 露出した ♠1 をホームへ → ♠2 を
   *  フリーセルからホームへ)でも、2 回目の移動が正しい位置から飛ぶ */
  function chainAutoNext() {
    const origins = collectAllCardRects();
    const card = gameState.autoMoveOne(state);
    if (!card) {
      return;
    }
    view.setNextRenderAnimation([{ cardIds: [card.id], origins }]);
    onMoveSucceeded();
    view.runAfterAnimations(chainAutoNext);
  }

  /** 手動移動の描画・飛行を開始し、完了後に自動ホーム送りを連鎖させる */
  function commitMove(manualSteps) {
    view.setNextRenderAnimation(manualSteps);
    onMoveSucceeded();
    if (autoMoveEnabled) {
      view.runAfterAnimations(chainAutoNext);
    }
  }

  /** 移動を試みる。成功時は {ok:true}、失敗時は {ok:false, reason}。
   *  opts.fromDrag が true のときは移動元をドラッグレイヤーの現在位置とする */
  function attemptMove(from, destZone, destIndex, opts = {}) {
    // 移動後の state ではカードが from に残らないため、移動前にカード群を控える
    const groupIds = gameState.groupFrom(state, from).map((c) => c.id);
    const res = gameState.attemptMove(state, from, destZone, destIndex);
    if (res.ok) {
      // 移動前の DOM はまだ古い位置にあるため、成功が確定してから矩形を取得できる
      const origins = opts.fromDrag ? view.getDragCardRects() : view.getCardRects(groupIds);
      commitMove([{ cardIds: groupIds, origins }]);
    }
    return res;
  }

  /** アニメーション・自動ホーム送りを挟まずに移動を適用する(解答再生用)。
   *  成功時は通常の成功手と同じ副作用(タイマー開始→描画→勝利/詰み判定)を
   *  実行するが、飛行アニメーションは予約しない。 */
  function applyMoveInstant(from, destZone, destIndex) {
    const res = gameState.attemptMove(state, from, destZone, destIndex);
    if (res.ok) {
      onMoveSucceeded();
    }
    return res;
  }

  function undo() {
    if (gameState.undo(state)) {
      view.hideOverlay();
      view.render(state);
    }
  }

  /** 自動移動ボタン(手動)。送れるカードが無ければトーストを出す */
  function autoMoveHome() {
    if (!gameState.hasAutoMove(state)) {
      view.showToast("ホームへ移動できるカードはありません");
      return false;
    }
    chainAutoNext();
    return true;
  }

  /** 「自動でホームへ送る」のオン/オフを切り替える(トグルとテスト API の両方から使う) */
  function setAutoMoveEnabled(enabled) {
    autoMoveEnabled = enabled;
    if (typeof document !== "undefined") {
      const toggle = document.getElementById("auto-move-toggle");
      if (toggle) {
        toggle.checked = enabled;
      }
    }
  }

  /** カード移動アニメーションの有効/無効を切り替える(テスト API 用) */
  function setAnimationsEnabled(enabled) {
    view.setAnimationsEnabled(enabled);
  }

  /** ダブルクリック時の自動移動。移動できたら true を返す */
  function dblClickAutoMove(loc) {
    // 移動前のカード矩形(アニメーションの移動元)。groupFrom は先頭 1 枚のみ返す
    const dblCardIds = gameState.groupFrom(state, loc).map((c) => c.id);
    const dblOrigins = view.getCardRects(dblCardIds);
    const moved = gameState.dblClickAutoMove(state, loc);
    if (!moved) {
      return false;
    }
    commitMove([{ cardIds: dblCardIds, origins: dblOrigins }]);
    return true;
  }

  /* ---------------- 勝利判定・ゲーム開始 ---------------- */

  function checkWin() {
    if (!gameState.checkWin(state)) {
      return;
    }
    // 経過時間の最終表示は timerStart を残したまま行う
    if (timerHandle) {
      clearIntervalFn(timerHandle);
      timerHandle = null;
    }
    updateTimerLabel();
    // DOM の時刻テキストは読まず、タイマー状態から経過時間を生成して渡す
    view.showWin(state.gameNumber, state.moveCount, formatElapsedTime());
  }

  /** 詰み判定。詰んでいれば詰みオーバーレイを表示する(タイマーは止めない) */
  function checkStuck() {
    if (gameState.checkStuck(state)) {
      view.showStuck();
    }
  }

  function resetTimerAndOverlay() {
    stopTimer();
    updateTimerLabel();
    view.hideOverlay();
  }

  function startGame(num) {
    state = gameState.createState(num, dealGame(num));
    const seedInput = view.seedInput();
    if (seedInput) {
      seedInput.value = num;
    }
    resetTimerAndOverlay();
    view.render(state);
  }

  function newGameFromInput() {
    const input = view.seedInput();
    if (!input) {
      startGame(randomGameNumber());
      return;
    }
    const num = gameState.normalizeGameNumber(input.value);
    startGame(num ?? randomGameNumber()); // 無効な入力はランダム番号で開始
  }

  function newRandomGame() {
    startGame(randomGameNumber());
  }

  function getState() {
    return state;
  }

  /* ---------------- イベント登録 ---------------- */

  /** main.js から呼ばれる。入力層と DOM イベントを配線し、初期ゲームを開始する */
  function mount(input) {
    interactions = input;

    document.getElementById("new-game-btn").addEventListener("click", newRandomGame);
    document.getElementById("start-game-btn").addEventListener("click", newGameFromInput);
    document.getElementById("overlay-new-game").addEventListener("click", newRandomGame);
    document.getElementById("overlay-undo").addEventListener("click", undo);
    // やり直し: 同じ gameNumber で再スタート(startGame が won フラグも降ろす)
    document.getElementById("restart-btn").addEventListener("click", () => startGame(state.gameNumber));
    document.getElementById("undo-btn").addEventListener("click", undo);
    document.getElementById("auto-move-btn").addEventListener("click", autoMoveHome);

    const autoMoveToggle = document.getElementById("auto-move-toggle");
    if (autoMoveToggle) {
      autoMoveToggle.checked = autoMoveEnabled;
      autoMoveToggle.addEventListener("change", () => {
        autoMoveEnabled = autoMoveToggle.checked;
      });
    }

    const seedInput = view.seedInput();
    seedInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        newGameFromInput();
      }
    });

    const game = document.getElementById("game");
    game.addEventListener("pointerdown", interactions.handlePointerDown);
    document.addEventListener("pointermove", interactions.handlePointerMove);
    document.addEventListener("pointerup", interactions.handlePointerUp);
    document.addEventListener("pointercancel", interactions.handlePointerCancel);

    // オーバーレイ: カード外クリックで閉じる(盤面を眺められるように)
    view.overlayEl().addEventListener("click", (e) => {
      if (e.target.id === "overlay") {
        e.target.classList.add("hidden");
      }
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Escape") {
        state.selected = null;
        view.render(state);
      }
    });

    let resizeHandle = null;
    window.addEventListener("resize", () => {
      if (resizeHandle) {
        clearTimeout(resizeHandle);
      }
      resizeHandle = setTimeout(() => view.render(state), 100);
    });

    view.buildBoard();
    // 最初のゲームはランダム番号で開始する(startGame が seedInput.value を設定する)
    startGame(randomGameNumber());
  }

  /* =========================================================
   * E2E テスト用の公開 API (移行期間の暫定インターフェース)
   * - 内部配列の可変参照は返さない(スナップショットはカード id で返す)。
   * - fixture はカードの一意性と各ゾーンの形式を検証してから適用する。
   * - この API は main.js 経由でのみ利用でき、window へは公開しない。
   * ========================================================= */

  /** カード id として有効か(0〜51 の整数) */
  function isCardId(value) {
    return Number.isInteger(value) && value >= 0 && value < 52;
  }

  /** board fixture を検証する。問題があればエラーメッセージ文字列、なければ null */
  function validateBoard(board) {
    if (board === null || typeof board !== "object" || Array.isArray(board)) {
      return "board はオブジェクトでなければなりません";
    }
    const seen = new Set();
    const addCard = (label, id) => {
      if (!isCardId(id)) {
        return `${label} に不正なカード id があります: ${String(id)}`;
      }
      if (seen.has(id)) {
        return `カード id ${id} が重複しています`;
      }
      seen.add(id);
      return null;
    };
    if (board.cascades !== undefined) {
      if (!Array.isArray(board.cascades)) {
        return "cascades は配列でなければなりません";
      }
      if (board.cascades.length > NUM_CASCADES) {
        return `cascades は ${NUM_CASCADES} 列以下でなければなりません`;
      }
      for (let i = 0; i < board.cascades.length; i++) {
        const pile = board.cascades[i];
        if (!Array.isArray(pile)) {
          return `cascades[${i}] は配列でなければなりません`;
        }
        for (const id of pile) {
          const err = addCard(`cascades[${i}]`, id);
          if (err) {
            return err;
          }
        }
      }
    }
    if (board.freeCells !== undefined) {
      if (!Array.isArray(board.freeCells)) {
        return "freeCells は配列でなければなりません";
      }
      if (board.freeCells.length > NUM_FREE) {
        return `freeCells は ${NUM_FREE} 個以下でなければなりません`;
      }
      for (let i = 0; i < board.freeCells.length; i++) {
        const id = board.freeCells[i];
        if (id === null) {
          continue;
        }
        const err = addCard(`freeCells[${i}]`, id);
        if (err) {
          return err;
        }
      }
    }
    if (board.foundations !== undefined) {
      if (!Array.isArray(board.foundations)) {
        return "foundations は配列でなければなりません";
      }
      if (board.foundations.length > NUM_HOME) {
        return `foundations は ${NUM_HOME} 個以下でなければなりません`;
      }
      for (let i = 0; i < board.foundations.length; i++) {
        const pile = board.foundations[i];
        if (!Array.isArray(pile)) {
          return `foundations[${i}] は配列でなければなりません`;
        }
        for (const id of pile) {
          const err = addCard(`foundations[${i}]`, id);
          if (err) {
            return err;
          }
        }
      }
    }
    if (board.moveCount !== undefined && (!Number.isInteger(board.moveCount) || board.moveCount < 0)) {
      return "moveCount は 0 以上の整数でなければなりません";
    }
    return null;
  }

  /** E2E テスト用の読み取り専用スナップショット。内部配列の可変参照は返さない */
  function snapshot() {
    return {
      gameNumber: state.gameNumber,
      cascades: state.cascades.map((pile) => pile.map((card) => card.id)),
      freeCells: state.freeCells.map((card) => (card ? card.id : null)),
      foundations: state.foundations.map((pile) => pile.map((card) => card.id)),
      moveCount: state.moveCount,
      historyLength: state.historyStack.length,
      selected: state.selected
        ? { zone: state.selected.zone, index: state.selected.index, cardIndex: state.selected.cardIndex ?? null }
        : null,
      won: state.won,
      stuck: state.stuck,
      timerRunning: timerStart !== null && timerHandle !== null && !state.won,
    };
  }

  /** 盤面 fixture を検証して適用する(E2E テスト専用) */
  function setBoard(board) {
    const err = validateBoard(board);
    if (err) {
      throw new Error(`setBoard: ${err}`);
    }
    const card = (id) => ({ suit: id % 4, rank: Math.floor(id / 4) + 1, id });
    state.cascades = Array.from({ length: NUM_CASCADES }, (_, i) => (board.cascades?.[i] ?? []).map(card));
    state.freeCells = Array.from({ length: NUM_FREE }, (_, i) => {
      const id = board.freeCells?.[i] ?? null;
      return id === null ? null : card(id);
    });
    state.foundations = Array.from({ length: NUM_HOME }, (_, i) => (board.foundations?.[i] ?? []).map(card));
    state.moveCount = board.moveCount ?? 0;
    state.historyStack = [];
    state.selected = null;
    state.won = false;
    state.stuck = false;
    view.render(state);
  }

  /** 全カードをホームに揃えた勝利盤面にして checkWin() まで実行する */
  function setWinBoard(moveCount = 52) {
    const foundations = [];
    for (let s = 0; s < NUM_HOME; s++) {
      const pile = [];
      for (let r = 1; r <= 13; r++) {
        pile.push((r - 1) * 4 + s);
      }
      foundations.push(pile);
    }
    setBoard({
      cascades: Array.from({ length: NUM_CASCADES }, () => []),
      freeCells: Array(NUM_FREE).fill(null),
      foundations,
      moveCount,
    });
    checkWin();
  }

  /** 現在の状態から移動可能枚数を求める(引数は従来互換) */
  function maxMovable(destCascadeIndex) {
    return rules.maxMovable(state.freeCells, state.cascades, destCascadeIndex);
  }

  return {
    mount,
    getState,
    attemptMove,
    applyMoveInstant,
    undo,
    autoMoveHome,
    dblClickAutoMove,
    setAutoMoveEnabled,
    setAnimationsEnabled,
    startGame,
    newGameFromInput,
    newRandomGame,
    snapshot,
    maxMovable,
    setBoard,
    setWinBoard,
  };
}
