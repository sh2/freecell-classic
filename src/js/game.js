/* =========================================================
 * フリーセル (FreeCell) - 依存ライブラリなしの vanilla JS
 * ゲーム番号 1〜32000 は Microsoft 版 FreeCell と同じ配置になります
 *
 * 責務分離の移行中モジュール。定数・ディール・ルール判定・状態遷移は抽出済みで、
 * 残りの描画・入力・アプリ制御はこのファイルに集約している
 * (Phase 5 で順に抽出する)。
 * ========================================================= */

import { SUITS, RANKS, NUM_CASCADES, NUM_FREE, NUM_HOME, MAX_GAME_NUMBER } from "./constants.js";
import { dealGame } from "./deal.js";
import * as rules from "./rules.js";
import * as gameState from "./game-state.js";

/* ---------------- 状態 ---------------- */

let state = null; // ゲーム状態(状態遷移層 game-state.js が所有・更新する)
let timerStart = null; // タイマー状態(ゲーム状態には含めない)
let timerHandle = null;

/* ---------------- DOM 参照 ---------------- */

const freeSlotEls = [];
const homeSlotEls = [];
const cascadeEls = [];
let dragLayer = null;

/* =========================================================
 * 移動の実行 (状態遷移は game-state.js へ委譲)
 * ========================================================= */

/** 成功手の共通副作用: 連続クリック判定のリセット → タイマー開始 → 描画 → 勝利処理 */
function onMoveSucceeded() {
  lastClick = { time: 0, cardId: -1 };
  startTimerIfNeeded();
  render();
  checkWin();
}

/**
 * 移動を試みる。成功時は {ok:true}、失敗時は {ok:false, reason}
 */
function attemptMove(from, destZone, destIndex) {
  const res = gameState.attemptMove(state, from, destZone, destIndex);
  if (res.ok) {
    onMoveSucceeded();
  }
  return res;
}

function undo() {
  if (gameState.undo(state)) {
    render();
  }
}

/* =========================================================
 * 自動移動
 * ========================================================= */

function autoMoveHome() {
  const movedAny = gameState.autoMoveHome(state);
  if (!movedAny) {
    showToast("ホームへ移動できるカードはありません");
    return;
  }
  onMoveSucceeded();
}

/* =========================================================
 * 描画
 * ========================================================= */

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

let cardElMap = null; // render() 時に構築する cardId -> 要素のマップ

function cardElById(cardId) {
  if (cardElMap) {
    return cardElMap.get(Number(cardId)) ?? null;
  }
  return document.querySelector(`#game .card[data-card-id="${cardId}"]`);
}

function render() {
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
  updateHighlights();
  updateStatus();
}

function updateHighlights() {
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

function updateStatus() {
  document.getElementById("move-counter").textContent = `手数: ${state.moveCount}`;
  document.getElementById("undo-btn").disabled = state.historyStack.length === 0;
}

function updateTimerLabel() {
  const el = document.getElementById("timer");
  if (!timerStart) {
    el.textContent = "0:00";
    return;
  }
  const totalSec = Math.floor((Date.now() - timerStart) / 1000);
  el.textContent = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

function startTimerIfNeeded() {
  if (!timerStart && !state.won) {
    timerStart = Date.now();
    timerHandle = setInterval(updateTimerLabel, 500);
  }
}

/* =========================================================
 * 勝利判定・ゲーム開始
 * ========================================================= */

function checkWin() {
  if (!gameState.checkWin(state)) {
    return;
  }
  if (timerHandle) {
    clearInterval(timerHandle);
  }
  updateTimerLabel();
  const time = document.getElementById("timer").textContent;
  document.getElementById("overlay-title").textContent = "🎉 クリア！";
  document.getElementById("overlay-message").textContent =
    `No.${state.gameNumber} を ${state.moveCount} 手・ ${time} でクリアしました！`;
  document.getElementById("overlay").classList.remove("hidden");
}

function resetTimerAndOverlay() {
  if (timerHandle) {
    clearInterval(timerHandle);
  }
  timerHandle = null;
  timerStart = null;
  updateTimerLabel();
  document.getElementById("overlay").classList.add("hidden");
}

function startGame(num) {
  state = gameState.createState(num, dealGame(num));
  const seedInput = document.getElementById("seed-input");
  if (seedInput) {
    seedInput.value = num;
  }
  resetTimerAndOverlay();
  render();
}

function newGameFromInput() {
  const input = document.getElementById("seed-input");
  const num = gameState.normalizeGameNumber(input.value);
  startGame(num ?? randomGameNumber()); // 無効な入力はランダム番号で開始
}

/* =========================================================
 * フィードバック(トースト / シェイク)
 * ========================================================= */

let toastHandle = null;

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

/* =========================================================
 * クリック(選択 → 移動)操作
 * ========================================================= */

function zoneOfEl(el) {
  const z = el && el.closest ? el.closest("[data-zone]") : null;
  if (!z) {
    return null;
  }
  return { zone: z.dataset.zone, index: Number(z.dataset.index), el: z };
}

// ダブルクリック判定用: 最後にクリックしたカードと時刻
let lastClick = { time: 0, cardId: -1 };

function handleClick(targetEl) {
  if (state.won) {
    return;
  }
  const cardEl = targetEl.closest ? targetEl.closest(".card") : null;

  // 枠(空きマス)をクリックした場合
  if (!cardEl) {
    const zone = zoneOfEl(targetEl);
    if (zone && state.selected) {
      const res = attemptMove(state.selected, zone.zone, zone.index);
      if (!res.ok) {
        failFeedback(res, zone.zone, zone.index);
      }
    }
    return;
  }

  const loc = rules.findCardLocation(state, Number(cardEl.dataset.cardId));
  if (!loc) {
    return;
  }

  // ダブルクリック判定: 同じカードを 400ms 以内に再クリック → 自動移動
  const now = performance.now();
  const isDblClick = lastClick.cardId === cardEl.dataset.cardId && now - lastClick.time < 400;
  lastClick = { time: now, cardId: cardEl.dataset.cardId };
  if (isDblClick) {
    state.selected = null;
    if (!dblClickAutoMove(loc)) {
      render(); // 移動できなければ選択解除だけ反映
    }
    return;
  }

  if (state.selected) {
    // 同じカードを再クリック → 選択解除
    const sameCard =
      state.selected.zone === loc.zone &&
      state.selected.index === loc.index &&
      (state.selected.zone !== "cascade" || state.selected.cardIndex === loc.cardIndex);
    if (sameCard) {
      state.selected = null;
      render();
      return;
    }
    // 選択中のカードを対象の場所へ移動してみる
    const res = attemptMove(state.selected, loc.zone, loc.index);
    if (res.ok) {
      return;
    }
    if (res.reason === "too-many") {
      failFeedback(res, loc.zone, loc.index);
      return;
    }
    // 移動できない → つかめるなら選択を切り替える
    if (rules.isGrabbable(state.cascades, loc)) {
      state.selected = loc;
      render();
    } else {
      state.selected = null;
      render();
      shakeEl(cardEl);
    }
    return;
  }

  // 未選択 → つかめるカードなら選択
  if (rules.isGrabbable(state.cascades, loc)) {
    state.selected = loc;
    render();
  } else {
    shakeEl(cardEl);
  }
}

/* =========================================================
 * ドラッグ & ドロップ操作
 * ========================================================= */

let dragState = null; // { from, group, offsetX, offsetY, active, hiddenEls }

function onPointerDown(e) {
  if (e.button !== 0 && e.pointerType === "mouse") {
    return;
  }
  if (state.won) {
    return;
  }
  const cardEl = e.target.closest ? e.target.closest("#game .card") : null;
  dragState = {
    startX: e.clientX,
    startY: e.clientY,
    cardEl,
    targetEl: e.target,
    active: false,
  };
  if (!cardEl) {
    return;
  }
  const loc = rules.findCardLocation(state, Number(cardEl.dataset.cardId));
  if (!loc || !rules.isGrabbable(state.cascades, loc)) {
    return;
  }
  dragState.from = loc;
  dragState.group = gameState.groupFrom(state, loc);
  const rect = cardEl.getBoundingClientRect();
  dragState.offsetX = e.clientX - rect.left;
  dragState.offsetY = e.clientY - rect.top;
  e.preventDefault();
}

function buildDragLayer() {
  if (!dragLayer) {
    dragLayer = document.createElement("div");
    dragLayer.id = "drag-layer";
    document.body.appendChild(dragLayer);
  }
  dragLayer.innerHTML = "";
  const overlap = 30;
  dragState.group.forEach((card, i) => {
    const el = makeCardEl(card);
    el.style.top = i * overlap + "px";
    el.style.left = "0px";
    dragLayer.appendChild(el);
  });
  dragLayer.style.width = "var(--card-w)";
  dragLayer.style.display = "block";
}

function positionDragLayer(x, y) {
  dragLayer.style.left = x - dragState.offsetX + "px";
  dragLayer.style.top = y - dragState.offsetY + "px";
}

function startDrag() {
  dragState.active = true;
  state.selected = null;
  updateHighlights();
  buildDragLayer();
  // 移動元のカードを隠す
  dragState.hiddenEls = dragState.group
    .map((c) => cardElById(c.id))
    .filter(Boolean);
  dragState.hiddenEls.forEach((el) => el.classList.add("drag-hidden"));
  showDropHints();
}

function getValidDropTargets() {
  const group = dragState.group;
  const targets = [];
  if (group.length === 1) {
    freeSlotEls.forEach((el, i) => {
      if (state.freeCells[i] === null) {
        targets.push({ zone: "free", index: i, hitEl: el, hintEl: el });
      }
    });
    homeSlotEls.forEach((el, i) => {
      if (rules.canDropOnHome(state.foundations, group[0], i)) {
        targets.push({ zone: "home", index: i, hitEl: el, hintEl: el });
      }
    });
  }
  cascadeEls.forEach((el, i) => {
    if (dragState.from.zone === "cascade" && dragState.from.index === i) {
      return;
    }
    if (rules.canDropOnCascade(state.cascades, group, i) && group.length <= rules.maxMovable(state.freeCells, state.cascades, i)) {
      const pile = state.cascades[i];
      let hintEl, hitEl;
      if (pile.length > 0) {
        hintEl = cardElById(pile[pile.length - 1].id);
        hitEl = hintEl || el;
      } else {
        hintEl = el.querySelector(".slot");
        hitEl = hintEl || el;
      }
      targets.push({ zone: "cascade", index: i, hitEl, hintEl });
    }
  });
  return targets;
}

function showDropHints() {
  clearDropHints();
  getValidDropTargets().forEach((t) => t.hintEl.classList.add("drop-hint"));
}

function clearDropHints() {
  document.querySelectorAll("#game .drop-hint").forEach((el) => el.classList.remove("drop-hint"));
}

/* ドラッグ中のカードの矩形と各候補の矩形を比べ、ドロップ先を決定する。
 * 重なりがあればそれを優先し、なければ近接距離(許容マージン内)で最も近い候補を選ぶ。 */
function computeDropTarget() {
  const targets = getValidDropTargets();
  if (!targets.length) {
    return null;
  }
  const draggedEl = dragLayer.firstElementChild;
  if (!draggedEl) {
    return null;
  }
  const dragged = draggedEl.getBoundingClientRect();
  const margin = 60; // カード外側に広げるドロップ許容範囲(px)
  const dcx = dragged.left + dragged.width / 2;
  const dcy = dragged.top + dragged.height / 2;
  let best = null;
  let bestScore = -Infinity;
  for (const t of targets) {
    const r = t.hitEl.getBoundingClientRect();
    const ox = Math.max(0, Math.min(dragged.right, r.right) - Math.max(dragged.left, r.left));
    const oy = Math.max(0, Math.min(dragged.bottom, r.bottom) - Math.max(dragged.top, r.top));
    const overlap = ox * oy;
    const nx = Math.max(r.left - dcx, 0, dcx - r.right);
    const ny = Math.max(r.top - dcy, 0, dcy - r.bottom);
    const dist = Math.hypot(nx, ny);
    if (overlap <= 0 && dist > margin) {
      continue; // 許容範囲外は除外
    }
    const score = overlap > 0 ? overlap : -dist; // 重なり優先、次いで近接
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/* 現在ドロップされようとしている候補を強調表示する */
function updateDropTargetHighlight() {
  const cur = computeDropTarget();
  document.querySelectorAll("#game .drop-target").forEach((el) => {
    if (!cur || el !== cur.hintEl) {
      el.classList.remove("drop-target");
    }
  });
  if (cur) {
    cur.hintEl.classList.add("drop-target");
  }
}

/** ドロップ位置の列が「枚数超過」で受け入れられない場合、その上限を返す。それ以外は null */
function tooManyLimitAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const cascadeEl = el && el.closest ? el.closest(".cascade") : null;
  if (!cascadeEl) {
    return null;
  }
  const i = Number(cascadeEl.dataset.index);
  const from = dragState.from;
  if (from.zone === "cascade" && from.index === i) {
    return null; // 移動元の列
  }
  if (!rules.canDropOnCascade(state.cascades, dragState.group, i)) {
    return null; // ランク/色の不一致など、枚数以外の理由
  }
  const limit = rules.maxMovable(state.freeCells, state.cascades, i);
  if (dragState.group.length <= limit) {
    return null;
  }
  return limit;
}

function onPointerMove(e) {
  if (!dragState || !dragState.from) {
    return;
  }
  if (!dragState.active) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (dx * dx + dy * dy < 36) {
      return; // 6px 未満はクリック扱い
    }
    startDrag();
  }
  positionDragLayer(e.clientX, e.clientY);
  updateDropTargetHighlight();
}

function onPointerUp(e) {
  if (!dragState) {
    return;
  }
  const st = dragState;
  // ドロップ先の判定は dragState が生きている間に計算する
  const target = st.active ? computeDropTarget() : null;
  // 有効なドロップ先が無く、ドロップ位置の列が枚数超過ならその上限を記録する
  const tooManyLimit = st.active && !target ? tooManyLimitAt(e.clientX, e.clientY) : null;
  dragState = null;

  if (st.active) {
    clearDropHints();
    document.querySelectorAll("#game .drop-target").forEach((el) => el.classList.remove("drop-target"));
    let handled = false;
    if (target) {
      const res = attemptMove(st.from, target.zone, target.index);
      if (res.ok) {
        handled = true;
      } else if (res.reason === "too-many") {
        showToast(tooManyMessage(res.limit));
      }
    } else if (tooManyLimit !== null) {
      showToast(tooManyMessage(tooManyLimit));
    }
    dragLayer.style.display = "none";
    if (!handled) {
      render(); // 元に戻す
    }
    return;
  }
  // クリック扱い
  handleClick(st.targetEl);
}

function onPointerCancel() {
  if (!dragState) {
    return;
  }
  clearDropHints();
  dragState = null;
  if (dragLayer) {
    dragLayer.style.display = "none";
  }
  render();
}

/* =========================================================
 * ダブルクリック → ホーム(無理ならフリーセル)
 * ※ pointerdown で preventDefault() しているため、ネイティブの
 *   dblclick イベントは発火しない。クリック間隔で自前判定する。
 * ========================================================= */

/** ダブルクリック時の自動移動。移動できたら true を返す */
function dblClickAutoMove(loc) {
  const moved = gameState.dblClickAutoMove(state, loc);
  if (moved) {
    onMoveSucceeded();
  }
  return moved;
}

/* =========================================================
 * 盤面の構築
 * ========================================================= */

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

/* =========================================================
 * 初期化
 * エントリポイント(main.js)からのみ 1 回呼び出される。
 * ========================================================= */

export function init() {
  buildBoard();

  document.getElementById("new-game-btn").addEventListener("click", newGameFromInput);
  document.getElementById("random-game-btn").addEventListener("click", newRandomGame);
  document.getElementById("overlay-new-game").addEventListener("click", newRandomGame);
  // やり直し: 同じ gameNumber で再スタート(startGame が won フラグも降ろす)
  document.getElementById("restart-btn").addEventListener("click", () => startGame(state.gameNumber));
  document.getElementById("undo-btn").addEventListener("click", undo);
  document.getElementById("auto-move-btn").addEventListener("click", autoMoveHome);

  const seedInput = document.getElementById("seed-input");
  seedInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      newGameFromInput();
    }
  });

  const game = document.getElementById("game");
  game.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);

  // オーバーレイ: カード外クリックで閉じる(盤面を眺められるように)
  document.getElementById("overlay").addEventListener("click", (e) => {
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
      render();
    }
  });

  let resizeHandle = null;
  window.addEventListener("resize", () => {
    if (resizeHandle) {
      clearTimeout(resizeHandle);
    }
    resizeHandle = setTimeout(() => render(), 100);
  });

  // 最初のゲームはランダム番号で開始する(startGame が seedInput.value を設定する)
  startGame(randomGameNumber());
}

/** 1〜MAX_GAME_NUMBER の範囲でランダムなゲーム番号を生成 */
function randomGameNumber() {
  return 1 + Math.floor(Math.random() * MAX_GAME_NUMBER);
}

/** ランダムなゲーム番号で新しいゲームを開始 */
function newRandomGame() {
  startGame(randomGameNumber());
}

/* =========================================================
 * E2E テスト用の公開 API (移行期間の暫定インターフェース)
 * Phase 5 で正式な app API へ置き換える。
 * - 内部配列の可変参照は返さない(スナップショットはカード id で返す)。
 * - fixture はカードの一意性と各ゾーンの形式を検証してから適用する。
 * - この API はモジュール export 経由でのみ利用でき、window へは公開しない。
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

/**
 * E2E テスト用の読み取り専用スナップショット。
 * 内部配列の可変参照は返さず、カードは id で返す。
 */
export function snapshot() {
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
    timerRunning: timerStart !== null && timerHandle !== null && !state.won,
  };
}

/**
 * 盤面 fixture を検証して適用する(E2E テスト専用)。
 * 各ゾーンはカード id の配列(または null)で指定し、指定が不足したゾーンは
 * 空(null)で埋めて 8 列・4 フリーセル・4 ホームの形式に正規化する。
 * 履歴・選択はクリアし、`won` を false にして render() まで行う。
 */
export function setBoard(board) {
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
  render();
}

/** 全カードをホームに揃えた勝利盤面にして checkWin() まで実行する */
export function setWinBoard(moveCount = 52) {
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

/** テスト API 用: 現在の状態から移動可能枚数を求める(引数は従来互換) */
function maxMovable(destCascadeIndex) {
  return rules.maxMovable(state.freeCells, state.cascades, destCascadeIndex);
}

/** E2E テスト用の公開 API。main.js から再 export される。 */
export function getTestApi() {
  return { startGame, snapshot, maxMovable, setBoard, setWinBoard };
}
