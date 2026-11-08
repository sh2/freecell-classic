/* =========================================================
 * カード移動・配布アニメーション
 * render() は即座に完了した盤面を描画する方式を維持し、アニメーションは
 * 専用レイヤー(#anim-layer)上のクローン飛行で表現する。
 * 飛行中、実カードは .anim-hidden で隠す。
 * 盤面の状態は持たず、必要な要素・判定は deps 経由で受け取る。
 * ========================================================= */

import {
  DEAL_EASING,
  DEAL_FLIGHT_MS,
  buildDealOrder,
  computeDealOrigin,
  dealDebug,
  dealDelayMs,
  dealTotalDurationMs,
} from "./deal-animation.js";
import { SNAP_DURATION_MS } from "./landing-fx.js";

/** カード移動・配布アニメーションを生成する */
export function createCardAnimations({
  cardElById,
  getDragLayer,
  prefersReducedMotion,
}) {
  let animLayer = null;
  let armedSteps = []; // 次の render 後に再生するアニメーション手順の予約
  let activeFlight = null; // 飛行中のアニメーション { animations, hiddenEls }
  let afterCallbacks = []; // 飛行完了後に呼ぶコールバック(自動移動の連鎖用)
  let animGen = 0; // 再描画などで古い手順の連鎖を中断するための世代トークン
  let animationsEnabled =
    typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
  let deal = null; // 進行中の配布アニメーション

  // スナップ対象の実カードに付けた will-change を管理する(B)。
  // 同じカードを続けて動かしても古いタイマーが新しい指定を消さないよう、
  // 要素ごとの世代トークンで解除する。
  const snapWillChangeEls = new Map();
  let snapWillChangeSeq = 0;

  /** 着地先カードへ will-change: transform を付け、解除用トークンを返す */
  function markSnapWillChange(el) {
    if (!el) {
      return null;
    }
    snapWillChangeSeq++;
    const token = snapWillChangeSeq;
    snapWillChangeEls.set(el, token);
    el.style.willChange = "transform";
    return token;
  }

  /** will-change を外す。token 指定時は現在のトークンと一致する場合だけ外す */
  function clearSnapWillChange(el, token = undefined) {
    if (!el || !snapWillChangeEls.has(el)) {
      return;
    }
    if (token !== undefined && snapWillChangeEls.get(el) !== token) {
      return;
    }
    snapWillChangeEls.delete(el);
    el.style.willChange = "";
  }

  /** 残っている will-change をすべて外す(中断・アニメーション無効化時) */
  function clearAllSnapWillChange() {
    for (const el of snapWillChangeEls.keys()) {
      el.style.willChange = "";
    }
    snapWillChangeEls.clear();
  }

  function getAnimLayer() {
    if (!animLayer) {
      animLayer = document.createElement("div");
      animLayer.id = "anim-layer";
      document.body.appendChild(animLayer);
    }
    return animLayer;
  }

  /** アニメーションの有効/無効を切り替える(E2E テストでは無効化して使う) */
  function setEnabled(enabled, beforeDisableCleanup = null) {
    animationsEnabled = enabled;
    if (!enabled) {
      if (beforeDisableCleanup) {
        beforeDisableCleanup();
      }
      armedSteps = [];
      finishDeal({ forced: true });
      cancelActiveFlight();
      clearAllSnapWillChange();
    }
  }

  function isEnabled() {
    return animationsEnabled;
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
    const layer = getDragLayer();
    if (layer) {
      layer.querySelectorAll(".card").forEach((el) => {
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
        clearSnapWillChange(el);
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
        // 着地先の実カードを先に合成レイヤーへ載せ、着地フレームで
        // スナップ(scale)がメインスレッドの混雑に巻き込まれないようにする。
        const willChangeToken = markSnapWillChange(el);
        // 何らかの理由でスナップが走らなくても外し忘れないための保険
        window.setTimeout(
          () => clearSnapWillChange(el, willChangeToken),
          flightDuration(dist) + SNAP_DURATION_MS + 100
        );
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
        cards.push({ el, clone, dx, dy, dist, willChangeToken });
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
            // フリー／ホームへの着地はスナップ終了まで will-change を維持する。
            // 列への着地(スナップなし)・reduced-motion ではここで外す。
            const keepsForSnap =
              !prefersReducedMotion() && c.el.closest(".slot.free, .slot.home") !== null;
            if (!keepsForSnap) {
              clearSnapWillChange(c.el, c.willChangeToken);
            }
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
    const layer = getDragLayer();
    if (!animationsEnabled || !originRect || !layer || layer.style.display === "none") {
      onDone();
      return;
    }
    const layerRect = layer.getBoundingClientRect();
    const dx = originRect.left - layerRect.left;
    const dy = originRect.top - layerRect.top;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      onDone();
      return;
    }
    const anim = layer.animate(
      [{ transform: "translate(0px, 0px)" }, { transform: `translate(${dx}px, ${dy}px)` }],
      { duration: flightDuration(dist), easing: "ease-out", fill: "forwards" }
    );
    anim.onfinish = () => {
      anim.cancel(); // transform を戻す(同じタスク内で隠すためスナップは見えない)
      onDone();
    };
  }

  /** 配布を即座に確定する(スキップ・無効化・再描画時) */
  function finishDeal({ skipped = false, forced = false } = {}) {
    if (!deal) {
      return false;
    }
    const current = deal;
    deal = null;
    for (const anim of current.animations) {
      try {
        anim.cancel();
      } catch {
        // 既に終了している場合は何もしない
      }
    }
    for (const clone of current.clones) {
      clone.remove();
    }
    for (const el of current.hiddenEls) {
      el.classList.remove("anim-hidden");
    }
    dealDebug.dealtCount = current.total;
    dealDebug.skipped = skipped;
    dealDebug.active = false;
    if (forced) {
      dealDebug.forced++;
    }
    return true;
  }

  /** 配布中なら即座に全カードを配置し終えて終了する。スキップできたら true */
  function skipDeal() {
    return finishDeal({ skipped: true });
  }

  /** 配布中か */
  function isDealActive() {
    return deal !== null;
  }

  /**
   * 新しいゲームの描画直後に呼ぶ。配布対象を状態から作り、起点と
   * 着地先の位置をレイアウトから求めてクローン飛行を開始する。
   * アニメーション無効・reduced-motion・対象 0 枚なら何も隠さない。
   */
  function startDealAnimation(state) {
    finishDeal({ forced: true });
    const order = buildDealOrder(state.cascades);
    dealDebug.plays++;
    dealDebug.cardCount = order.length;
    dealDebug.durationMs = dealTotalDurationMs(order.length);
    dealDebug.dealtCount = 0;
    dealDebug.skipped = false;
    dealDebug.active = false;

    if (order.length === 0) {
      return;
    }
    if (!animationsEnabled || prefersReducedMotion()) {
      dealDebug.dealtCount = order.length;
      dealDebug.immediate++;
      return;
    }

    const topArea = document.querySelector(".top-area");
    const cascadeArea = document.getElementById("cascade-area");
    const freeArea = document.getElementById("free-cells");
    const homeArea = document.getElementById("home-cells");
    const gameEl = document.getElementById("game");
    const firstEl = cardElById(order[0].cardId);
    if (!topArea || !gameEl || !firstEl) {
      dealDebug.dealtCount = order.length;
      dealDebug.immediate++;
      return;
    }
    const cardRect = firstEl.getBoundingClientRect();
    const originRect = computeDealOrigin({
      topArea: topArea.getBoundingClientRect(),
      cascadeArea: cascadeArea ? cascadeArea.getBoundingClientRect() : null,
      game: gameEl.getBoundingClientRect(),
      freeArea: freeArea ? freeArea.getBoundingClientRect() : null,
      homeArea: homeArea ? homeArea.getBoundingClientRect() : null,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
    });
    if (!originRect) {
      dealDebug.dealtCount = order.length;
      dealDebug.immediate++;
      return;
    }

    // 先に着地先を測り、全実カードを隠す(描画前に隠すのでチラつかない)
    const entries = [];
    const hiddenEls = [];
    for (const item of order) {
      const el = cardElById(item.cardId);
      if (!el) {
        continue;
      }
      const dest = el.getBoundingClientRect();
      el.classList.add("anim-hidden");
      hiddenEls.push(el);
      entries.push({ ...item, el, dest });
    }
    if (entries.length === 0) {
      return;
    }

    const layer = getAnimLayer();
    const originX = originRect.left;
    const originY = originRect.top;
    const current = {
      entries,
      hiddenEls,
      clones: [],
      animations: [],
      finishedCount: 0,
      total: entries.length,
    };
    deal = current;
    dealDebug.active = true;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const clone = entry.el.cloneNode(true);
      clone.classList.remove(
        "selected",
        "movable",
        "shake",
        "anim-hidden",
        "hint-source",
        "hint-target",
        "drop-hint",
        "drop-target",
        "drag-hidden"
      );
      clone.classList.add("deal-clone");
      clone.style.left = `${originX}px`;
      clone.style.top = `${originY}px`;
      clone.style.width = `${entry.dest.width}px`;
      clone.style.height = `${entry.dest.height}px`;
      // 起点では次に飛ぶカードが一番上に見えるよう、先に配るカードほど
      // 手前の z-index にする(全クローンは同じ起点に重なって待機する)。
      clone.style.zIndex = String(entries.length - i);
      layer.appendChild(clone);
      const dx = entry.dest.left - originX;
      const dy = entry.dest.top - originY;
      if (typeof clone.animate !== "function") {
        finishDeal({ forced: true });
        return;
      }
      const anim = clone.animate(
        [{ transform: "translate(0px, 0px)" }, { transform: `translate(${dx}px, ${dy}px)` }],
        {
          duration: DEAL_FLIGHT_MS,
          delay: dealDelayMs(i),
          easing: DEAL_EASING,
          fill: "both",
        }
      );
      anim.onfinish = () => {
        entry.el.classList.remove("anim-hidden");
        clone.remove();
        if (deal !== current) {
          return;
        }
        current.finishedCount++;
        dealDebug.dealtCount = current.finishedCount;
        if (current.finishedCount >= current.total) {
          finishDeal();
        }
      };
      current.animations.push(anim);
      current.clones.push(clone);
    }
  }

  return {
    getAnimLayer,
    setEnabled,
    isEnabled,
    getCardRects,
    getDragCardRects,
    setNextRenderAnimation,
    cancelActiveFlight,
    runAfterAnimations,
    playArmedAnimations,
    animateDragLayerBack,
    startDealAnimation,
    finishDeal,
    skipDeal,
    isDealActive,
    getSnapWillChangeToken: (el) => snapWillChangeEls.get(el),
    clearSnapWillChange,
  };
}
