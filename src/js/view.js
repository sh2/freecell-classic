/* =========================================================
 * View 層 (DOM 構築・描画・通知・勝利画面)
 * すべての DOM 参照はこのモジュール内へ閉じ込める。
 * ゲーム状態 (state) は引数で受け取り、直接変更しない。
 * タイマーの経過時間計算や乱数生成などの非 DOM ロジックは持たない。
 * ========================================================= */

import { SUITS, RANKS, NUM_CASCADES, NUM_FREE, NUM_HOME } from "./constants.js";
import * as rules from "./rules.js";
import * as gameState from "./game-state.js";

/** View を生成する。DOM 要素の参照はクロージャ内に保持する */
export function createView() {
  /* ---------------- DOM 参照 ---------------- */

  const freeSlotEls = [];
  const homeSlotEls = [];
  const cascadeEls = [];
  let dragLayer = null;
  let cardElMap = null; // render() 時に構築する cardId -> 要素のマップ
  let toastHandle = null;

  /* ---------------- カード要素の生成 ---------------- */

  /** 中央にランク(大)とスート(小)を縦に並べる MS FreeCell 風の表示 */
  function centerMarkHtml(card) {
    return `<div class="center-mark"><span class="center-rank">${RANKS[card.rank]}</span><span class="center-suit">${SUITS[card.suit]}</span></div>`;
  }

  function makeCardEl(card) {
    const el = document.createElement("div");
    el.className = "card " + (rules.isRed(card) ? "red" : "black");
    el.dataset.cardId = card.id;
    const corner = (cls) =>
      `<div class="corner ${cls}"><span class="rank">${RANKS[card.rank]}</span><span class="suit">${SUITS[card.suit]}</span></div>`;
    el.innerHTML = corner("top") + centerMarkHtml(card) + corner("bottom");
    return el;
  }

  function cardElById(cardId) {
    if (cardElMap) {
      return cardElMap.get(Number(cardId)) ?? null;
    }
    return document.querySelector(`#game .card[data-card-id="${cardId}"]`);
  }

  /* ---------------- 描画 ---------------- */

  function render(state) {
    cardElMap = new Map();
    // --- フリーセル ---
    for (let i = 0; i < NUM_FREE; i++) {
      const slot = freeSlotEls[i];
      slot.querySelectorAll(".card").forEach((el) => el.remove());
      if (state.freeCells[i]) {
        const el = makeCardEl(state.freeCells[i]);
        cardElMap.set(state.freeCells[i].id, el);
        slot.appendChild(el);
      }
    }
    // --- ホーム ---
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = homeSlotEls[i];
      slot.querySelectorAll(".card").forEach((el) => el.remove());
      const pile = state.foundations[i];
      slot.dataset.label = pile.length > 0 ? SUITS[pile[pile.length - 1].suit] : "A";
      if (pile.length > 0) {
        const el = makeCardEl(pile[pile.length - 1]);
        cardElMap.set(pile[pile.length - 1].id, el);
        slot.appendChild(el);
      }
    }
    // --- カスケード ---
    const cardH = freeSlotEls[0].getBoundingClientRect().height || 124;
    const areaTop = cascadeEls[0].getBoundingClientRect().top;
    const budget = Math.max(280, window.innerHeight - areaTop - 24);
    for (let i = 0; i < NUM_CASCADES; i++) {
      const wrap = cascadeEls[i];
      wrap.querySelectorAll(".card").forEach((el) => el.remove());
      const pile = state.cascades[i];
      const overlap =
        pile.length > 1
          ? Math.min(34, Math.max(20, (budget - cardH) / (pile.length - 1)))
          : 0;
      pile.forEach((card, idx) => {
        const el = makeCardEl(card);
        el.style.top = idx * overlap + "px";
        el.style.zIndex = idx + 1;
        cardElMap.set(card.id, el);
        wrap.appendChild(el);
      });
    }
    updateHighlights(state);
    updateStatus(state);
  }

  function updateHighlights(state) {
    // つかめるカードに hover 効果を付ける
    document.querySelectorAll("#game .card.movable").forEach((el) => el.classList.remove("movable"));
    for (let i = 0; i < NUM_CASCADES; i++) {
      const pile = state.cascades[i];
      for (let pos = 0; pos < pile.length; pos++) {
        if (rules.isValidSequence(pile.slice(pos))) {
          const el = cardElById(pile[pos].id);
          if (el) {
            el.classList.add("movable");
          }
        }
      }
    }
    for (let i = 0; i < NUM_FREE; i++) {
      if (state.freeCells[i]) {
        const el = cardElById(state.freeCells[i].id);
        if (el) {
          el.classList.add("movable");
        }
      }
    }
    // 選択中カードのハイライト
    if (state.selected) {
      for (const card of gameState.selectedGroup(state)) {
        const el = cardElById(card.id);
        if (el) {
          el.classList.add("selected");
        }
      }
    }
  }

  function updateStatus(state) {
    document.getElementById("move-counter").textContent = `手数: ${state.moveCount}`;
    document.getElementById("undo-btn").disabled = state.historyStack.length === 0;
  }

  /* ---------------- タイマー表示 ---------------- */

  function setTimerLabel(text) {
    document.getElementById("timer").textContent = text;
  }

  /* ---------------- フィードバック(トースト / シェイク) ---------------- */

  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    if (toastHandle) {
      clearTimeout(toastHandle);
    }
    toastHandle = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function shakeEl(el) {
    if (!el) {
      return;
    }
    el.classList.remove("shake");
    void el.offsetWidth; // アニメーション再開用
    el.classList.add("shake");
  }

  function tooManyMessage(limit) {
    return `一度に移動できるのは最大 ${limit} 枚です(空きセル・空き列が増えるとさらに増えます)`;
  }

  /** 失敗手のフィードバック(トーストと対象スロットのシェイク) */
  function failFeedback(res, destZone, destIndex) {
    if (res.reason === "too-many") {
      showToast(tooManyMessage(res.limit));
    }
    const el =
      destZone === "free"
        ? freeSlotEls[destIndex]
        : destZone === "home"
          ? homeSlotEls[destIndex]
          : cascadeEls[destIndex];
    shakeEl(el);
  }

  /* ---------------- 勝利画面 ---------------- */

  function showWin(gameNumber, moveCount, time) {
    document.getElementById("overlay-title").textContent = "🎉 クリア！";
    document.getElementById("overlay-message").textContent =
      `No.${gameNumber} を ${moveCount} 手・ ${time} でクリアしました！`;
    document.getElementById("overlay").classList.remove("hidden");
  }

  function hideOverlay() {
    document.getElementById("overlay").classList.add("hidden");
  }

  /* ---------------- 盤面の構築 ---------------- */

  function buildBoard() {
    const freeArea = document.getElementById("free-cells");
    const homeArea = document.getElementById("home-cells");
    const cascadeArea = document.getElementById("cascade-area");

    for (let i = 0; i < NUM_FREE; i++) {
      const slot = document.createElement("div");
      slot.className = "slot free";
      slot.dataset.zone = "free";
      slot.dataset.index = i;
      slot.dataset.label = "✦";
      freeArea.appendChild(slot);
      freeSlotEls.push(slot);
    }
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = document.createElement("div");
      slot.className = "slot home";
      slot.dataset.zone = "home";
      slot.dataset.index = i;
      slot.dataset.label = "A";
      homeArea.appendChild(slot);
      homeSlotEls.push(slot);
    }
    for (let i = 0; i < NUM_CASCADES; i++) {
      const wrap = document.createElement("div");
      wrap.className = "cascade";
      wrap.dataset.zone = "cascade";
      wrap.dataset.index = i;
      const slot = document.createElement("div");
      slot.className = "slot";
      wrap.appendChild(slot);
      cascadeArea.appendChild(wrap);
      cascadeEls.push(wrap);
    }
  }

  /* ---------------- ドラッグ & ドロップ用 DOM 操作 ---------------- */

  function getDragLayer() {
    if (!dragLayer) {
      dragLayer = document.createElement("div");
      dragLayer.id = "drag-layer";
      document.body.appendChild(dragLayer);
    }
    return dragLayer;
  }

  /** ドラッグレイヤーにカード群を積んで表示する */
  function buildDragLayer(cards) {
    const layer = getDragLayer();
    layer.innerHTML = "";
    const overlap = 30;
    cards.forEach((card, i) => {
      const el = makeCardEl(card);
      el.style.top = i * overlap + "px";
      el.style.left = "0px";
      layer.appendChild(el);
    });
    layer.style.width = "var(--card-w)";
    layer.style.display = "block";
  }

  function positionDragLayer(x, y, offsetX, offsetY) {
    const layer = getDragLayer();
    layer.style.left = x - offsetX + "px";
    layer.style.top = y - offsetY + "px";
  }

  function hideDragLayer() {
    if (dragLayer) {
      dragLayer.style.display = "none";
    }
  }

  /** 移動元のカードを隠す(drag-hidden クラス付与) */
  function hideCards(cardIds) {
    cardIds.forEach((id) => {
      const el = cardElById(id);
      if (el) {
        el.classList.add("drag-hidden");
      }
    });
  }

  function clearDropHints() {
    document.querySelectorAll("#game .drop-hint").forEach((el) => el.classList.remove("drop-hint"));
  }

  function setDropHint(el, on) {
    el.classList.toggle("drop-hint", on);
  }

  function clearDropTargets() {
    document.querySelectorAll("#game .drop-target").forEach((el) => el.classList.remove("drop-target"));
  }

  function setDropTarget(el, on) {
    el.classList.toggle("drop-target", on);
  }

  /* ---------------- スロット / 入力欄アクセス ---------------- */

  function freeSlots() {
    return freeSlotEls.slice();
  }

  function homeSlots() {
    return homeSlotEls.slice();
  }

  function cascades() {
    return cascadeEls.slice();
  }

  function seedInput() {
    return document.getElementById("seed-input");
  }

  function overlayEl() {
    return document.getElementById("overlay");
  }

  return {
    render,
    buildBoard,
    setTimerLabel,
    showToast,
    shakeEl,
    tooManyMessage,
    failFeedback,
    showWin,
    hideOverlay,
    makeCardEl,
    cardElById,
    getDragLayer,
    buildDragLayer,
    positionDragLayer,
    hideDragLayer,
    hideCards,
    clearDropHints,
    setDropHint,
    clearDropTargets,
    setDropTarget,
    freeSlots,
    homeSlots,
    cascades,
    seedInput,
    overlayEl,
  };
}
