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
    // 再描画で DOM が作り直されるため、進行中の飛行アニメーションは即座に確定する
    cancelActiveFlight();
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
    // ホームの山札を全カード重ねて描画する(見た目は最上位 1 枚と同じ)。
    // 飛行アニメーションで各カードが個別にホームへ飛べるよう、全カードに
    // DOM 要素を持たせるため(最上位だけ描画すると下のカードの要素が無い)。
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = homeSlotEls[i];
      slot.querySelectorAll(".card").forEach((el) => el.remove());
      const pile = state.foundations[i];
      slot.dataset.label = pile.length > 0 ? SUITS[pile[pile.length - 1].suit] : "A";
      pile.forEach((card) => {
        const el = makeCardEl(card);
        cardElMap.set(card.id, el);
        slot.appendChild(el);
      });
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
    playArmedAnimations();
  }

  /* =========================================================
   * 移動アニメーション(クローンの飛行)
   * render() は即座に完了した盤面を描画する方式を維持し、アニメーションは
   * 専用レイヤー(#anim-layer)上のクローン飛行で表現する。
   * 飛行中、実カードは .anim-hidden で隠す。
   * ========================================================= */

  let animLayer = null;
  let armedSteps = []; // 次の render 後に再生するアニメーション手順の予約
  let activeFlight = null; // 飛行中のアニメーション { animations, hiddenEls }
  let afterCallbacks = []; // 飛行完了後に呼ぶコールバック(自動移動の連鎖用)
  let animGen = 0; // 再描画などで古い手順の連鎖を中断するための世代トークン
  let animationsEnabled =
    typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;

  function getAnimLayer() {
    if (!animLayer) {
      animLayer = document.createElement("div");
      animLayer.id = "anim-layer";
      document.body.appendChild(animLayer);
    }
    return animLayer;
  }

  /** アニメーションの有効/無効を切り替える(E2E テストでは無効化して使う) */
  function setAnimationsEnabled(enabled) {
    animationsEnabled = enabled;
    if (!enabled) {
      armedSteps = [];
      cancelActiveFlight();
    }
  }

  /** 指定カード群の現在の DOM 矩形と重なり順を返す(cardId -> {left, top, width, height, z}) */
  function getCardRects(cardIds) {
    const rects = {};
    for (const id of cardIds) {
      const el = cardElById(id);
      if (el) {
        const r = el.getBoundingClientRect();
        const z = el.style.zIndex ? parseInt(el.style.zIndex, 10) : 0;
        rects[id] = { left: r.left, top: r.top, width: r.width, height: r.height, z };
      }
    }
    return rects;
  }

  /** ドラッグレイヤー内のカードの現在の DOM 矩形と重なり順を返す(cardId -> {left, top, width, height, z}) */
  function getDragCardRects() {
    const rects = {};
    if (dragLayer) {
      dragLayer.querySelectorAll(".card").forEach((el) => {
        const r = el.getBoundingClientRect();
        const z = el.style.zIndex ? parseInt(el.style.zIndex, 10) : 0;
        rects[Number(el.dataset.cardId)] = { left: r.left, top: r.top, width: r.width, height: r.height, z };
      });
    }
    return rects;
  }

  /** 次に render() した直後に再生するアニメーション手順を予約する */
  function setNextRenderAnimation(steps) {
    armedSteps = animationsEnabled ? steps : [];
  }

  /** 飛行時間は距離に比例(近いほど速い、150〜400ms に clamp) */
  function flightDuration(dist) {
    return Math.min(400, Math.max(150, Math.round(dist * 0.45)));
  }

  /** 進行中の飛行アニメーションを即座に確定する(再描画の直前に呼ぶ)。
   *  連鎖待ちのコールバックも破棄する(新しい描画が優先) */
  function cancelActiveFlight() {
    animGen++;
    afterCallbacks = [];
    if (activeFlight) {
      for (const anim of activeFlight.animations) {
        anim.cancel();
      }
      for (const el of activeFlight.hiddenEls) {
        el.classList.remove("anim-hidden");
      }
      activeFlight = null;
    }
    if (animLayer) {
      animLayer.innerHTML = "";
    }
  }

  /** 現在の飛行(および連鎖待ち)がすべて完了した後に fn を呼ぶ。
   *  飛行中でなければ即座に呼ぶ */
  function runAfterAnimations(fn) {
    if (!activeFlight) {
      fn();
      return;
    }
    afterCallbacks.push(fn);
  }

  /** render 後に予約済みステップを順に再生する(自動移動は 1 枚ずつ梯子状に送る)。
   *  全ステップの実カードを render と同一タスク内(同期的)で隠し、クローンも
   *  全ステップ分を「元の位置」に同期的に生成する。これにより:
   *  - 目的地に一瞬表示されるチラつきを防ぐ(描画前に隠す)
   *  - 元の位置で一瞬消えてから出現するチラつきも防ぐ(描画前にクローンを置く)
   *  飛行だけを順番に開始する。 */
  function playArmedAnimations() {
    if (armedSteps.length === 0 || !animationsEnabled) {
      armedSteps = [];
      return;
    }
    const steps = armedSteps;
    armedSteps = [];
    const gen = animGen;
    const layer = getAnimLayer();
    const flight = { animations: [], hiddenEls: [] };
    // 飛行対象のクローン(元の位置に配置済み)を全ステップ分まとめて準備する
    const plans = [];
    let zCounter = 1;
    for (const step of steps) {
      const cards = [];
      for (const cardId of step.cardIds) {
        const origin = step.origins ? step.origins[cardId] : null;
        const el = cardElById(cardId);
        if (!el || !origin) {
          continue;
        }
        const dest = el.getBoundingClientRect();
        const dx = dest.left - origin.left;
        const dy = dest.top - origin.top;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          continue; // ほぼ同じ位置なら飛ばない(隠す必要もない)
        }
        el.classList.add("anim-hidden");
        flight.hiddenEls.push(el);
        const clone = el.cloneNode(true);
        clone.classList.remove("selected", "movable", "shake", "anim-hidden");
        clone.style.left = origin.left + "px";
        clone.style.top = origin.top + "px";
        clone.style.width = origin.width + "px";
        clone.style.height = origin.height + "px";
        clone.style.zIndex = origin.z > 0 ? origin.z : zCounter;
        zCounter++;
        layer.appendChild(clone);
        cards.push({ el, clone, dx, dy, dist });
      }
      plans.push(cards);
    }
    if (plans.every((cards) => cards.length === 0)) {
      return; // 飛行対象が無い
    }
    activeFlight = flight;
    (async () => {
      for (const cards of plans) {
        if (gen !== animGen) {
          return; // 新しい描画に中断された
        }
        const finishes = [];
        for (const c of cards) {
          const anim = c.clone.animate(
            [{ transform: "translate(0px, 0px)" }, { transform: `translate(${c.dx}px, ${c.dy}px)` }],
            { duration: flightDuration(c.dist), easing: "ease-out" }
          );
          anim.onfinish = () => {
            c.el.classList.remove("anim-hidden");
            c.clone.remove();
          };
          flight.animations.push(anim);
          finishes.push(anim.finished);
        }
        try {
          await Promise.all(finishes);
        } catch {
          // cancel() で finished が reject する → 世代チェックで抜ける
        }
      }
      if (gen === animGen) {
        activeFlight = null;
        const cbs = afterCallbacks;
        afterCallbacks = [];
        for (const cb of cbs) {
          cb();
        }
      }
    })();
  }

  /** ドラッグレイヤーを元のカード位置へ飛ばし、完了後に onDone を呼ぶ(無効時は即座に呼ぶ) */
  function animateDragLayerBack(originRect, onDone) {
    if (!animationsEnabled || !originRect || !dragLayer || dragLayer.style.display === "none") {
      onDone();
      return;
    }
    const layerRect = dragLayer.getBoundingClientRect();
    const dx = originRect.left - layerRect.left;
    const dy = originRect.top - layerRect.top;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      onDone();
      return;
    }
    const anim = dragLayer.animate(
      [{ transform: "translate(0px, 0px)" }, { transform: `translate(${dx}px, ${dy}px)` }],
      { duration: flightDuration(dist), easing: "ease-out", fill: "forwards" }
    );
    anim.onfinish = () => {
      anim.cancel(); // transform を戻す(同じタスク内で隠すためスナップは見えない)
      onDone();
    };
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

  /* ---------------- 勝利・詰み画面 ---------------- */

  function showWin(gameNumber, moveCount, time) {
    document.getElementById("overlay-title").textContent = "🎉 クリア！";
    document.getElementById("overlay-message").textContent =
      `No.${gameNumber} を ${moveCount} 手・ ${time} でクリアしました！`;
    document.getElementById("overlay-undo").classList.add("hidden");
    document.getElementById("overlay").classList.remove("hidden");
  }

  function showStuck() {
    document.getElementById("overlay-title").textContent = "詰みました";
    document.getElementById("overlay-message").textContent =
      "これ以上動かせるカードがありません。1手戻すか、新しいゲームを始めてください。";
    document.getElementById("overlay-undo").classList.remove("hidden");
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

  /* ---------------- ソルバー UI ---------------- */

  /** ソルバー計算中はヒント/自動解答ボタンを無効化する */
  function setSolverBusy(busy) {
    const hintBtn = document.getElementById("hint-btn");
    const solveBtn = document.getElementById("solve-btn");
    if (hintBtn) {
      hintBtn.disabled = busy;
    }
    if (solveBtn) {
      solveBtn.disabled = busy;
      solveBtn.textContent = busy ? "計算中…" : "自動解答";
    }
  }

  /** ソルバーの現在段階を表示する */
  function setSolverStage(stage) {
    const solveBtn = document.getElementById("solve-btn");
    if (solveBtn) {
      if (stage === "safe" || stage === "safe2") {
        solveBtn.textContent = "安全探索中…";
      } else {
        solveBtn.textContent = "高速探索中…";
      }
    }
  }

  /** 解答手順パネルを表示する(lines は表示用文字列の配列) */
  function showSolution(lines) {
    const panel = document.getElementById("solution-panel");
    const summary = document.getElementById("solution-summary");
    const list = document.getElementById("solution-list");
    if (!panel || !list) {
      return;
    }
    if (summary) {
      summary.textContent = `全 ${lines.length} 手`;
    }
    list.innerHTML = "";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    }
    panel.classList.remove("hidden");
  }

  function hideSolution() {
    const panel = document.getElementById("solution-panel");
    if (panel) {
      panel.classList.add("hidden");
    }
  }

  function solutionPanelEl() {
    return document.getElementById("solution-panel");
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
    showStuck,
    hideOverlay,
    makeCardEl,
    cardElById,
    setAnimationsEnabled,
    setNextRenderAnimation,
    runAfterAnimations,
    getCardRects,
    getDragCardRects,
    animateDragLayerBack,
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
    setSolverBusy,
    setSolverStage,
    showSolution,
    hideSolution,
    solutionPanelEl,
  };
}
