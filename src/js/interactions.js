/* =========================================================
 * 入力層 (クリック / Pointer Events / ドラッグ&ドロップ)
 * ダブルクリック判定用の lastClick とドラッグ状態 dragState を保持する。
 * 移動の実行は app 層の attemptMove / dblClickAutoMove へ委譲し、
 * 成功後の副作用(タイマー・描画・勝利処理)は app 側が担当する。
 * DOM の読み書きは原則 view 層へ委譲する。ただしドロップ位置の列判定に
 * 使う elementFromPoint はイベント座標に依存するため、この層に置く。
 * 選択状態 (state.selected) はゲーム状態として状態層が所有するが、
 * クリック操作による選択・解除・切替は入力層が state 経由で反映する
 * (旧実装と同じ契約。成功手・Undo でのリセットは状態層が行う)。
 * ========================================================= */

import * as rules from "./rules.js";
import * as gameState from "./game-state.js";

/** 入力ハンドラを生成する。app は移動実行・状態取得の窓口 */
export function createInteractions({ view, app }) {
  // ダブルクリック判定用: 最後にクリックしたカードと時刻
  let lastClick = { time: 0, cardId: -1 };
  let dragState = null; // { from, group, offsetX, offsetY, active, targetEl }

  /** 連続クリック判定のリセット(app の成功手処理から呼ばれる) */
  function resetLastClick() {
    lastClick = { time: 0, cardId: -1 };
  }

  function zoneOfEl(el) {
    const z = el && el.closest ? el.closest("[data-zone]") : null;
    if (!z) {
      return null;
    }
    return { zone: z.dataset.zone, index: Number(z.dataset.index), el: z };
  }

  function isBlocked() {
    return typeof app.isAutoSolving === "function" && app.isAutoSolving();
  }

  function handleClick(targetEl) {
    if (isBlocked()) {
      return;
    }
    const state = app.getState();
    if (state.won) {
      return;
    }
    const cardEl = targetEl.closest ? targetEl.closest(".card") : null;

    // 枠(空きマス)をクリックした場合
    if (!cardEl) {
      const zone = zoneOfEl(targetEl);
      if (zone && state.selected) {
        const res = app.attemptMove(state.selected, zone.zone, zone.index);
        if (!res.ok) {
          view.failFeedback(res, zone.zone, zone.index);
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
      if (!app.dblClickAutoMove(loc)) {
        view.render(state); // 移動できなければ選択解除だけ反映
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
        view.render(state);
        return;
      }
      // 選択中のカードを対象の場所へ移動してみる
      const res = app.attemptMove(state.selected, loc.zone, loc.index);
      if (res.ok) {
        return;
      }
      if (res.reason === "too-many") {
        view.failFeedback(res, loc.zone, loc.index);
        return;
      }
      // 移動できない → つかめるなら選択を切り替える
      if (rules.isGrabbable(state.cascades, loc)) {
        state.selected = loc;
        view.render(state);
      } else {
        state.selected = null;
        view.render(state);
        view.shakeEl(cardEl);
      }
      return;
    }

    // 未選択 → つかめるカードなら選択
    if (rules.isGrabbable(state.cascades, loc)) {
      state.selected = loc;
      view.render(state);
    } else {
      view.shakeEl(cardEl);
    }
  }

  /* =========================================================
   * ドラッグ & ドロップ操作
   * ========================================================= */

  function handlePointerDown(e) {
    if (isBlocked()) {
      return;
    }
    const state = app.getState();
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

  function startDrag() {
    const state = app.getState();
    dragState.active = true;
    state.selected = null;
    view.render(state);
    view.buildDragLayer(dragState.group);
    // 移動元のカードを隠す
    view.hideCards(dragState.group.map((c) => c.id));
    showDropHints();
  }

  function getValidDropTargets() {
    const state = app.getState();
    const group = dragState.group;
    const targets = [];
    if (group.length === 1) {
      view.freeSlots().forEach((el, i) => {
        if (state.freeCells[i] === null) {
          targets.push({ zone: "free", index: i, hitEl: el, hintEl: el });
        }
      });
      view.homeSlots().forEach((el, i) => {
        if (rules.canDropOnHome(state.foundations, group[0], i)) {
          targets.push({ zone: "home", index: i, hitEl: el, hintEl: el });
        }
      });
    }
    view.cascades().forEach((el, i) => {
      if (dragState.from.zone === "cascade" && dragState.from.index === i) {
        return;
      }
      if (rules.canDropOnCascade(state.cascades, group, i) && group.length <= rules.maxMovable(state.freeCells, state.cascades, i)) {
        const pile = state.cascades[i];
        let hintEl, hitEl;
        if (pile.length > 0) {
          hintEl = view.cardElById(pile[pile.length - 1].id);
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
    view.clearDropHints();
    getValidDropTargets().forEach((t) => view.setDropHint(t.hintEl, true));
  }

  /* ドラッグ中のカードの矩形と各候補の矩形を比べ、ドロップ先を決定する。
   * 重なりがあればそれを優先し、なければ近接距離(許容マージン内)で最も近い候補を選ぶ。 */
  function computeDropTarget() {
    const targets = getValidDropTargets();
    if (!targets.length) {
      return null;
    }
    const layer = view.getDragLayer();
    const draggedEl = layer.firstElementChild;
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
    view.clearDropTargets();
    if (cur) {
      view.setDropTarget(cur.hintEl, true);
    }
  }

  /** ドロップ位置の列が「枚数超過」で受け入れられない場合、その上限を返す。それ以外は null */
  function tooManyLimitAt(x, y) {
    const state = app.getState();
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

  function handlePointerMove(e) {
    if (isBlocked()) {
      return;
    }
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
    view.positionDragLayer(e.clientX, e.clientY, dragState.offsetX, dragState.offsetY);
    updateDropTargetHighlight();
  }

  function handlePointerUp(e) {
    if (isBlocked() && dragState && dragState.active) {
      // 自動解答中はドラッグをキャンセル扱い
      view.clearDropHints();
      view.clearDropTargets();
      dragState = null;
      view.hideDragLayer();
      return;
    }
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
      view.clearDropHints();
      view.clearDropTargets();
      let handled = false;
      if (target) {
        const res = app.attemptMove(st.from, target.zone, target.index, { fromDrag: true });
        if (res.ok) {
          handled = true;
        } else if (res.reason === "too-many") {
          view.showToast(view.tooManyMessage(res.limit));
        }
      } else if (tooManyLimit !== null) {
        view.showToast(view.tooManyMessage(tooManyLimit));
      }
      if (handled) {
        view.hideDragLayer();
        return;
      }
      // 戻す: ドラッグレイヤーを元のカード位置へ飛ばしてから再描画する。
      // 元のカードは drag-hidden のままなので、飛行中は見えない。
      const firstEl = st.group.length > 0 ? view.cardElById(st.group[0].id) : null;
      const originRect = firstEl ? firstEl.getBoundingClientRect() : null;
      view.animateDragLayerBack(originRect, () => {
        view.hideDragLayer();
        view.render(app.getState());
      });
      return;
    }
    // クリック扱い
    handleClick(st.targetEl);
  }

  function handlePointerCancel() {
    if (!dragState) {
      return;
    }
    view.clearDropHints();
    view.clearDropTargets();
    dragState = null;
    view.hideDragLayer();
    view.render(app.getState());
  }

  return {
    resetLastClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  };
}
