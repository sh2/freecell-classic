/* =========================================================
 * セル着地エフェクト (スナップ・スロット発光・小破裂)
 * フリーセル / ホームセルへの着地時だけ発火する DOM 演出を担う。
 * 盤面の状態は持たず、必要な要素・判定は deps 経由で受け取る。
 * ========================================================= */

import { canvasDpr } from "./fx.js";
import {
  MAX_SHARD_BURSTS,
  SHARD_DURATION_MS,
  SHARD_LENGTH,
  SHARD_SPEED_MAX,
  SHARD_WIDTH,
  SLOT_GLOW_DURATION_MS,
  SLOT_GLOW_PEAK_ALPHA,
  SLOT_GLOW_RGB,
  SNAP_DURATION_MS,
  SNAP_EASING,
  SNAP_SCALE_START,
  createShards,
  extraEffectFor,
  shardAlphaAt,
  shardColorForSuit,
} from "./landing-fx.js";

/** セル着地エフェクトを生成する */
export function createLandingEffects({
  cardElById,
  isAnimationsEnabled,
  prefersReducedMotion,
  getSnapWillChangeToken,
  clearSnapWillChange,
}) {
  /** E2E 検証専用のデバッグ情報 (発火回数と最終発火の行き先・ランク) */
  const landingDebug = {
    snap: 0, // スナップフィットの発火回数
    burst: 0, // 小破裂の発火回数
    last: null, // 最後に着地エフェクトを出した { zone, rank, cardId, suit }
    activeShardBursts: 0, // 描画中の小破裂数
  };
  if (typeof window !== "undefined") {
    window.__landingFxDebug = landingDebug;
  }

  // 小破裂は勝利花火 (#fx-canvas) と別の、破裂1つ分の小さい canvas に描く。
  // 破片の最大到達距離(速さ最大 × 寿命 + 線の長さ + 線幅 + 余白)を覆う
  // 正方形を、破裂の中心に配置する。
  const LANDING_BURST_RADIUS = Math.ceil(
    SHARD_SPEED_MAX * (SHARD_DURATION_MS / 1000) + SHARD_LENGTH + SHARD_WIDTH / 2 + 6
  );
  const LANDING_BURST_SIZE = LANDING_BURST_RADIUS * 2;
  const landingSurfaces = []; // 同時上限と同じ数だけ用意する canvas プール
  let landingRafId = null;
  let landingLastFrame = null;
  let landingResizeBound = false;
  const shardBursts = [];
  const slotGlowEls = new WeakMap(); // slot -> 事前生成した .slot-glow

  /** canvas の実サイズを devicePixelRatio (上限 2) に合わせて更新する */
  function resizeLandingSurface(surface) {
    const dpr = canvasDpr(window.devicePixelRatio);
    surface.dpr = dpr;
    const canvas = surface.canvas;
    canvas.width = Math.max(1, Math.round(LANDING_BURST_SIZE * dpr));
    canvas.height = Math.max(1, Math.round(LANDING_BURST_SIZE * dpr));
    canvas.style.width = `${LANDING_BURST_SIZE}px`;
    canvas.style.height = `${LANDING_BURST_SIZE}px`;
    surface.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (surface.burst) {
      // リサイズでキャンバスは消える。次のフレームで現在位置を描き直す。
      surface.burst.dirty = null;
      positionLandingSurface(surface, surface.burst);
    }
  }

  function resizeLandingCanvases() {
    for (const surface of landingSurfaces) {
      resizeLandingSurface(surface);
    }
  }

  /** 破裂の中心に小さい canvas を配置する(位置は transform で動かす) */
  function positionLandingSurface(surface, burst) {
    const left = Math.round(burst.x - LANDING_BURST_RADIUS);
    const top = Math.round(burst.y - LANDING_BURST_RADIUS);
    burst.left = left;
    burst.top = top;
    surface.canvas.style.transform = `translate3d(${left}px, ${top}px, 0px)`;
  }

  /** 破裂1つ分の canvas を生成する(index 0 は HTML の既存要素を使う) */
  function createLandingSurface(index) {
    if (typeof document === "undefined") {
      return null;
    }
    let canvas = index === 0 ? document.getElementById("landing-fx-canvas") : null;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = `landing-burst-canvas-${index}`;
      document.body.appendChild(canvas);
    }
    canvas.classList.add("landing-burst-canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.burstSize = String(LANDING_BURST_SIZE);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    const surface = { canvas, ctx, dpr: 1, burst: null };
    resizeLandingSurface(surface);
    canvas.style.visibility = "hidden";
    landingSurfaces.push(surface);
    return surface;
  }

  /** 小破裂用の canvas プールを確保する(盤面初期化時に呼ぶ) */
  function ensureLandingCanvases() {
    if (landingSurfaces.length >= MAX_SHARD_BURSTS) {
      return true;
    }
    while (landingSurfaces.length < MAX_SHARD_BURSTS) {
      if (!createLandingSurface(landingSurfaces.length)) {
        return false;
      }
    }
    if (!landingResizeBound && typeof window !== "undefined") {
      window.addEventListener("resize", resizeLandingCanvases);
      landingResizeBound = true;
    }
    return true;
  }

  /** 空いている破裂用 canvas を返す */
  function freeLandingSurface() {
    return landingSurfaces.find((surface) => surface.burst === null) ?? null;
  }

  /**
   * スロットの光要素を事前生成する。影はここで静止した状態にしておき、
   * 着地時は opacity だけを動かす(着地フレームで要素生成と影の初回描画を
   * 起こさない)。
   */
  function createSlotGlow(slot) {
    const glow = document.createElement("div");
    glow.className = "slot-glow";
    glow.setAttribute("aria-hidden", "true");
    glow.style.boxShadow = `0 0 14px 3px rgba(${SLOT_GLOW_RGB}, ${SLOT_GLOW_PEAK_ALPHA})`;
    slot.appendChild(glow);
    slotGlowEls.set(slot, glow);
    return glow;
  }

  /**
   * 着地先スロットの枠を 260ms だけ光らせる。
   * box-shadow は事前生成した .slot-glow に静止したまま持たせ、
   * その opacity だけを WAAPI で 0 → ピーク → 0 と動かす。
   * ピークの色・広がり・濃さは従来と同じ。
   */
  function playSlotGlow(slot) {
    if (!slot) {
      return;
    }
    let glow = slotGlowEls.get(slot);
    if (!glow) {
      // 通常は buildBoard で生成済み。欠けている場合だけ補う。
      glow = createSlotGlow(slot);
    }
    if (typeof glow.animate !== "function") {
      return;
    }
    for (const anim of glow.getAnimations()) {
      anim.cancel();
    }
    glow.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }],
      { duration: SLOT_GLOW_DURATION_MS, easing: "ease-out" }
    );
  }

  /**
   * 着地した実カードを scale 1.07 → 1 に収める。
   * 飛行クローンではなく実カードへ transform を当てるため、
   * left/top などのレイアウトには影響しない。
   */
  function playSnap(el, zone) {
    if (zone === "free" || zone === "home") {
      const slot = el.closest ? el.closest(".slot") : null;
      if (slot) {
        playSlotGlow(slot);
      }
    }
    const willChangeToken = getSnapWillChangeToken(el);
    if (typeof el.animate !== "function") {
      clearSnapWillChange(el, willChangeToken);
      return;
    }
    const anim = el.animate(
      [{ transform: `scale(${SNAP_SCALE_START})` }, { transform: "scale(1)" }],
      { duration: SNAP_DURATION_MS, easing: SNAP_EASING }
    );
    anim.onfinish = () => {
      anim.cancel();
      // 同じカードが次の飛行を始めていたら、その指定は消さない
      clearSnapWillChange(el, willChangeToken);
    };
  }

  /** 小破裂を 1 回追加する。同時上限を超えたら何もしない。
   *  追加直後に 1 フレーム目を描き、次の rAF を待たずに「はじけ始め」を出す。 */
  function playShardBurst(el, suit) {
    if (shardBursts.length >= MAX_SHARD_BURSTS) {
      return false;
    }
    if (!ensureLandingCanvases()) {
      return false;
    }
    const surface = freeLandingSurface();
    if (!surface) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const burst = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      color: shardColorForSuit(suit),
      shards: createShards(),
      age: 0,
      surface,
      left: 0,
      top: 0,
      dirty: null,
    };
    surface.burst = burst;
    positionLandingSurface(surface, burst);
    surface.ctx.clearRect(0, 0, LANDING_BURST_SIZE, LANDING_BURST_SIZE);
    surface.canvas.style.visibility = "visible";
    shardBursts.push(burst);
    // 発火と同時に最初のフレームを描く(次の rAF を待たない)
    renderShardBurst(burst, 0);
    landingDebug.activeShardBursts = shardBursts.length;
    if (landingRafId === null) {
      landingLastFrame = performance.now();
      landingRafId = window.requestAnimationFrame(landingTick);
    }
    return true;
  }

  /** 2 つの矩形を包含する矩形を返す(片方が null なら他方) */
  function unionRect(a, b) {
    if (!a) {
      return b;
    }
    if (!b) {
      return a;
    }
    return {
      left: Math.min(a.left, b.left),
      top: Math.min(a.top, b.top),
      right: Math.max(a.right, b.right),
      bottom: Math.max(a.bottom, b.bottom),
    };
  }

  /** 破裂の 1 フレームを、その破裂専用の小さい canvas に描く */
  function renderShardBurst(burst, dt) {
    const life = SHARD_DURATION_MS / 1000;
    burst.age += dt;
    if (burst.age >= life) {
      return false;
    }
    const surface = burst.surface;
    const ctx = surface.ctx;
    const centerX = burst.x - burst.left;
    const centerY = burst.y - burst.top;
    const alpha = shardAlphaAt(burst.age / life);
    const pad = SHARD_WIDTH / 2 + 2;
    const segments = [];
    let currentDirty = null;
    for (const shard of burst.shards) {
      const dx = Math.cos(shard.angle);
      const dy = Math.sin(shard.angle);
      const distance = shard.speed * burst.age;
      const x = centerX + dx * distance;
      const y = centerY + dy * distance;
      const ex = x + dx * SHARD_LENGTH;
      const ey = y + dy * SHARD_LENGTH;
      segments.push({ x, y, ex, ey });
      currentDirty = unionRect(currentDirty, {
        left: Math.min(x, ex) - pad,
        top: Math.min(y, ey) - pad,
        right: Math.max(x, ex) + pad,
        bottom: Math.max(y, ey) + pad,
      });
    }

    const dirty = unionRect(burst.dirty, currentDirty);
    if (dirty) {
      ctx.clearRect(dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top);
    }
    ctx.lineWidth = SHARD_WIDTH;
    ctx.lineCap = "round";
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = burst.color;
    for (const segment of segments) {
      ctx.beginPath();
      ctx.moveTo(segment.x, segment.y);
      ctx.lineTo(segment.ex, segment.ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    burst.dirty = currentDirty;
    return true;
  }

  /** 破裂の終了: 小さい canvas を消してプールへ戻す */
  function releaseLandingSurface(surface) {
    if (!surface) {
      return;
    }
    surface.ctx.clearRect(0, 0, LANDING_BURST_SIZE, LANDING_BURST_SIZE);
    surface.canvas.style.visibility = "hidden";
    surface.burst = null;
  }

  /** 小破裂を 1 フレーム分更新・描画する (重力・残像なし)。
   *  破裂ごとの小さい canvas の中だけで消去・描画が完結する。 */
  function landingTick(now) {
    landingRafId = null;
    if (landingSurfaces.length === 0) {
      shardBursts.length = 0;
      landingDebug.activeShardBursts = 0;
      landingLastFrame = null;
      return;
    }
    if (landingLastFrame === null) {
      landingLastFrame = now;
    }
    const dt = Math.min(0.05, Math.max(0, (now - landingLastFrame) / 1000));
    landingLastFrame = now;

    for (let i = shardBursts.length - 1; i >= 0; i--) {
      const burst = shardBursts[i];
      if (!renderShardBurst(burst, dt)) {
        releaseLandingSurface(burst.surface);
        shardBursts.splice(i, 1);
      }
    }
    landingDebug.activeShardBursts = shardBursts.length;

    if (shardBursts.length > 0) {
      landingRafId = window.requestAnimationFrame(landingTick);
    } else {
      landingLastFrame = null;
    }
  }

  /**
   * 着地エフェクトを 1 回出す。
   * フリーセル / ホームセルの着地だけを対象にし、列・無効設定・
   * reduced-motion では何もしない。
   */
  function playLandingEffects(landing) {
    if (!landing || !isAnimationsEnabled() || prefersReducedMotion()) {
      return false;
    }
    const { zone, cardId, rank, suit } = landing;
    if (zone !== "free" && zone !== "home") {
      return false;
    }
    if (!Number.isInteger(cardId) || !Number.isInteger(rank)) {
      return false;
    }
    const el = cardElById(cardId);
    if (!el) {
      return false;
    }

    landingDebug.last = { zone, rank, cardId, suit };
    playSnap(el, zone);
    landingDebug.snap++;

    if (extraEffectFor(zone) === "burst" && playShardBurst(el, suit)) {
      landingDebug.burst++;
    }
    return true;
  }

  return {
    createSlotGlow,
    ensureLandingCanvases,
    playLandingEffects,
  };
}
