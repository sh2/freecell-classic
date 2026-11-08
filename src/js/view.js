/* =========================================================
 * View 層 (DOM 構築・描画・通知・勝利画面)
 * すべての DOM 参照はこのモジュール内へ閉じ込める。
 * ゲーム状態 (state) は引数で受け取り、直接変更しない。
 * タイマーの経過時間計算や乱数生成などの非 DOM ロジックは持たない。
 * ========================================================= */

import { SUITS, RANKS, NUM_CASCADES, NUM_FREE, NUM_HOME } from "./constants.js";
import * as rules from "./rules.js";
import * as gameState from "./game-state.js";
import { createDragPhysics } from "./drag-physics.js";
import { burst, particleCountFor, canvasDpr } from "./fx.js";
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
import {
  DEAL_EASING,
  DEAL_FLIGHT_MS,
  buildDealOrder,
  computeDealOrigin,
  dealDebug,
  dealDelayMs,
  dealTotalDurationMs,
} from "./deal-animation.js";
import {
  SWEEP_DURATION_MS,
  SWEEP_BAND_RATIO,
  SWEEP_SKEW_DEG,
  SWEEP_LEAD,
  SWEEP_MAIN,
  SWEEP_WHITE,
  SWEEP_TAIL,
  SWEEP_GLOW,
  STATIC_DURATION_MS,
  STATIC_TOP,
  STATIC_BOTTOM,
  STATIC_GLOW,
  chooseSheenMode,
  visibleSheenHeight,
  hintSheenDebug,
} from "./hint-sheen.js";
import {
  RELEASE_INTERVAL_MS,
  FIREWORK_COUNT,
  FIREWORK_DELAY_MS,
  FIREWORK_BURST_LIMIT,
  GRACE_MS,
  STAMP_INTERVAL_MS,
  CARD_BG_TOP,
  CARD_BG_BOTTOM,
  CARD_BORDER,
  CARD_RED,
  CARD_BLACK,
  CORNER_RANK_FONT_RATIO,
  CORNER_SUIT_FONT_RATIO,
  CENTER_RANK_FONT_RATIO,
  CENTER_SUIT_FONT_RATIO,
  CORNER_PAD_X_RATIO,
  CORNER_PAD_Y_RATIO,
  CORNER_GAP_RATIO,
  CARD_RADIUS_RATIO,
  CENTER_MARK_MIN_WIDTH,
  buildReleaseSchedule,
  createFlightState,
  finalFireworkPoint,
  fireworkGapBefore,
  fireworkParticleMultiplier,
  fireworkPoint,
  fireworkSizeMultiplier,
  initialVelocity,
  resolveFloorY,
  stepFlight,
} from "./victory-cascade.js";

/** View を生成する。DOM 要素の参照はクロージャ内に保持する */
export function createView() {
  /* ---------------- DOM 参照 ---------------- */

  const freeSlotEls = [];
  const homeSlotEls = [];
  const cascadeEls = [];
  let dragLayer = null;
  // cardId -> 盤面のカード要素。render() をまたいで保持し、出入りのあった
  // カードだけを生成・破棄する(毎回 52 枚を作り直さない)。
  const cardElMap = new Map();
  // 盤面ジオメトリのキャッシュ。初期化とリサイズのときだけ測り直す(P3)。
  const boardGeometry = {
    cardWidth: 88,
    cardHeight: 124,
    areaTop: 0,
    footerTop: null,
    footerReserve: 68,
    viewportWidth: 0,
    viewportHeight: 0,
    budget: 280,
  };
  let boardGeometryResizeBound = false;
  // 同期描画中だけ対象カードのトランジションを止める(P4)。
  const transitionSuppressEls = new Map();
  let transitionSuppressSeq = 0;
  let toastHandle = null;
  let deal = null; // 進行中の配布アニメーション
  let victory = null; // 進行中の勝利時カスケード
  let victoryAftermath = null; // オーバーレイ表示後も残しているカスケード画像

  /* ---------------- ドラッグの物理 ---------------- */

  // ドラッグレイヤー内のカードに transform で傾き・追随遅れを付ける。
  // 先頭カードの位置 (レイヤーの left/top) は従来どおりポインタへ直接合わせ、
  // 遅らせるのは後続カードの相対オフセットと先頭の傾きだけ。
  let dragPhysics = null;
  let dragPhysicsEls = [];
  let dragRafId = null;
  let dragLastFrameTime = null;
  let dragLastLeft = null;
  let dragLastTop = null;

  /** E2E 検証専用のデバッグ情報 (現在の傾き角と各カードの遅れ量) */
  const dragDebug = { enabled: false, active: false, tilt: 0, velocity: 0, offsets: [] };
  if (typeof window !== "undefined") {
    window.__dragDebug = dragDebug;
  }

  /* ---------------- 勝利時カスケードのデバッグ ---------------- */

  /** E2E 検証専用のデバッグ情報 */
  const victoryDebug = {
    fires: 0, // カスケードを開始した回数
    active: false, // カスケード進行中か
    released: 0, // 今回放出した枚数
    floorTouches: 0, // 今回床に触れたカード数
    fireworks: 0, // 今回打ち上げた仕上げ花火の数
    fireworksLog: [], // 発ごとの記録 { number, sizeMultiplier, particleMultiplier, particleCount, x, y, firedAt, intervalBeforeMs }
    stamps: 0, // 今回スタンプした回数
    resting: 0, // 今回静止してキャンバスへ移したカード数
    restingPositions: [], // 静止したカードの最終位置 { cardId, x, y, width, height }
    skipped: false, // 今回スキップされたか
    interrupted: 0, // 新規ゲームなどで中断された回数
    completed: 0, // 最後まで完了した回数
    visualsRemaining: false, // オーバーレイ表示後もカスケード画像が残っているか
    cleared: false, // カスケード画像を片付け済みか
  };
  if (typeof window !== "undefined") {
    window.__victoryDebug = victoryDebug;
  }

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
    const id = Number(cardId);
    const el = cardElMap.get(id);
    if (el) {
      return el;
    }
    return document.querySelector(`#game .card[data-card-id="${id}"]`);
  }

  // 再描画時に要素から落とす一時クラス。selected / movable は
  // updateHighlights が状態との差分だけを付け替える。
  const CARD_TRANSIENT_CLASSES = [
    "drop-hint",
    "drop-target",
    "drag-hidden",
    "shake",
    "anim-hidden",
    "hint-source",
    "hint-target",
  ];
  const CARD_TRANSITION_CLASSES = new Set([
    "selected",
    "movable",
    "drop-hint",
    "drop-target",
    "hint-source",
    "hint-target",
  ]);

  /** 同期描画中だけ、そのカードのトランジションを止める */
  function suppressCardTransition(el) {
    if (!el) {
      return;
    }
    transitionSuppressSeq++;
    const token = transitionSuppressSeq;
    transitionSuppressEls.set(el, token);
    el.style.transition = "none";
    // 最初の描画を済ませた次のフレームで戻す。連続描画では最新の指定だけ有効。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (transitionSuppressEls.get(el) !== token) {
          return;
        }
        transitionSuppressEls.delete(el);
        el.style.transition = "";
      });
    });
  }

  function clearCardTransitionSuppression(el) {
    if (!el || !transitionSuppressEls.has(el)) {
      return;
    }
    transitionSuppressEls.delete(el);
    el.style.transition = "";
  }

  /**
   * 指定カードの要素を返す。前回の render で使った要素があればそれを再利用し、
   * 再描画で消える一時クラスだけを落とす。選択・移動可能のクラスは
   * updateHighlights が差分で更新する。配置スタイル(top / z-index)は
   * 呼び出し側のゾーンに合わせて設定する。無ければ生成する。
   */
  function reusableCardEl(card) {
    let el = cardElMap.get(card.id);
    if (!el) {
      el = makeCardEl(card);
      cardElMap.set(card.id, el);
      return el;
    }
    for (const cls of CARD_TRANSIENT_CLASSES) {
      if (!el.classList.contains(cls)) {
        continue;
      }
      if (CARD_TRANSITION_CLASSES.has(cls)) {
        suppressCardTransition(el);
      }
      el.classList.remove(cls);
    }
    return el;
  }

  /** 列以外のゾーンへ置くカードから、列用の配置スタイルを落とす */
  function resetCardPlacement(el) {
    if (el.style.top !== "") {
      el.style.top = "";
    }
    if (el.style.zIndex !== "") {
      el.style.zIndex = "";
    }
  }

  /**
   * コンテナ内のカード子要素を desiredEls の順に揃える。
   * desiredEls に無いカードは取り除き、既に同じ並びなら DOM を触らない。
   * ゾーン間を移動した要素は insertBefore で付け替える(要素は作り直さない)。
   */
  function reconcileCards(container, desiredEls) {
    const desired = new Set(desiredEls);
    for (const child of [...container.children]) {
      if (child.classList.contains("card") && !desired.has(child)) {
        container.removeChild(child);
      }
    }
    const current = [];
    for (const child of container.children) {
      if (child.classList.contains("card")) {
        current.push(child);
      }
    }
    if (
      current.length === desiredEls.length &&
      current.every((el, i) => el === desiredEls[i])
    ) {
      return;
    }
    // 後ろから揃えると、動かす必要のある要素だけを挿入できる。
    let next = null;
    for (let i = desiredEls.length - 1; i >= 0; i--) {
      const el = desiredEls[i];
      if (el.parentNode === container && el.nextElementSibling === next) {
        next = el;
        continue;
      }
      container.insertBefore(el, next);
      next = el;
    }
  }

  /**
   * 盤面ジオメトリを実測して保持する(P3)。render() からは呼ばず、
   * 盤面初期化時と resize のときだけ呼ぶ。
   */
  function measureBoardGeometry() {
    const freeSlot = freeSlotEls[0];
    const cascade = cascadeEls[0];
    const footerEl = document.querySelector(".site-footer");
    const gameEl = document.getElementById("game");
    if (freeSlot) {
      const rect = freeSlot.getBoundingClientRect();
      boardGeometry.cardWidth = rect.width || 88;
      boardGeometry.cardHeight = rect.height || 124;
    }
    if (cascade) {
      boardGeometry.areaTop = cascade.getBoundingClientRect().top;
    }
    const footerRect = footerEl ? footerEl.getBoundingClientRect() : null;
    boardGeometry.footerTop = footerRect ? footerRect.top : null;
    boardGeometry.viewportWidth = window.innerWidth;
    boardGeometry.viewportHeight = window.innerHeight;
    const gamePadBottom = gameEl
      ? parseFloat(getComputedStyle(gameEl).paddingBottom) || 0
      : 0;
    boardGeometry.footerReserve =
      gamePadBottom + (footerRect ? footerRect.height : 56) + 12;
    boardGeometry.budget = Math.max(
      280,
      boardGeometry.viewportHeight - boardGeometry.areaTop - boardGeometry.footerReserve
    );
  }

  function bindBoardGeometryResize() {
    if (boardGeometryResizeBound || typeof window === "undefined") {
      return;
    }
    window.addEventListener("resize", measureBoardGeometry);
    boardGeometryResizeBound = true;
  }

  /* ---------------- セル着地エフェクト ---------------- */

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
    const willChangeToken = snapWillChangeEls.get(el);
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
    if (!landing || !animationsEnabled || prefersReducedMotion()) {
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

  /* ---------------- 描画 ---------------- */

  function render(state) {
    // 勝利オーバーレイ表示中はカスケード画像を保持するため再描画しない
    // (モーダルが閉じたとき hideOverlay() が画像を片付ける)
    if (victoryAftermath) {
      if (state.won) {
        return;
      }
      cleanupVictoryVisuals(victoryAftermath);
    }
    // カスケード中に盤面が作り直される場合:
    // - 新しいゲーム (won=false) は演出を中断し、オーバーレイも出さない
    // - 勝利したままの再描画(リサイズ等)は演出を終えて通常表示+オーバーレイへ
    if (victory) {
      if (!state.won) {
        abortVictoryCascade();
      } else {
        finishVictoryCascade({ skipped: false });
        return;
      }
    }
    // 再描画で盤面を更新する前に、進行中の配布と飛行は即座に確定する
    finishDeal({ forced: true });
    cancelActiveFlight();
    const desiredIds = new Set();
    // --- フリーセル ---
    for (let i = 0; i < NUM_FREE; i++) {
      const slot = freeSlotEls[i];
      const card = state.freeCells[i];
      const desired = [];
      if (card) {
        const el = reusableCardEl(card);
        resetCardPlacement(el);
        desired.push(el);
        desiredIds.add(card.id);
      }
      reconcileCards(slot, desired);
    }
    // --- ホーム ---
    // ホームの山札を全カード重ねて描画する(見た目は最上位 1 枚と同じ)。
    // 飛行アニメーションで各カードが個別にホームへ飛べるよう、全カードに
    // DOM 要素を持たせるため(最上位だけ描画すると下のカードの要素が無い)。
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = homeSlotEls[i];
      const pile = state.foundations[i];
      slot.dataset.label = pile.length > 0 ? SUITS[pile[pile.length - 1].suit] : "A";
      const desired = pile.map((card) => {
        const el = reusableCardEl(card);
        resetCardPlacement(el);
        desiredIds.add(card.id);
        return el;
      });
      reconcileCards(slot, desired);
    }
    // --- カスケード ---
    // ジオメトリは初期化・リサイズ時に測って保持した値を使う(P3)。
    // 山の下端がフッター(画面下端に張り付いている)より下に伸びないよう、
    // 「#game の下パディング + フッターの高さ + 余白」を下側の予約域として
    // 確保する。これにより通常のディールでは山が伸縮してもフッターは
    // 押し出されない。予約域を超える極端な積み上げでは budget の下限
    // (280px)が優先され、フッターはコンテンツに押されて下へ追い出される
    // (スクロールで到達できる)
    const cardH = boardGeometry.cardHeight;
    const budget = boardGeometry.budget;
    for (let i = 0; i < NUM_CASCADES; i++) {
      const wrap = cascadeEls[i];
      const pile = state.cascades[i];
      const overlap =
        pile.length > 1
          ? Math.min(34, Math.max(20, (budget - cardH) / (pile.length - 1)))
          : 0;
      // カードは position: absolute でレイアウト高さに反映されないため、
      // 山の見た目の高さを wrap の高さに設定する(後続のフッターなどの
      // 要素がカードの下に回り込まないようにするため)
      wrap.style.height =
        pile.length > 0 ? (pile.length - 1) * overlap + cardH + "px" : "";
      const desired = pile.map((card, idx) => {
        const el = reusableCardEl(card);
        el.style.top = idx * overlap + "px";
        el.style.zIndex = idx + 1;
        desiredIds.add(card.id);
        return el;
      });
      reconcileCards(wrap, desired);
    }
    // 状態から消えたカード(テスト用 fixture など)の要素を片付ける
    for (const [id, el] of cardElMap) {
      if (desiredIds.has(id)) {
        continue;
      }
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      clearSnapWillChange(el);
      clearCardTransitionSuppression(el);
      cardElMap.delete(id);
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
  function setAnimationsEnabled(enabled) {
    animationsEnabled = enabled;
    if (!enabled) {
      if (victory) {
        finishVictoryCascade({ skipped: false });
      }
      armedSteps = [];
      finishDeal({ forced: true });
      cancelActiveFlight();
      clearAllSnapWillChange();
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

  /* =========================================================
   * 配布アニメーション (deal animation)
   * render() 済みの盤面を対象に、上部中央の起点から
   * #anim-layer 上の表向きクローンを飛ばす。実カードは着地まで隠す。
   * ゲーム状態には触れず、見た目の層だけで完結する。
   * ========================================================= */

  /** OS / ブラウザーの reduced-motion 設定が有効か */
  function prefersReducedMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
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

  /* =========================================================
   * 勝利時カスケード (victory cascade)
   * 勝利確定時にホーム 4 山からカードを放り、床で跳ねさせながら
   * #stamp-canvas にカード面を焼き付け、仕上げ花火で締める。
   * ゲーム状態には触れず、表示の層だけで完結する。
   * ========================================================= */

  /** カード面スプライト用の角丸パス */
  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /** 実カードと同じ配色・配置でカード面 1 枚をオフスクリーン Canvas に描く */
  function createCardSprite(card, width, height, dpr) {
    if (!card || typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.scale(dpr, dpr);

    const radius = Math.max(2, width * CARD_RADIUS_RATIO);
    const gradient = ctx.createLinearGradient(0, 0, width * 0.42, height);
    gradient.addColorStop(0, CARD_BG_TOP);
    gradient.addColorStop(1, CARD_BG_BOTTOM);
    roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, radius);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    const color = rules.isRed(card) ? CARD_RED : CARD_BLACK;
    const rankText = RANKS[card.rank];
    const suitText = SUITS[card.suit];
    const rankFont = width * CORNER_RANK_FONT_RATIO;
    const suitFont = width * CORNER_SUIT_FONT_RATIO;
    const padX = width * CORNER_PAD_X_RATIO;
    const padY = height * CORNER_PAD_Y_RATIO;
    const gap = width * CORNER_GAP_RATIO;
    const fontFamily = '"Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';

    const drawCorner = (x, y) => {
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 ${rankFont}px ${fontFamily}`;
      ctx.fillText(rankText, x, y);
      const rankWidth = ctx.measureText(rankText).width;
      ctx.font = `700 ${suitFont}px ${fontFamily}`;
      ctx.fillText(suitText, x + rankWidth + gap, y + (rankFont - suitFont) * 0.55);
    };

    drawCorner(padX, padY);
    ctx.save();
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
    drawCorner(padX, padY);
    ctx.restore();

    if (width >= CENTER_MARK_MIN_WIDTH) {
      const centerRank = width * CENTER_RANK_FONT_RATIO;
      const centerSuit = width * CENTER_SUIT_FONT_RATIO;
      const centerGap = width * 0.02;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${centerRank}px ${fontFamily}`;
      ctx.fillText(rankText, width / 2, height / 2 - (centerSuit + centerGap) / 2);
      ctx.font = `700 ${centerSuit}px ${fontFamily}`;
      ctx.fillText(suitText, width / 2, height / 2 + (centerRank + centerGap) / 2);
    }
    return canvas;
  }

  /** #stamp-canvas / #trail-canvas を解像度上限 2 で初期化する */
  function setupCascadeCanvas(id) {
    const canvas = document.getElementById(id);
    if (!canvas) {
      return null;
    }
    const dpr = canvasDpr(typeof window !== "undefined" ? window.devicePixelRatio : 1);
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    return { canvas, ctx, dpr };
  }

  /** スタンプを全消去する */
  function clearStampCanvas(stamp) {
    if (!stamp || !stamp.ctx) {
      return;
    }
    stamp.ctx.save();
    stamp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    stamp.ctx.clearRect(0, 0, stamp.canvas.width, stamp.canvas.height);
    stamp.ctx.restore();
  }

  /* ---------------- スキップ入力の抑止 ---------------- */

  // カスケード中の最初のポインタ / キー入力はスキップだけに使い、
  // 同じ入力でゲーム操作・ボタン操作が走らないよう capture 段階で止める。
  // スキップ後の click / keyup も 1 回だけ握りつぶす。
  let victoryInput = null;
  let victorySwallow = null;

  function removeVictorySwallow() {
    if (!victorySwallow) {
      return;
    }
    if (victorySwallow.timer !== null) {
      clearTimeout(victorySwallow.timer);
    }
    document.removeEventListener("click", victorySwallow.onClick, true);
    document.removeEventListener("keyup", victorySwallow.onKeyUp, true);
    victorySwallow = null;
  }

  function armVictorySwallow() {
    if (victorySwallow) {
      if (victorySwallow.timer !== null) {
        clearTimeout(victorySwallow.timer);
      }
    } else {
      const onClick = (e) => {
        removeVictorySwallow();
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const onKeyUp = (e) => {
        removeVictorySwallow();
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      document.addEventListener("click", onClick, true);
      document.addEventListener("keyup", onKeyUp, true);
      victorySwallow = { onClick, onKeyUp, timer: null };
    }
    victorySwallow.timer = setTimeout(removeVictorySwallow, 700);
  }

  function installVictoryInput() {
    if (victoryInput) {
      return;
    }
    const onPointerDown = (e) => {
      if (!victory) {
        return;
      }
      armVictorySwallow();
      skipVictoryCascade();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKeyDown = (e) => {
      if (!victory) {
        return;
      }
      armVictorySwallow();
      skipVictoryCascade();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    victoryInput = { onPointerDown, onKeyDown };
  }

  function removeVictoryInput() {
    if (!victoryInput) {
      return;
    }
    document.removeEventListener("pointerdown", victoryInput.onPointerDown, true);
    document.removeEventListener("keydown", victoryInput.onKeyDown, true);
    victoryInput = null;
  }

  /* ---------------- カスケード本体 ---------------- */

  function allVictoryFlightsResting(controller) {
    return controller.flights.length > 0 && controller.flights.every((flight) => flight.resting);
  }

  /** 全カードが放出済みかつ一度は床に触れたら、1 秒後に仕上げ花火を予約する */
  function maybeScheduleVictoryFireworks() {
    const controller = victory;
    if (!controller || controller.finished || controller.fireworksScheduled) {
      return;
    }
    if (!controller.allReleased) {
      return;
    }
    if (!controller.flights.every((flight) => flight.touchedFloor)) {
      return;
    }
    controller.fireworksScheduled = true;
    controller.fireworksTimer = setTimeout(startVictoryFireworks, FIREWORK_DELAY_MS);
  }

  /** 仕上げ花火を 1 発上げ、残りがあれば間隔を空けて次を予約する */
  function launchVictoryFirework() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    const fireNumber = controller.fireworksLaunched + 1;
    const isFinal = fireNumber === FIREWORK_COUNT;
    const point = isFinal
      ? finalFireworkPoint(controller.gameRect)
      : fireworkPoint(Math.random, controller.gameRect);
    const sizeMultiplier = fireworkSizeMultiplier(fireNumber);
    const particleMultiplier = fireworkParticleMultiplier(fireNumber);
    const firedAt = performance.now();
    burst(point.x, point.y, controller.cardWidth, FIREWORK_BURST_LIMIT, {
      sizeMultiplier,
      particleMultiplier,
    });
    const previous = victoryDebug.fireworksLog[victoryDebug.fireworksLog.length - 1];
    victoryDebug.fireworksLog.push({
      number: fireNumber,
      sizeMultiplier,
      particleMultiplier,
      particleCount: particleCountFor(particleMultiplier),
      x: point.x,
      y: point.y,
      firedAt,
      intervalBeforeMs: previous ? firedAt - previous.firedAt : null,
    });
    controller.fireworksLaunched++;
    victoryDebug.fireworks = controller.fireworksLaunched;
    if (controller.fireworksLaunched < FIREWORK_COUNT) {
      const nextNumber = controller.fireworksLaunched + 1;
      controller.fireworksTimer = setTimeout(launchVictoryFirework, fireworkGapBefore(nextNumber));
    } else {
      controller.fireworksTimer = null;
      maybeFinishVictory();
    }
  }

  function startVictoryFireworks() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    launchVictoryFirework();
  }

  /** 全カード静止 + 全花火発射が揃ったら、余韻を置いて終了する */
  function maybeFinishVictory() {
    const controller = victory;
    if (!controller || controller.finished || controller.finishTimer !== null) {
      return;
    }
    if (controller.fireworksLaunched < FIREWORK_COUNT) {
      return;
    }
    if (!allVictoryFlightsResting(controller)) {
      return;
    }
    controller.finishTimer = setTimeout(() => {
      finishVictoryCascade({ skipped: false });
    }, GRACE_MS);
  }

  /**
   * カスケードの画像（クローン・スタンプ・隠していた実カード）を片付ける。
   * オーバーレイが閉じたとき、または中断時に呼ぶ。冪等。
   */
  function cleanupVictoryVisuals(controller) {
    if (!controller || controller.cleaned) {
      return;
    }
    controller.cleaned = true;
    for (const clone of controller.clones) {
      if (clone.parentNode) {
        clone.parentNode.removeChild(clone);
      }
    }
    for (const el of controller.hiddenEls) {
      el.classList.remove("anim-hidden");
    }
    clearStampCanvas(controller.stamp);
    clearStampCanvas(controller.trail);
    if (victoryAftermath === controller) {
      victoryAftermath = null;
    }
    victoryDebug.visualsRemaining = false;
    victoryDebug.cleared = true;
  }

  /**
   * カスケードの進行を終える。interrupted のときは画像を即片付けて
   * オーバーレイを出さない。それ以外は画像を残したまま onComplete
   * (勝利オーバーレイ表示)を呼び、片付けは hideOverlay() に任せる。
   */
  function finishVictoryCascade({ skipped = false, interrupted = false } = {}) {
    const controller = victory;
    if (!controller) {
      return;
    }
    controller.finished = true;
    victory = null;
    if (controller.releaseTimer !== null) {
      clearTimeout(controller.releaseTimer);
      controller.releaseTimer = null;
    }
    if (controller.fireworksTimer !== null) {
      clearTimeout(controller.fireworksTimer);
      controller.fireworksTimer = null;
    }
    if (controller.finishTimer !== null) {
      clearTimeout(controller.finishTimer);
      controller.finishTimer = null;
    }
    if (controller.rafId !== null) {
      cancelAnimationFrame(controller.rafId);
      controller.rafId = null;
    }
    removeVictoryInput();
    victoryDebug.active = false;
    if (interrupted) {
      cleanupVictoryVisuals(controller);
      victoryDebug.interrupted++;
    } else {
      // モーダルの背後にカスケード画像を残す
      if (victoryAftermath) {
        cleanupVictoryVisuals(victoryAftermath);
      }
      victoryAftermath = controller;
      victoryDebug.visualsRemaining = true;
      victoryDebug.cleared = false;
      if (skipped) {
        victoryDebug.skipped = true;
      } else {
        victoryDebug.completed++;
      }
    }
    if (!interrupted && typeof controller.onComplete === "function") {
      controller.onComplete();
    }
  }

  /** 新しいゲームなどで演出だけを中断する(オーバーレイは出さない) */
  function abortVictoryCascade() {
    if (victory) {
      finishVictoryCascade({ interrupted: true });
    }
  }

  /** 入力によるスキップ。片付け後に勝利オーバーレイを出す */
  function skipVictoryCascade() {
    if (victory) {
      finishVictoryCascade({ skipped: true });
    }
  }

  /** 放出予定が残っていれば次の 1 枚を予約する */
  function scheduleNextVictoryRelease() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    if (controller.releaseIndex >= controller.schedule.length) {
      controller.allReleased = true;
      maybeScheduleVictoryFireworks();
      return;
    }
    controller.releaseTimer = setTimeout(releaseVictoryCard, RELEASE_INTERVAL_MS);
  }

  /** 飛行カードの現在位置を指定キャンバスへ描く */
  function stampVictorySprite(controller, flight, target, countStamp) {
    const sprite = controller.sprites.get(flight.cardId);
    if (!sprite) {
      return false;
    }
    target.ctx.drawImage(sprite, flight.x, flight.y, flight.width, flight.height);
    if (countStamp) {
      victoryDebug.stamps++;
    }
    return true;
  }

  /**
   * 飛行が静止したカードを最終位置でスタンプ用キャンバスへ焼き、DOM クローンを外す。
   * 以後の見た目はスタンプ用キャンバスの絵だけになる(B2)。
   * 軌跡は別キャンバス(#trail-canvas)なので、静止後の再スタンプは行わない。
   */
  function restVictoryFlight(controller, flight) {
    stampVictorySprite(controller, flight, controller.stamp, true);
    flight.resting = true;
    controller.restingCount++;
    victoryDebug.resting = controller.restingCount;
    victoryDebug.restingPositions.push({
      cardId: flight.cardId,
      x: flight.x,
      y: flight.y,
      width: flight.width,
      height: flight.height,
    });
    const clone = flight.clone;
    if (clone) {
      if (clone.parentNode) {
        clone.parentNode.removeChild(clone);
      }
      const index = controller.clones.indexOf(clone);
      if (index !== -1) {
        controller.clones.splice(index, 1);
      }
      flight.clone = null;
    }
  }

  /** ホーム山から 1 枚をクローンとして放出する */
  function releaseVictoryCard() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    controller.releaseTimer = null;
    if (controller.releaseIndex >= controller.schedule.length) {
      controller.allReleased = true;
      maybeScheduleVictoryFireworks();
      return;
    }
    const item = controller.schedule[controller.releaseIndex];
    controller.releaseIndex++;
    const realEl = cardElById(item.cardId);
    const sprite = controller.sprites.get(item.cardId);
    if (!realEl || !sprite) {
      scheduleNextVictoryRelease();
      return;
    }
    const rect = realEl.getBoundingClientRect();
    const velocity = initialVelocity();
    const flight = createFlightState({
      x: rect.left,
      y: rect.top,
      width: controller.cardWidth,
      height: controller.cardHeight,
      vx: velocity.vx,
      vy: velocity.vy,
    });
    flight.cardId = item.cardId;
    flight.homeIndex = item.homeIndex;
    flight.realEl = realEl;

    const clone = realEl.cloneNode(true);
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
    clone.classList.add("victory-clone");
    clone.style.left = "0px";
    clone.style.top = "0px";
    clone.style.width = `${flight.width}px`;
    clone.style.height = `${flight.height}px`;
    clone.style.zIndex = String(2000 + controller.releaseIndex);
    clone.style.transform = `translate3d(${flight.x}px, ${flight.y}px, 0px)`;
    getAnimLayer().appendChild(clone);
    realEl.classList.add("anim-hidden");

    flight.clone = clone;
    controller.flights.push(flight);
    controller.clones.push(clone);
    controller.hiddenEls.push(realEl);
    victoryDebug.released = controller.flights.length;
    scheduleNextVictoryRelease();
  }

  /** クローンの位置は transform だけで更新する(left/top は 0 固定) */
  function positionVictoryClone(flight) {
    if (!flight.clone) {
      return;
    }
    flight.clone.style.transform = `translate3d(${flight.x}px, ${flight.y}px, 0px)`;
  }

  /** 放出済みカードの物理更新とスタンプ描画 */
  function victoryTick(now) {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    controller.rafId = null;
    if (controller.lastFrame === null) {
      controller.lastFrame = now;
      controller.lastStamp = now;
    }
    const dt = Math.min(0.05, Math.max(0, (now - controller.lastFrame) / 1000));
    controller.lastFrame = now;

    for (const flight of controller.flights) {
      if (flight.resting) {
        continue;
      }
      const result = stepFlight(flight, dt, controller.bounds);
      if (result.landed) {
        victoryDebug.floorTouches++;
        maybeScheduleVictoryFireworks();
      }
      if (flight.resting) {
        restVictoryFlight(controller, flight);
      } else {
        positionVictoryClone(flight);
      }
    }

    const hasFlying = controller.flights.some((flight) => !flight.resting);
    const stampDue = now - controller.lastStamp >= STAMP_INTERVAL_MS;
    if (hasFlying && stampDue) {
      controller.lastStamp = now;
      for (const flight of controller.flights) {
        if (flight.resting) {
          continue;
        }
        // 軌跡は stamp の下にある専用キャンバスへ描く
        stampVictorySprite(controller, flight, controller.trail, true);
      }
    }

    maybeFinishVictory();
    if (victory === controller && !controller.finished) {
      controller.rafId = requestAnimationFrame(victoryTick);
    }
  }

  /**
   * 勝利時カスケードを開始する。開始できたら true、無効時は false。
   * onComplete は「スキップ or 正常完了」で片付け後に 1 回呼ぶ
   * (新規ゲームによる中断では呼ばない)。
   */
  function startVictoryCascade(state, onComplete) {
    if (victory) {
      return true;
    }
    if (!animationsEnabled || prefersReducedMotion()) {
      return false;
    }
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
    const schedule = buildReleaseSchedule(state.foundations);
    if (schedule.length === 0) {
      return false;
    }
    const layer = getAnimLayer();
    const gameEl = document.getElementById("game");
    const stamp = setupCascadeCanvas("stamp-canvas");
    const trail = setupCascadeCanvas("trail-canvas");
    const firstEl = cardElById(schedule[0].cardId);
    if (!layer || !gameEl || !stamp || !trail || !firstEl) {
      return false;
    }
    // 勝利の最終手がまだ飛んでいる場合、そのクローンと anim-hidden を確定して
    // からカスケードを始める(ホーム山の見た目と隠し状態が競合しないようにする)
    cancelActiveFlight();
    // カード寸法とフッター上端は保持値を使う(P3)
    const cardWidth = boardGeometry.cardWidth || 88;
    const cardHeight = boardGeometry.cardHeight || 124;
    const cardById = new Map();
    for (const pile of state.foundations) {
      for (const card of pile) {
        cardById.set(card.id, card);
      }
    }
    const sprites = new Map();
    for (const item of schedule) {
      const card = cardById.get(item.cardId);
      const sprite = createCardSprite(card, cardWidth, cardHeight, stamp.dpr);
      if (sprite) {
        sprites.set(item.cardId, sprite);
      }
    }
    // 花火の位置は盤面の実寸(ゲーム高さは山の伸びで変わる)から決める。
    // 開始時に一度だけ測る。
    const gameRect = gameEl.getBoundingClientRect();
    const footerTop = boardGeometry.footerTop;
    const controller = {
      onComplete,
      schedule,
      releaseIndex: 0,
      flights: [],
      restingCount: 0,
      clones: [],
      hiddenEls: [],
      sprites,
      stamp,
      trail,
      cardWidth,
      cardHeight,
      gameRect,
      bounds: {
        left: 0,
        right: boardGeometry.viewportWidth || window.innerWidth,
        floor: resolveFloorY(
          footerTop,
          gameRect.bottom,
          boardGeometry.viewportHeight || window.innerHeight
        ),
      },
      releaseTimer: null,
      rafId: null,
      lastFrame: null,
      lastStamp: 0,
      allReleased: false,
      fireworksScheduled: false,
      fireworksTimer: null,
      fireworksLaunched: 0,
      finishTimer: null,
      finished: false,
      cleaned: false,
    };
    victory = controller;
    victoryDebug.fires++;
    victoryDebug.active = true;
    victoryDebug.released = 0;
    victoryDebug.floorTouches = 0;
    victoryDebug.fireworks = 0;
    victoryDebug.fireworksLog = [];
    victoryDebug.stamps = 0;
    victoryDebug.resting = 0;
    victoryDebug.restingPositions = [];
    victoryDebug.skipped = false;
    victoryDebug.visualsRemaining = true;
    victoryDebug.cleared = false;
    installVictoryInput();
    releaseVictoryCard();
    controller.rafId = requestAnimationFrame(victoryTick);
    return true;
  }

  function isVictoryCascadeActive() {
    return victory !== null;
  }

  /** カードのクラスを差分で付け替える。トランジション対象なら同期描画中だけ止める */
  function setCardClass(el, cls, on) {
    if (el.classList.contains(cls) === on) {
      return;
    }
    if (CARD_TRANSITION_CLASSES.has(cls)) {
      suppressCardTransition(el);
    }
    el.classList.toggle(cls, on);
  }

  function updateHighlights(state) {
    const movableIds = new Set();
    for (let i = 0; i < NUM_CASCADES; i++) {
      const pile = state.cascades[i];
      for (let pos = 0; pos < pile.length; pos++) {
        if (rules.isValidSequence(pile.slice(pos))) {
          movableIds.add(pile[pos].id);
        }
      }
    }
    for (let i = 0; i < NUM_FREE; i++) {
      if (state.freeCells[i]) {
        movableIds.add(state.freeCells[i].id);
      }
    }
    const selectedIds = new Set(
      state.selected ? gameState.selectedGroup(state).map((card) => card.id) : []
    );
    for (const [id, el] of cardElMap) {
      setCardClass(el, "movable", movableIds.has(id));
      setCardClass(el, "selected", selectedIds.has(id));
    }
  }

  /* ---------------- コントロール Enable/Disable の一元管理 ---------------- */

  // syncControls が参照する UI 状態(最後に描画したゲーム状態とソルバーUIのフラグを集約)
  let controlsState = {
    lastState: null, // 最後に描画したゲーム状態(render 時に更新)
    autoSolving: false, // 自動解答中(計算・再生)
    solverBusy: false, // ソルバー計算中
    solverMode: null, // "hint" | "auto" | null(ラベル書き換えの対象を限定)
  };

  /** 状態表(docs/ui-state-matrix.md 4章)に準拠してツールバーの disabled を同期する */
  function syncControls() {
    const { lastState, autoSolving: autoSolvingFlag, solverBusy, solverMode } = controlsState;
    const won = lastState ? lastState.won : false;
    const hasHistory = lastState ? lastState.historyStack.length > 0 : false;
    const hasAutoMove = lastState ? gameState.hasAutoMove(lastState) : false;
    const busyHint = solverMode === "hint" && solverBusy;
    const busyAuto = solverMode === "auto" && solverBusy;
    const autoSolving = autoSolvingFlag || busyAuto;

    const newGameBtn = document.getElementById("new-game-btn");
    const restartBtn = document.getElementById("restart-btn");
    const undoBtn = document.getElementById("undo-btn");
    const autoMoveBtn = document.getElementById("auto-move-btn");
    const hintBtn = document.getElementById("hint-btn");
    const autoToggle = document.getElementById("auto-solve-toggle");
    const autoMoveToggle = document.getElementById("auto-move-toggle");
    const seedInput = document.getElementById("seed-input");
    const startBtn = document.getElementById("start-game-btn");

    const disableNewGameRelated = autoSolving;
    if (newGameBtn) {
      newGameBtn.disabled = disableNewGameRelated;
    }
    if (restartBtn) {
      restartBtn.disabled = disableNewGameRelated;
    }
    if (seedInput) {
      seedInput.disabled = disableNewGameRelated;
    }
    if (startBtn) {
      startBtn.disabled = disableNewGameRelated;
    }

    if (undoBtn) {
      undoBtn.disabled = won || !hasHistory || autoSolving;
    }
    if (autoMoveBtn) {
      autoMoveBtn.disabled = won || autoSolving || busyHint || !hasAutoMove;
    }
    if (hintBtn) {
      hintBtn.disabled = won || busyHint || busyAuto;
    }
    if (autoToggle) {
      if (won) {
        autoToggle.disabled = true;
      } else if (busyHint) {
        autoToggle.disabled = true;
      } else {
        autoToggle.disabled = false;
      }
    }
    if (autoMoveToggle) {
      autoMoveToggle.disabled = won || autoSolving;
    }
  }

  function updateStatus(state) {
    controlsState.lastState = state;
    document.getElementById("move-counter").textContent = `手数: ${state.moveCount}`;
    syncControls();
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
    // 勝利直前の render では won がまだ false のため、ここで再度同期する
    // (UI 状態表どおり、完了済みの操作を無効化する)
    syncControls();
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
    // カスケードの画像はモーダルが閉じたタイミングで片付ける。
    // カスケードと無関係な hideOverlay では victoryAftermath が null なので無害。
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
  }

  /* ---------------- やり直し確認ダイアログ ---------------- */

  let confirmResolve = null; // 表示中の Promise の resolve(非 null なら表示中)
  let confirmPrevFocus = null; // 開く前にフォーカスがあった要素

  /** ダイアログを閉じて待ち受けている Promise を確定させる */
  function resolveConfirmDialog(result) {
    if (!confirmResolve) {
      return;
    }
    const resolve = confirmResolve;
    confirmResolve = null;
    document.getElementById("confirm-dialog").classList.add("hidden");
    if (confirmPrevFocus && typeof confirmPrevFocus.focus === "function") {
      confirmPrevFocus.focus();
    }
    confirmPrevFocus = null;
    resolve(result);
  }

  /** ダイアログ内のキー操作。Enter=実行 / Esc=中止。
   *  stopPropagation で app 側のショートカット(Ctrl+Z / Esc)への漏れを防ぐ */
  function onConfirmKeydown(e) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      resolveConfirmDialog(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      resolveConfirmDialog(true);
    }
  }

  /** やり直し確認ダイアログを表示し、実行で true / 中止で false に解決する
   *  Promise を返す。開いている間はキャンセルボタンへフォーカスし、
   *  閉じたら元の要素へフォーカスを戻す */
  function showConfirmRestart() {
    if (confirmResolve) {
      return Promise.resolve(false); // 既に開いている場合は二重表示しない
    }
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmPrevFocus = document.activeElement;
      const dlg = document.getElementById("confirm-dialog");
      dlg.classList.remove("hidden");
      dlg.onkeydown = onConfirmKeydown;
      document.getElementById("confirm-cancel-btn").focus();
    });
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
      createSlotGlow(slot);
      freeSlotEls.push(slot);
    }
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = document.createElement("div");
      slot.className = "slot home";
      slot.dataset.zone = "home";
      slot.dataset.index = i;
      slot.dataset.label = "A";
      homeArea.appendChild(slot);
      createSlotGlow(slot);
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
    // 小破裂用 canvas は初回着地ではなく盤面初期化時に確保・サイズ決定する
    ensureLandingCanvases();
    // 盤面ジオメトリはここで一度だけ測り、以後はリサイズ時だけ更新する(P3)
    measureBoardGeometry();
    bindBoardGeometryResize();
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

  /** 物理を付けてよいか。reduced-motion とアニメーション無効時は従来の剛体ドラッグ */
  function dragPhysicsAllowed() {
    if (!animationsEnabled) {
      return false;
    }
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return false;
    }
    return true;
  }

  function stopDragRaf() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    dragLastFrameTime = null;
  }

  /** 物理状態と transform を破棄する (ドラッグ終了時) */
  function resetDragPhysics() {
    stopDragRaf();
    for (const el of dragPhysicsEls) {
      el.style.transform = "";
    }
    dragPhysics = null;
    dragPhysicsEls = [];
    dragLastLeft = null;
    dragLastTop = null;
    dragDebug.active = false;
    dragDebug.tilt = 0;
    dragDebug.velocity = 0;
    dragDebug.offsets = [];
  }

  /** 物理状態を transform へ反映する */
  function applyDragTransforms() {
    if (!dragPhysics) {
      return;
    }
    const state = dragPhysics.getState();
    const head = dragPhysicsEls[0];
    if (head) {
      head.style.transform =
        Math.abs(state.tilt) < 0.001 ? "" : `rotate(${state.tilt.toFixed(3)}deg)`;
    }
    for (let i = 1; i < dragPhysicsEls.length; i++) {
      const offset = state.offsets[i] ?? { x: 0, y: 0 };
      dragPhysicsEls[i].style.transform =
        Math.abs(offset.x) < 0.01 && Math.abs(offset.y) < 0.01
          ? ""
          : `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)`;
    }
    dragDebug.tilt = state.tilt;
    dragDebug.velocity = state.velocity;
    dragDebug.offsets = state.offsets.map((offset) => ({ x: offset.x, y: offset.y }));
  }

  function dragPhysicsFrame(now) {
    dragRafId = null;
    if (!dragPhysics) {
      return;
    }
    const dt = dragLastFrameTime === null ? 1 / 60 : (now - dragLastFrameTime) / 1000;
    dragLastFrameTime = now;
    dragPhysics.tick(dt, now);
    applyDragTransforms();
    dragRafId = requestAnimationFrame(dragPhysicsFrame);
  }

  function startDragRaf() {
    if (dragRafId !== null) {
      return;
    }
    dragLastFrameTime = null;
    dragRafId = requestAnimationFrame(dragPhysicsFrame);
  }

  /** 掴んだカード群の実際の表示位置を、先頭カード基準の相対オフセットで返す。
   *  列のカード間隔は描画時に 20〜34px で変わるため、固定値で積み直すと
   *  掴んだ瞬間に並びが変わって見える。実レイアウトが取れない場合だけ
   *  従来の 30px をフォールバックに使う。 */
  function dragLayoutOffsets(cards) {
    const headEl = cards.length > 0 ? cardElById(cards[0].id) : null;
    const headRect = headEl ? headEl.getBoundingClientRect() : null;
    return cards.map((card, i) => {
      if (!headRect) {
        return { x: 0, y: i * 30 };
      }
      const el = cardElById(card.id);
      if (!el) {
        return { x: 0, y: i * 30 };
      }
      const rect = el.getBoundingClientRect();
      return { x: rect.left - headRect.left, y: rect.top - headRect.top };
    });
  }

  /** ドラッグレイヤーにカード群を積んで表示する */
  function buildDragLayer(cards) {
    resetDragPhysics();
    const layer = getDragLayer();
    layer.innerHTML = "";
    const offsets = dragLayoutOffsets(cards);
    cards.forEach((card, i) => {
      const el = makeCardEl(card);
      el.style.left = offsets[i].x + "px";
      el.style.top = offsets[i].y + "px";
      layer.appendChild(el);
    });
    layer.style.width = "var(--card-w)";
    layer.style.display = "block";
    dragLastLeft = null;
    dragLastTop = null;
    dragDebug.enabled = dragPhysicsAllowed();
    dragDebug.active = false;
    dragDebug.offsets = cards.map(() => ({ x: 0, y: 0 }));
    if (dragDebug.enabled && cards.length > 0) {
      dragPhysics = createDragPhysics(cards.length);
      dragPhysicsEls = [...layer.querySelectorAll(".card")];
      dragDebug.active = true;
      startDragRaf();
    }
  }

  function positionDragLayer(x, y, offsetX, offsetY) {
    const layer = getDragLayer();
    const left = x - offsetX;
    const top = y - offsetY;
    let dx = 0;
    let dy = 0;
    if (dragLastLeft !== null) {
      dx = left - dragLastLeft;
      dy = top - dragLastTop;
    }
    dragLastLeft = left;
    dragLastTop = top;
    layer.style.left = left + "px";
    layer.style.top = top + "px";
    if (dragPhysics) {
      dragPhysics.moveBy(dx, dy, x, performance.now());
      applyDragTransforms();
    }
  }

  /** ドロップ確定時の準備。先頭の傾きを即座に戻し、矩形を回転前の形にそろえる
   *  (後続カードの遅れはそのまま。getDragCardRects は実際の見た目を返す) */
  function prepareDragForDrop() {
    if (!dragPhysics) {
      return;
    }
    dragPhysics.release();
    applyDragTransforms();
  }

  function hideDragLayer() {
    if (dragLayer) {
      dragLayer.style.display = "none";
    }
    resetDragPhysics();
  }

  /** 移動元のカードを隠す(drag-hidden クラス付与) */
  function hideCards(cardIds) {
    // ドラッグ開始時はヒントの発光も止める(見えているカードが消えるため)
    clearHintSheen();
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

  let hintEls = [];
  let hintTimer = null;
  const HINT_AUTO_HIDE_MS = 10000;

  /* ---------------- ヒント時のカード発光 (hint sheen) ---------------- */

  let sheenLayer = null;
  let sheenEl = null;
  let sheenTimer = null;

  function getSheenLayer() {
    if (!sheenLayer) {
      sheenLayer = document.createElement("div");
      sheenLayer.id = "hint-sheen-layer";
      sheenLayer.setAttribute("aria-hidden", "true");
      document.body.appendChild(sheenLayer);
    }
    return sheenLayer;
  }

  /** 発光要素とタイマーを片付ける (ヒント解除・ドラッグ開始・再表示時) */
  function clearHintSheen() {
    if (sheenTimer !== null) {
      clearTimeout(sheenTimer);
      sheenTimer = null;
    }
    if (sheenEl && sheenEl.parentNode) {
      sheenEl.parentNode.removeChild(sheenEl);
    }
    sheenEl = null;
    hintSheenDebug.active = false;
  }

  function finishHintSheen(el) {
    if (sheenEl !== el) {
      return;
    }
    clearHintSheen();
  }

  /**
   * 移動元カードへ光を 1 回だけ走らせる。
   * 発光要素は専用レイヤー上の別要素で、カード DOM を複製しないため
   * ドラッグレイヤーへ持ち込まれない。後続カードに隠れる範囲は高さを
   * 切り詰め、見えている部分の全体に帯が通るようにする。
   */
  function playHintSheen(srcEl) {
    clearHintSheen();
    if (!srcEl) {
      return;
    }
    const rect = srcEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return;
    }
    const cover = srcEl.nextElementSibling;
    const coverRect =
      cover && cover.classList && cover.classList.contains("card")
        ? cover.getBoundingClientRect()
        : null;
    const height = visibleSheenHeight(rect, coverRect);
    if (!(height > 0)) {
      return;
    }
    const reducedMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mode = chooseSheenMode(animationsEnabled, reducedMotion);
    const band = Math.max(12, Math.round(rect.width * SWEEP_BAND_RATIO));

    const el = document.createElement("div");
    el.className = `hint-sheen hint-sheen--${mode}`;
    if (height < rect.height) {
      el.classList.add("hint-sheen--clipped");
    }
    el.setAttribute("aria-hidden", "true");
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${height}px`;
    el.style.setProperty("--sheen-duration", `${SWEEP_DURATION_MS}ms`);
    el.style.setProperty("--sheen-band", `${band}px`);
    el.style.setProperty("--sheen-skew", `${SWEEP_SKEW_DEG}deg`);
    el.style.setProperty("--sheen-lead", SWEEP_LEAD);
    el.style.setProperty("--sheen-white", SWEEP_WHITE);
    el.style.setProperty("--sheen-main", SWEEP_MAIN);
    el.style.setProperty("--sheen-tail", SWEEP_TAIL);
    el.style.setProperty("--sheen-glow", SWEEP_GLOW);
    el.style.setProperty("--sheen-from", `${-band}px`);
    el.style.setProperty("--sheen-to", `${Math.round(rect.width)}px`);
    el.style.setProperty("--sheen-still-top", STATIC_TOP);
    el.style.setProperty("--sheen-still-bottom", STATIC_BOTTOM);
    el.style.setProperty("--sheen-still-glow", STATIC_GLOW);
    getSheenLayer().appendChild(el);
    sheenEl = el;

    hintSheenDebug.plays++;
    hintSheenDebug.active = true;
    hintSheenDebug.mode = mode;
    hintSheenDebug.cardId = Number(srcEl.dataset.cardId);
    hintSheenDebug.left = rect.left;
    hintSheenDebug.top = rect.top;
    hintSheenDebug.width = rect.width;
    hintSheenDebug.height = height;

    const duration = mode === "sweep" ? SWEEP_DURATION_MS : STATIC_DURATION_MS;
    sheenTimer = setTimeout(() => finishHintSheen(el), duration + 40);
  }

  function clearHint() {
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    clearHintSheen();
    for (const el of hintEls) {
      el.classList.remove("hint-source", "hint-target");
    }
    hintEls = [];
  }

  function showHint(move) {
    clearHint();
    const srcEl = cardElById(move.cardId);
    if (srcEl) {
      srcEl.classList.add("hint-source");
      hintEls.push(srcEl);
      playHintSheen(srcEl);
    }
    let targetEl = null;
    if (move.destZone === "free") {
      targetEl = freeSlotEls[move.destIndex] ?? null;
    } else if (move.destZone === "home") {
      // solverは destIndex をスート固定(0=♣,1=♦,2=♥,3=♠)で返すが、UIの
      // foundations/homeSlotEls は置かれた順(スロット順)のため、スートから
      // 実際のスロットを探す。game-state.js:113-119 と同様の補正を表示でも行う。
      const suit = move.cardId & 3;
      let slot = null;
      // 同スートの山があるスロットを探す
      for (const s of homeSlotEls) {
        const top = s.querySelector(".card:last-child");
        if (top) {
          const topId = Number(top.dataset.cardId);
          if ((topId & 3) === suit) {
            slot = s;
            break;
          }
        }
      }
      // なければ空きスロット( A の移動先 )
      if (!slot) {
        for (const s of homeSlotEls) {
          if (!s.querySelector(".card")) {
            slot = s;
            break;
          }
        }
      }
      // フォールバック(従来の slot順 destIndex)
      if (!slot) {
        slot = homeSlotEls[move.destIndex] ?? null;
      }
      if (slot) {
        const topCardEl = slot.querySelector(".card:last-child");
        targetEl = topCardEl ?? slot;
      }
    } else if (move.destZone === "cascade") {
      const pile = document.querySelectorAll("#game .cascade")[move.destIndex];
      if (pile) {
        const topCardEl = pile.querySelector(".card:last-child");
        targetEl = topCardEl ?? pile.querySelector(".slot");
      }
    }
    if (targetEl) {
      targetEl.classList.add("hint-target");
      hintEls.push(targetEl);
    }
    if (hintEls.length > 0) {
      if (hintTimer !== null) {
        clearTimeout(hintTimer);
      }
      hintTimer = setTimeout(clearHint, HINT_AUTO_HIDE_MS);
    }
    // 次の描画でハイライトが updateHighlights に消されないよう、render 後に再適用が必要なら
    // clearHint は手動操作時や 10 秒経過後に呼ばれる
  }

  function setAutoSolving(solving) {
    controlsState.autoSolving = solving;
    const gameEl = document.getElementById("game");
    if (gameEl) {
      gameEl.classList.toggle("auto-solving", solving);
    }
    // 自動解答の再生中は飛行クローンも盤面と同じ暗さに揃える
    // (通常プレイ・配布・勝利カスケードではクラスを付けない)
    getAnimLayer().classList.toggle("auto-solving", solving);
    syncControls();
  }

  /* ---------------- ヒントボタンの進捗表示 ---------------- */

  // 押下直後はスピナーのみで、一定時間経過しても計算が続いている場合だけ
  // ボタンの文字を段階表示(高速探索中…/安全探索中…)へ切り替える。
  // 即答する盤面(キャッシュヒット・高速で解ける配置)では遅延内に完了するため
  // 文字は一度も変わらずチラつかない。自動解答ラベルはヒント中は変えない。
  const HINT_STAGE_DELAY_MS = 300;
  let hintStageTimer = null;
  let hintStageText = null; // 遅延確定前に届いた最新の段階テキスト

  function stageLabelFor(stage) {
    if (stage === "safe" || stage === "safe2") {
      return "安全探索中…";
    }
    return "高速探索中…";
  }

  /** ヒントボタンへ段階テキストを反映する(遅延確定後に呼ばれる) */
  function applyHintStageText() {
    const btn = document.getElementById("hint-btn");
    if (btn) {
      btn.textContent = hintStageText || stageLabelFor("fast");
    }
  }

  /** ヒント計算の開始: スピナーを即表示し、段階テキストへの切替を遅延させる */
  function beginHintBusy() {
    const btn = document.getElementById("hint-btn");
    if (!btn) {
      return;
    }
    btn.classList.add("busy");
    btn.setAttribute("aria-busy", "true");
    hintStageText = null;
    if (hintStageTimer !== null) {
      clearTimeout(hintStageTimer);
    }
    hintStageTimer = setTimeout(() => {
      hintStageTimer = null;
      applyHintStageText();
    }, HINT_STAGE_DELAY_MS);
  }

  /** ヒント計算の終了: スピナーと段階テキストを解除して「ヒント」へ戻す */
  function endHintBusy() {
    if (hintStageTimer !== null) {
      clearTimeout(hintStageTimer);
      hintStageTimer = null;
    }
    hintStageText = null;
    const btn = document.getElementById("hint-btn");
    if (btn) {
      btn.classList.remove("busy");
      btn.removeAttribute("aria-busy");
      btn.textContent = "ヒント";
    }
  }

  /** ソルバー計算中のUI状態を制御する。
   *  mode="auto": 自動解答。ラベルに状態を表示するが、トグルは有効のまま
   *   (OFFでキャンセルできる)。テキスト幅はCSSで固定しているため位置は動かない。
   *  mode="hint": ヒント。自動解答ラベルは変えず、ヒントボタン自体に
   *   スピナーと段階テキストを表示する(トグルは無効化して自動解答開始を防ぐ)。 */
  function setSolverBusy(busy, mode) {
    if (mode === "auto") {
      controlsState.solverMode = busy ? "auto" : null;
      controlsState.solverBusy = busy;
      const label = document.getElementById("auto-solve-label");
      if (label) {
        if (busy) {
          if (label.dataset.prevText === undefined) {
            label.dataset.prevText = label.textContent;
          }
          label.textContent = "計算中…";
        } else {
          // 完了・キャンセル時は必ず「自動解答」に戻す
          label.textContent = "自動解答";
          delete label.dataset.prevText;
        }
      }
    } else {
      // ヒント計算中: ボタン自体に進捗を出し、トグルのみ無効化
      controlsState.solverMode = busy ? "hint" : null;
      controlsState.solverBusy = busy;
      if (busy) {
        beginHintBusy();
      } else {
        endHintBusy();
      }
    }
    syncControls();
  }

  /** ソルバーの現在段階を表示する。
   *  auto: 自動解答ラベル / hint: ヒントボタンのテキスト(遅延確定後に反映) */
  function setSolverStage(stage) {
    if (controlsState.solverMode === "auto") {
      const label = document.getElementById("auto-solve-label");
      if (label) {
        if (stage === "safe" || stage === "safe2") {
          label.textContent = "安全探索中…";
        } else if (stage === "replay") {
          label.textContent = "自動解答中…";
        } else {
          label.textContent = "高速探索中…";
        }
      }
      return;
    }
    if (controlsState.solverMode === "hint") {
      hintStageText = stageLabelFor(stage);
      if (hintStageTimer === null) {
        // 遅延時間が経過済みなら、届いた段階へ即座に切替える
        applyHintStageText();
      }
    }
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
    showConfirmRestart,
    resolveConfirmDialog,
    cardElById,
    playLandingEffects,
    setAnimationsEnabled,
    startDealAnimation,
    isDealActive,
    skipDeal,
    setNextRenderAnimation,
    showHint,
    clearHint,
    setAutoSolving,
    runAfterAnimations,
    getCardRects,
    getDragCardRects,
    animateDragLayerBack,
    getDragLayer,
    buildDragLayer,
    positionDragLayer,
    prepareDragForDrop,
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
    startVictoryCascade,
    isVictoryCascadeActive,
    skipVictoryCascade,
    abortVictoryCascade,
  };
}
