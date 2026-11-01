/* =========================================================
 * ドパモード 視覚効果 (DOM / Web Animations / Canvas)
 * DOM 要素の探索は view.js が返す stage に閉じ込め、
 * このモジュールから document.querySelector は使わない。
 * 生成ノードは Set/Map で管理し、終了・中断時に必ず掃除する。
 * 増強版の 56 演出は dopa-effects-*.js のハンドラーへ委譲する。
 * ========================================================= */

import { DOPA_EFFECT_META, isDopaEffectId } from "./dopa-effects.js";
import { EFFECT_HANDLERS_A } from "./dopa-effects-a.js";
import { EFFECT_HANDLERS_B } from "./dopa-effects-b.js";
import { EFFECT_HANDLERS_C } from "./dopa-effects-c.js";
import { EFFECT_HANDLERS_D } from "./dopa-effects-d.js";
import { EFFECT_HANDLERS_E } from "./dopa-effects-e.js";
import { EFFECT_HANDLERS_F } from "./dopa-effects-f.js";
import { EFFECT_HANDLERS_G } from "./dopa-effects-g.js";
import { chooseTextAnchor, chooseTextMotion, buildTextTimeline } from "./dopa-text.js";

/** 画像演出用アセット(相対パス) */
export const DOPA_IMAGE_SOURCES = Object.freeze({
  magicCircle: "src/img/magic-circle.png",
  spaceCat: "src/img/space-cat.jpg",
  nebula: "src/img/nebula-backdrop.jpg",
});

const preloadedImages = new Set();

/** ドパ ON 時に画像を先読みする */
export function preloadDopaImages() {
  if (typeof Image !== "function") {
    return;
  }
  for (const src of Object.values(DOPA_IMAGE_SOURCES)) {
    if (preloadedImages.has(src)) {
      continue;
    }
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    preloadedImages.add(src);
  }
}

/** 局所演出(バースト・破片・スパーク等)の拡大倍率 */
export const LOCAL_EFFECT_SCALE = 2.4;

/** 局所演出の飛程・サイズを拡大する(キットのバースト系が使う) */
export function scaleLocalSpread(value) {
  return value * LOCAL_EFFECT_SCALE;
}

/** モバイル・低メモリ端末かどうかを判定する */
function detectMobile() {
  if (typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches) {
    return true;
  }
  if (typeof navigator !== "undefined" && Number(navigator.deviceMemory) <= 4) {
    return true;
  }
  return false;
}

/** ドパモードの視覚効果を生成する。stage は view.js の DOM 窓口 */
export function createDopaVisuals({ stage = null, env = {} } = {}) {
  const scene = stage;
  const mobile = env.mobile ?? detectMobile();
  const reducedMotion = env.reducedMotion ?? false;
  // 増強版: 同時 DOM ノードは 200(モバイル 100)、Canvas は勝利時に 800 まで
  const nodeLimit = mobile ? 100 : 200;
  const trailCards = mobile ? 6 : 8;
  const trailCount = mobile ? 2 : 3;

  const effectHandlers = {
    ...EFFECT_HANDLERS_A,
    ...EFFECT_HANDLERS_B,
    ...EFFECT_HANDLERS_C,
    ...EFFECT_HANDLERS_D,
    ...EFFECT_HANDLERS_E,
    ...EFFECT_HANDLERS_F,
    ...EFFECT_HANDLERS_G,
  };
  let effectActive = 0;
  let effectSequence = 0;
  const effectTimers = new Map();
  const screenEffects = [];
  let lastPlacement = null;
  let lastTextTimeline = null;
  let hitStopCount = 0;
  let lastHitStopMs = 0;
  let hitStopTimer = null;
  let hitStopUntil = 0;
  let hitStopElement = null;
  const pausedAnimations = new Set();

  let enabled = false;
  let dopaGen = 0;
  let winCanvas = null;
  let winRaf = null;
  let winState = null;
  let winHiddenListener = null;
  let playLayer = null; // addNode で実際に使ったレイヤー(掃除時に再生成しない)
  let winLayerEl = null; // 勝利レイヤーの参照(掃除時に再生成しない)
  let dragLayerRef = null; // dragLift で使ったドラッグレイヤー(掃除時に再生成しない)

  const nodeInfo = new Map(); // node -> { priority, anchored, anim }
  const animationSet = new Set();
  const classEffects = []; // { el, className, timer, anchored }
  const timers = new Set();

  function schedule(fn, ms) {
    const handle = setTimeout(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
    return handle;
  }

  function clearTimers() {
    for (const handle of timers) {
      clearTimeout(handle);
    }
    timers.clear();
  }

  function getLayer() {
    return scene && typeof scene.getLayer === "function" ? scene.getLayer() : null;
  }

  function getWinLayer() {
    return scene && typeof scene.getWinLayer === "function" ? scene.getWinLayer() : null;
  }

  function getRect(el) {
    if (!scene || typeof scene.getRect !== "function") {
      return null;
    }
    return scene.getRect(el);
  }

  function getFlightDuration(dist) {
    if (!scene || typeof scene.getFlightDuration !== "function") {
      return Math.min(400, Math.max(150, Math.round(dist * 0.45)));
    }
    return scene.getFlightDuration(dist);
  }

  function getViewport() {
    if (scene && typeof scene.getViewport === "function") {
      return scene.getViewport();
    }
    if (typeof window !== "undefined") {
      return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
    }
    return { width: 1024, height: 768, dpr: 1 };
  }

  function getBoardEl() {
    return scene && typeof scene.getBoardEl === "function" ? scene.getBoardEl() : null;
  }

  /* ---------------- 増強版: 画面効果・汎用キット ---------------- */

  /** 画面全体への transform / filter クラス。同時 2 件まで(超過は捨てる) */
  function applyScreen(classNames, durationMs, vars = null) {
    const el = getBoardEl();
    if (!el) {
      return false;
    }
    if (screenEffects.length >= 2) {
      return false;
    }
    const names = (Array.isArray(classNames) ? classNames : String(classNames).split(/\s+/)).filter(Boolean);
    if (names.length === 0) {
      return false;
    }
    const previousVars = new Map();
    if (vars && typeof vars === "object") {
      for (const [key, value] of Object.entries(vars)) {
        previousVars.set(key, el.style.getPropertyValue(key));
        el.style.setProperty(key, String(value));
      }
    }
    names.forEach((name) => el.classList.add(name));
    const entry = { el, names, timer: null, previousVars };
    entry.timer = schedule(() => removeScreenEffect(entry), Math.max(0, durationMs) + 60);
    screenEffects.push(entry);
    return true;
  }

  function removeScreenEffect(entry) {
    const index = screenEffects.indexOf(entry);
    if (index < 0) {
      return;
    }
    screenEffects.splice(index, 1);
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
      timers.delete(entry.timer);
      entry.timer = null;
    }
    for (const name of entry.names) {
      entry.el.classList.remove(name);
    }
    if (entry.previousVars) {
      for (const [key, value] of entry.previousVars) {
        if (value) {
          entry.el.style.setProperty(key, value);
        } else {
          entry.el.style.removeProperty(key);
        }
      }
    }
  }

  /** 盤面と進行中アニメーションを ms だけ止める。多重時は最長に寄せる */
  function hitStop(ms, options = {}) {
    const max = options.epic ? 300 : 200;
    const requested = Math.max(80, Math.min(max, (Number(ms) || 100) * (options.epic ? 1.6 : 1)));
    hitStopCount += 1;
    lastHitStopMs = Math.round(requested);
    const now = nowMs();
    const end = now + requested;
    if (end <= hitStopUntil) {
      return lastHitStopMs;
    }
    hitStopUntil = end;
    if (hitStopTimer !== null) {
      clearTimeout(hitStopTimer);
      timers.delete(hitStopTimer);
      hitStopTimer = null;
    }
    const board = getBoardEl();
    if (board) {
      hitStopElement = board;
      board.classList.add("dopa-hitstop");
    }
    if (typeof document !== "undefined" && typeof document.getAnimations === "function") {
      for (const anim of document.getAnimations()) {
        if (anim && anim.playState === "running" && typeof anim.pause === "function") {
          try {
            anim.pause();
            pausedAnimations.add(anim);
          } catch {
            // 停止できないアニメーションは無視する
          }
        }
      }
    }
    hitStopTimer = schedule(() => endHitStop(), requested);
    return lastHitStopMs;
  }

  function endHitStop() {
    if (hitStopTimer !== null) {
      clearTimeout(hitStopTimer);
      timers.delete(hitStopTimer);
      hitStopTimer = null;
    }
    hitStopUntil = 0;
    if (hitStopElement) {
      hitStopElement.classList.remove("dopa-hitstop");
      hitStopElement = null;
    }
    for (const anim of pausedAnimations) {
      try {
        if (anim && typeof anim.play === "function") {
          anim.play();
        }
      } catch {
        // 再開できないアニメーションは無視する
      }
    }
    pausedAnimations.clear();
  }

  function beginEffect(durationMs) {
    effectActive += 1;
    effectSequence += 1;
    const key = effectSequence;
    const handle = schedule(() => {
      effectTimers.delete(key);
      effectActive = Math.max(0, effectActive - 1);
    }, Math.max(0, durationMs));
    effectTimers.set(key, handle);
  }

  /** 1 つの演出 ID を再生する。未知 ID は false */
  function playEffect(id, context = {}) {
    if (!isDopaEffectId(id)) {
      return false;
    }
    const meta = DOPA_EFFECT_META[id];
    const handler = effectHandlers[id];
    const base = meta?.duration ?? 800;
    const effective = Number.isFinite(context.duration) ? context.duration : base;
    const timeScale = base > 0 ? effective / base : 1;
    beginEffect(effective);
    if (typeof handler !== "function") {
      return true;
    }
    try {
      handler(makeEffectKit({ ...context, timeScale }), { ...context, id, meta });
    } catch {
      // 1 つの演出の失敗でゲームを止めない
    }
    return true;
  }

  function makeEffectKit(context = {}) {
    const viewport = getViewport();
    const vw = viewport.width || 1024;
    const vh = viewport.height || 768;
    const timeScale = Number.isFinite(context.timeScale) && context.timeScale > 0 ? context.timeScale : 1;

    function make(tag, className, styles) {
      const node = document.createElement(tag);
      if (className) {
        node.className = className;
      }
      if (styles && typeof styles === "object") {
        Object.assign(node.style, styles);
      }
      return node;
    }

    function mount(node, opts = {}) {
      if (!node) {
        return null;
      }
      const duration = (opts.duration ?? 600) * timeScale;
      const delay = (opts.delay ?? 0) * timeScale;
      // epic でも 1 演出の実表示は 6 秒を超えない
      const cappedDuration = Math.min(duration, Math.max(100, 6000 - delay));
      if (!addNode(node, opts.priority ?? 2, opts.anchored ?? false)) {
        return null;
      }
      if (typeof opts.beforeAnimate === "function") {
        try {
          opts.beforeAnimate(node);
        } catch {
          // 測定失敗時はそのまま再生する
        }
      }
      if (opts.frames && typeof node.animate === "function") {
        playNodeAnimation(node, opts.frames, {
          duration: cappedDuration,
          delay,
          easing: opts.easing ?? "ease-out",
          fill: opts.fill ?? "both",
        });
      } else {
        schedule(() => removeNode(node), cappedDuration + delay + 50);
      }
      return node;
    }

    function at(fn, delay) {
      schedule(fn, Math.max(0, delay * timeScale));
    }

    /** カード位置に紐づかないテキストの表示位置を選ぶ */
    function placeText(opts = {}) {
      const anchor = chooseTextAnchor(Math.random, lastPlacement ? lastPlacement.anchor : null);
      const motion = opts.motion ?? chooseTextMotion(Math.random);
      lastPlacement = { anchor: anchor.name, motion };
      return { x: anchor.x * vw, y: anchor.y * vh, anchor: anchor.name, motion };
    }

    /** 一文字ずつフラッシュしながら出現させる */
    function animateLetters(node, content) {
      node.textContent = "";
      const chars = [...String(content)];
      chars.forEach((ch, i) => {
        const span = make("span", "dopa-letter");
        span.textContent = ch === " " ? "\u00a0" : ch;
        node.appendChild(span);
        if (typeof span.animate === "function") {
          span.animate(
            [
              { opacity: 0, transform: "translateY(10px) scale(0.55)" },
              { opacity: 1, transform: "translateY(0) scale(1.12)", offset: 0.5 },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            {
              duration: 230 * timeScale,
              delay: i * 38 * timeScale,
              easing: "ease-out",
              fill: "both",
            }
          );
        }
      });
      return node;
    }

    /** 画像演出の共通部品。黒背景画像は screen 合成で重ねる */
    function showImageEffect(opts = {}) {
      const img = document.createElement("img");
      img.src = opts.src;
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      img.className = `dopa-image ${opts.className ?? ""}`.trim();
      img.style.left = `${opts.x ?? vw / 2}px`;
      img.style.top = `${opts.y ?? vh / 2}px`;
      if (opts.width) {
        img.style.width = `${opts.width}px`;
      }
      if (opts.height) {
        img.style.height = `${opts.height}px`;
      }
      img.style.objectFit = opts.objectFit ?? "contain";
      if (opts.blend) {
        img.style.mixBlendMode = opts.blend;
      }
      const frames = opts.frames ?? [
        { transform: "translate(-50%, -50%) scale(0.2)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.78 },
        { transform: "translate(-50%, -50%) scale(1.08)", opacity: 0 },
      ];
      const mounted = mount(img, {
        duration: opts.duration ?? 1000,
        delay: opts.delay ?? 0,
        priority: opts.priority ?? 2,
        anchored: opts.anchored ?? false,
        easing: opts.easing ?? "ease-out",
        frames,
      });
      if (typeof img.addEventListener === "function") {
        img.addEventListener("error", () => {
          removeNode(img);
          if (typeof opts.onError === "function") {
            opts.onError();
          }
        });
      }
      return mounted;
    }

    /** 文字をラッパー幅(最大 92vw)に収める。必要ならフォントを縮小する */
    function fitText(wrapper, textNode, x, y) {
      if (!textNode || typeof getComputedStyle !== "function") {
        return;
      }
      const maxWidth = vw * 0.72;
      const measure = () =>
        Math.max(
          textNode.scrollWidth,
          textNode.offsetWidth,
          Math.round(textNode.getBoundingClientRect().width)
        );
      let size = parseFloat(getComputedStyle(textNode).fontSize) || 48;
      let guard = 0;
      while (measure() > maxWidth && size > 6 && guard < 60) {
        size *= 0.92;
        textNode.style.fontSize = `${size}px`;
        guard += 1;
      }
      if (measure() > maxWidth) {
        textNode.style.whiteSpace = "normal";
        textNode.style.overflowWrap = "anywhere";
      }
      wrapper.style.maxWidth = `${maxWidth}px`;
      const width = Math.min(maxWidth, measure());
      // hold 中の僅かな拡大・傾けを含めても左右にはみ出さない余白を取る
      const half = (width * 1.2) / 2;
      const clampedX = width * 1.2 >= vw - 16 ? vw / 2 : Math.max(half + 8, Math.min(vw - half - 8, x));
      wrapper.style.left = `${clampedX}px`;
      wrapper.style.top = `${y}px`;
    }

    function text(content, opts = {}) {
      const placement = opts.free ? placeText(opts) : null;
      const framed = !!opts.frame;
      const target = framed
        ? make("div", "dopa-text-wrap")
        : make("div", `dopa-telop ${opts.className ?? ""}`.trim());
      const textNode = framed
        ? make("div", `dopa-telop ${opts.className ?? ""}`.trim())
        : target;
      if (framed) {
        const frame = make("div", `dopa-text-frame ${opts.frame}`.trim());
        target.appendChild(frame);
        target.appendChild(textNode);
      }
      textNode.textContent = content;
      const posX = placement ? placement.x : opts.x ?? vw / 2;
      const posY = placement ? placement.y : opts.y ?? vh / 2;
      target.style.left = `${posX}px`;
      target.style.top = `${posY}px`;
      if (opts.size) {
        textNode.style.fontSize = `${opts.size}px`;
      }
      if (opts.color) {
        textNode.style.color = opts.color;
      }
      if (opts.rotate) {
        target.style.setProperty("--dopa-rotate", `${opts.rotate}deg`);
      }

      const total = (opts.duration ?? 900) * timeScale;
      const timeline = buildTextTimeline(total, { epic: !!context.epic });
      lastTextTimeline = { ...timeline };
      const enterOffset = Math.min(0.45, timeline.enter / total);
      const holdEndOffset = Math.max(enterOffset + 0.1, (timeline.enter + timeline.hold) / total);

      let frames = opts.frames;
      if (!frames && placement) {
        if (placement.motion === "cutin") {
          frames = [
            { transform: "translate(-160%, -50%) skewX(-7deg)", opacity: 0 },
            { transform: "translate(-50%, -50%) skewX(-7deg)", opacity: 1, offset: enterOffset },
            {
              transform: "translate(-50%, -50%) skewX(-7deg) scale(1.03)",
              opacity: 1,
              offset: holdEndOffset,
            },
            { transform: "translate(50%, -50%) skewX(-7deg)", opacity: 0 },
          ];
        } else if (placement.motion === "punch") {
          frames = [
            { transform: "translate(-50%, -50%) scale(3)", opacity: 0 },
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: enterOffset },
            {
              transform: "translate(-50%, -50%) scale(1.045)",
              opacity: 1,
              offset: holdEndOffset,
            },
            { transform: "translate(-50%, -50%) scale(1.15)", opacity: 0 },
          ];
        }
      }

      if (!frames && placement && placement.motion === "letters") {
        animateLetters(textNode, content);
        frames = [
          { transform: "translate(-50%, -50%)", opacity: 0 },
          { transform: "translate(-50%, -50%)", opacity: 1, offset: enterOffset },
          { transform: "translate(-50%, -50%)", opacity: 1, offset: holdEndOffset },
          { transform: "translate(-50%, -50%)", opacity: 0 },
        ];
      }

      if (!frames) {
        frames = [
          { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: enterOffset },
          {
            transform: "translate(-50%, -50%) scale(1.04)",
            opacity: 1,
            offset: holdEndOffset,
          },
          { transform: "translate(-50%, -50%) scale(1.18)", opacity: 0 },
        ];
      }
      return mount(target, {
        duration: opts.duration ?? 900,
        delay: opts.delay ?? 0,
        priority: opts.priority ?? 4,
        anchored: opts.anchored ?? false,
        frames,
        beforeAnimate: () => fitText(target, textNode, posX, posY),
      });
    }

    function burst(opts = {}) {
      const count = opts.count ?? 12;
      const colors = opts.colors ?? ["#e6c15a"];
      const spread = scaleLocalSpread(opts.spread ?? 80);
      const size = scaleLocalSpread(opts.size ?? 6);
      const duration = opts.duration ?? 600;
      const gravity = opts.gravity ?? 0;
      for (let i = 0; i < count; i++) {
        const p = make("div", "dopa-particle");
        p.style.width = `${Math.max(2, size * (0.6 + Math.random() * 0.7))}px`;
        p.style.height = p.style.width;
        p.style.left = `${opts.x ?? vw / 2}px`;
        p.style.top = `${opts.y ?? vh / 2}px`;
        p.style.background = colors[i % colors.length];
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const radius = spread * (0.4 + Math.random() * 0.8);
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius + gravity * 60 * LOCAL_EFFECT_SCALE;
        mount(p, {
          duration: duration * (0.75 + Math.random() * 0.5),
          delay: opts.delay ? opts.delay * Math.random() : 0,
          priority: opts.priority ?? 1,
          frames: [
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.15)`, opacity: 0 },
          ],
        });
      }
    }

    function ring(opts = {}) {
      const width = opts.width ?? 100;
      const height = opts.height ?? 60;
      const node = make("div", `dopa-ring ${opts.className ?? ""}`.trim());
      node.style.left = `${(opts.x ?? vw / 2) - width / 2}px`;
      node.style.top = `${(opts.y ?? vh / 2) - height / 2}px`;
      node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      if (opts.color) {
        node.style.borderColor = opts.color;
        node.style.boxShadow = `0 0 16px 4px ${opts.color}`;
      }
      return mount(node, {
        duration: opts.duration ?? 500,
        delay: opts.delay ?? 0,
        priority: opts.priority ?? 3,
        anchored: opts.anchored ?? false,
        frames: [
          { transform: "scale(0.3)", opacity: 0.95 },
          { transform: "scale(1.25)", opacity: 0 },
        ],
      });
    }

    function flash(opts = {}) {
      const node = make("div", "dopa-flash");
      node.style.background = opts.color ?? "#ffffff";
      if (opts.blend) {
        node.style.mixBlendMode = opts.blend;
      }
      const peak = opts.opacity ?? 0.5;
      return mount(node, {
        duration: opts.duration ?? 300,
        priority: opts.priority ?? 4,
        frames: [
          { opacity: 0 },
          { opacity: peak, offset: 0.18 },
          { opacity: 0 },
        ],
      });
    }

    /** 盤面を着地点方向へ一瞬傾ける(perspective + rotateX/rotateY) */
    function tilt(opts = {}) {
      const x = opts.x ?? vw / 2;
      const y = opts.y ?? vh / 2;
      const nx = (x - vw / 2) / Math.max(1, vw / 2);
      const ny = (y - vh / 2) / Math.max(1, vh / 2);
      const strength = opts.strength ?? 3.4;
      const rotateX = (-ny * strength).toFixed(2);
      const rotateY = (nx * strength).toFixed(2);
      return applyScreen("dopa-fx-tilt", (opts.duration ?? 430) * timeScale, {
        "--dopa-tilt-x": `${rotateX}deg`,
        "--dopa-tilt-y": `${rotateY}deg`,
      });
    }

    /** 背景爆発: 前面演出の背後に大きなフラッシュと粒子を置く */
    function backgroundExplosion(opts = {}) {
      const x = opts.x ?? vw / 2;
      const y = opts.y ?? vh / 2;
      const color = opts.color ?? "#ff8a3c";
      const node = make("div", "dopa-bg-explosion");
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.setProperty("--dopa-bg-color", color);
      mount(node, {
        duration: opts.duration ?? 900,
        priority: 0,
        frames: [
          { transform: "translate(-50%, -50%) scale(0.25)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9, offset: 0.22 },
          { transform: "translate(-50%, -50%) scale(1.45)", opacity: 0 },
        ],
      });
      for (let i = 0; i < (mobile ? 14 : 24); i++) {
        const p = make("div", "dopa-bg-particle");
        p.style.left = `${x}px`;
        p.style.top = `${y}px`;
        p.style.background = color;
        const angle = (i / 24) * Math.PI * 2;
        const dist = (180 + Math.random() * 260) * LOCAL_EFFECT_SCALE;
        mount(p, {
          duration: 900 + Math.random() * 400,
          delay: Math.random() * 120,
          priority: 0,
          frames: [
            { transform: "translate(-50%, -50%) scale(1)", opacity: 0.75 },
            {
              transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${
                Math.sin(angle) * dist
              }px)) scale(0.2)`,
              opacity: 0,
            },
          ],
        });
      }
    }

    function cardRectOf(cardId) {
      if (scene && typeof scene.getCardEl === "function") {
        return getRect(scene.getCardEl(cardId));
      }
      return null;
    }

    function boardRect() {
      const board = getBoardEl();
      const rect = getRect(board);
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: 0, top: 0, width: vw, height: vh };
    }

    function cardCenter(cardId) {
      const rect = cardRectOf(cardId);
      if (rect) {
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect };
      }
      return { x: vw / 2, y: vh * 0.42, rect: null };
    }

    function zoneCenter(zone, index) {
      if (scene && typeof scene.getSlotEl === "function") {
        const rect = getRect(scene.getSlotEl(zone, index));
        if (rect) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, rect };
        }
      }
      return cardCenter(null);
    }

    function cloneCard(cardId) {
      const el = scene && typeof scene.getCardEl === "function" ? scene.getCardEl(cardId) : null;
      const rect = getRect(el);
      if (el && rect) {
        const clone = el.cloneNode(true);
        clone.classList.remove("selected", "movable", "shake", "anim-hidden", "drag-hidden", "drop-hint");
        clone.classList.add("dopa-card-clone");
        clone.style.left = `${rect.left}px`;
        clone.style.top = `${rect.top}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.zIndex = "4";
        return clone;
      }
      const fallback = make("div", "dopa-card-clone dopa-card-fallback");
      const width = 74;
      const height = 104;
      fallback.style.left = `${vw / 2 - width / 2}px`;
      fallback.style.top = `${vh * 0.42 - height / 2}px`;
      fallback.style.width = `${width}px`;
      fallback.style.height = `${height}px`;
      return fallback;
    }

    return {
      vw,
      vh,
      mobile,
      viewport,
      scale: LOCAL_EFFECT_SCALE,
      rand: Math.random,
      pick: (list) => list[Math.floor(Math.random() * list.length)],
      make,
      mount,
      at,
      placeText,
      animateLetters,
      showImageEffect,
      hitStop: (ms) => hitStop(ms, { epic: !!context.epic, timeScale }),
      text,
      burst,
      ring,
      flash,
      tilt,
      backgroundExplosion,
      screen(classNames, durationMs, vars) {
        return applyScreen(classNames, durationMs * timeScale, vars);
      },
      shake(size) {
        const name = size === "lg" ? "dopa-shake-lg" : size === "md" ? "dopa-shake-md" : "dopa-shake-sm";
        const duration = size === "lg" ? 600 : size === "md" ? 500 : 350;
        return applyScreen(name, duration * timeScale);
      },
      cardCenter,
      zoneCenter,
      boardRect,
      cloneCard,
    };
  }

  /** ノードを演出レイヤーへ追加する。上限超過時は低優先度の古いノードを落とす */
  function addNode(node, priority, anchored) {
    const layer = getLayer();
    if (!layer) {
      return null;
    }
    while (nodeInfo.size >= nodeLimit) {
      const victim = findVictim(priority);
      if (!victim) {
        return null;
      }
      removeNode(victim);
    }
    layer.appendChild(node);
    playLayer = layer;
    nodeInfo.set(node, { priority, anchored: !!anchored, anim: null });
    return node;
  }

  function findVictim(priority) {
    let oldest = null;
    let lowest = null;
    for (const [node, info] of nodeInfo) {
      if (info.priority < priority && (!lowest || info.priority < nodeInfo.get(lowest).priority)) {
        lowest = node;
      }
      if (!oldest && info.priority <= priority) {
        oldest = node;
      }
    }
    if (oldest && (lowest === null || nodeInfo.get(oldest).priority <= priority)) {
      return oldest;
    }
    return lowest;
  }

  function removeNode(node) {
    const info = nodeInfo.get(node);
    if (!info) {
      if (node && node.parentNode) {
        node.remove();
      }
      return;
    }
    if (info.anim) {
      animationSet.delete(info.anim);
      try {
        info.anim.cancel();
      } catch {
        // 終了済みなら無視する
      }
    }
    nodeInfo.delete(node);
    if (node.parentNode) {
      node.remove();
    }
  }

  /** DOM 要素のアニメーションを再生し、終了時にノードを掃除する */
  function playNodeAnimation(node, frames, options) {
    if (!nodeInfo.has(node)) {
      return null;
    }
    if (typeof node.animate !== "function") {
      schedule(() => removeNode(node), (options?.duration ?? 200) + (options?.delay ?? 0));
      return null;
    }
    const anim = node.animate(frames, options);
    const info = nodeInfo.get(node);
    if (info) {
      info.anim = anim;
    }
    animationSet.add(anim);
    if (anim.finished && typeof anim.finished.then === "function") {
      anim.finished
        .catch(() => {})
        .then(() => {
          animationSet.delete(anim);
          removeNode(node);
        });
    }
    return anim;
  }

  /** 既存要素へ一時クラスを付与し、ms 後に外す */
  function addClassEffect(el, className, ms, anchored) {
    if (!el) {
      return null;
    }
    el.classList.add(className);
    const entry = { el, className, timer: null, anchored: !!anchored };
    entry.timer = schedule(() => {
      const index = classEffects.indexOf(entry);
      if (index >= 0) {
        classEffects.splice(index, 1);
      }
      el.classList.remove(className);
    }, ms);
    classEffects.push(entry);
    return entry;
  }

  function setTransformOriginCenter(el) {
    if (el && el.style) {
      el.style.transformOrigin = "center center";
    }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) {
      cancelAll();
    }
  }

  // 背景タブでは Canvas の RAF と一時演出を止める(復帰時に再生し直さない)
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        cancelAll();
      }
    });
  }

  /** 位置に依存する演出(残像・リング・発光・輪郭)を中断する */
  function cancelAnchored() {
    dopaGen += 1;
    for (const [node, info] of [...nodeInfo]) {
      if (info.anchored) {
        removeNode(node);
      }
    }
    for (const entry of [...classEffects]) {
      if (entry.anchored) {
        clearTimeout(entry.timer);
        timers.delete(entry.timer);
        entry.el.classList.remove(entry.className);
        const index = classEffects.indexOf(entry);
        if (index >= 0) {
          classEffects.splice(index, 1);
        }
      }
    }
  }

  /** すべての演出を停止してノード・タイマー・Canvas を残さない */
  /** プレイ中の演出だけを止める(勝利 Canvas は残す) */
  function cancelEffects() {
    dopaGen += 1;
    endHitStop();
    for (const entry of [...screenEffects]) {
      removeScreenEffect(entry);
    }
    effectTimers.clear();
    effectActive = 0;
    for (const node of [...nodeInfo.keys()]) {
      removeNode(node);
    }
    for (const entry of classEffects) {
      clearTimeout(entry.timer);
      timers.delete(entry.timer);
      entry.el.classList.remove(entry.className);
    }
    classEffects.length = 0;
    for (const anim of animationSet) {
      try {
        anim.cancel();
      } catch {
        // 終了済みなら無視する
      }
    }
    animationSet.clear();
    clearTimers();
    if (dragLayerRef) {
      dragLayerRef.classList.remove("dopa-drag-lift");
    }
    if (playLayer) {
      playLayer.innerHTML = "";
    }
  }

  function cancelAll() {
    cancelEffects();
    stopWin();
    if (winLayerEl) {
      winLayerEl.innerHTML = "";
    }
  }

  /* ---------------- プレイ中の演出 ---------------- */

  function selectionPulse({ cardId } = {}) {
    if (!scene || typeof scene.getCardEl !== "function") {
      return;
    }
    const el = scene.getCardEl(cardId);
    const rect = getRect(el);
    if (!rect) {
      return;
    }
    const ring = document.createElement("div");
    ring.className = "dopa-ring";
    ring.style.left = `${rect.left}px`;
    ring.style.top = `${rect.top}px`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;
    if (!addNode(ring, 2, true)) {
      return;
    }
    playNodeAnimation(
      ring,
      [
        { transform: "scale(1)", opacity: 0.9 },
        { transform: "scale(1.12)", opacity: 0 },
      ],
      { duration: 220, easing: "ease-out" }
    );
  }

  function dragLift({ on } = {}) {
    const layer = scene && typeof scene.getDragLayer === "function" ? scene.getDragLayer() : null;
    if (!layer) {
      return;
    }
    dragLayerRef = layer;
    layer.classList.toggle("dopa-drag-lift", !!on);
  }

  function flightTrail({ cardIds, origins, duration } = {}) {
    if (!scene || typeof scene.getCardEl !== "function") {
      return;
    }
    const ids = Array.isArray(cardIds) ? cardIds.slice(0, trailCards) : [];
    for (const id of ids) {
      const origin = origins ? origins[id] : null;
      const destEl = scene.getCardEl(id);
      const dest = getRect(destEl);
      if (!origin || !dest) {
        continue;
      }
      const dx = dest.left - origin.left;
      const dy = dest.top - origin.top;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        continue;
      }
      for (let k = 0; k < trailCount; k++) {
        const clone = destEl.cloneNode(true);
        clone.classList.remove("selected", "movable", "shake", "anim-hidden", "drag-hidden", "drop-hint");
        clone.style.left = `${origin.left}px`;
        clone.style.top = `${origin.top}px`;
        clone.style.width = `${origin.width}px`;
        clone.style.height = `${origin.height}px`;
        clone.style.zIndex = "1";
        clone.style.willChange = "transform, opacity";
        clone.style.opacity = "0";
        if (!addNode(clone, 1, true)) {
          break;
        }
        playNodeAnimation(
          clone,
          [
            { transform: "translate(0px, 0px)", opacity: 0.35 },
            { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 },
          ],
          {
            duration: duration ?? getFlightDuration(dist),
            delay: k * 30,
            easing: "ease-out",
            fill: "both",
          }
        );
      }
    }
  }

  function landingBurst({ cardId, zone, index, combo = 1, scale = 1 } = {}) {
    if (!scene) {
      return;
    }
    let el = null;
    if (typeof scene.getCardEl === "function") {
      el = scene.getCardEl(cardId);
    }
    if (!el && typeof scene.getSlotEl === "function") {
      el = scene.getSlotEl(zone, index);
    }
    const rect = getRect(el);
    if (!rect) {
      return;
    }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const suit = Number.isInteger(cardId) ? cardId % 4 : 0;
    const isRed = suit === 1 || suit === 2;
    const base =
      zone === "home" ? 6 + Math.min(combo, 8) : zone === "free" ? 6 : 8;
    let count = Math.min(14, Math.round(base * (scale ?? 1)));
    if (mobile) {
      count = Math.max(3, Math.round(count / 2));
    }
    const gold = "#e6c15a";
    const accent = zone === "home" ? gold : zone === "free" ? "#7fd8ff" : isRed ? "#ff7a7a" : "#cfd8dc";

    for (let i = 0; i < count; i++) {
      const p = document.createElement("div");
      const size = scaleLocalSpread(4 + Math.random() * 4);
      p.className = "dopa-particle";
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.left = `${centerX - size / 2}px`;
      p.style.top = `${centerY - size / 2}px`;
      p.style.background = i % 3 === 0 ? gold : accent;
      if (!addNode(p, 2, false)) {
        break;
      }
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const radius = scaleLocalSpread(26 + Math.random() * 42);
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      playNodeAnimation(
        p,
        [
          { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: 420 + Math.random() * 160, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" }
      );
    }

    if (el) {
      addClassEffect(el, "dopa-land-pulse", 260, true);
    }
  }

  function homeGlow({ index, combo = 1 } = {}) {
    if (!scene || typeof scene.getSlotEl !== "function") {
      return;
    }
    const el = scene.getSlotEl("home", index);
    if (!el) {
      return;
    }
    el.style.setProperty("--dopa-glow", String(Math.min(combo, 12)));
    addClassEffect(el, "dopa-home-glow", 400, true);
  }

  function failFlash({ reason } = {}) {
    if (typeof document === "undefined" || !document.body) {
      return;
    }
    const flash = document.createElement("div");
    flash.className =
      reason === "too-many" ? "dopa-fail-flash dopa-fail-flash--too-many" : "dopa-fail-flash";
    if (!addNode(flash, 3, false)) {
      return;
    }
    const duration = reason === "too-many" ? 420 : 250;
    playNodeAnimation(
      flash,
      [
        { opacity: 0 },
        { opacity: reason === "too-many" ? 0.28 : 0.34 },
        { opacity: 0 },
      ],
      { duration, easing: "ease-out" }
    );
  }

  function dealSparkles() {
    if (!scene || typeof scene.getBoardCardRects !== "function") {
      return;
    }
    const rects = scene.getBoardCardRects();
    if (!rects || rects.length === 0) {
      return;
    }
    const count = mobile ? 8 : 16;
    for (let i = 0; i < count; i++) {
      const r = rects[Math.floor((i / count) * rects.length)];
      const star = document.createElement("div");
      const size = 4 + Math.random() * 3;
      star.className = "dopa-particle";
      star.style.width = `${size}px`;
      star.style.height = `${size}px`;
      star.style.left = `${r.left + r.width / 2}px`;
      star.style.top = `${r.top + r.height / 2}px`;
      star.style.background = "#e6c15a";
      if (!addNode(star, 2, false)) {
        break;
      }
      playNodeAnimation(
        star,
        [
          { transform: "translateY(-70px) scale(0.4)", opacity: 0 },
          { transform: "translateY(0px) scale(1)", opacity: 1, offset: 0.55 },
          { transform: "translateY(10px) scale(0.2)", opacity: 0 },
        ],
        { duration: 600, delay: i * 12, easing: "ease-out" }
      );
    }
    const boardFlash = document.createElement("div");
    boardFlash.className = "dopa-board-flash";
    if (addNode(boardFlash, 2, false)) {
      playNodeAnimation(boardFlash, [{ opacity: 0 }, { opacity: 0.3 }, { opacity: 0 }], {
        duration: 500,
        easing: "ease-out",
      });
    }
  }

  function hintRings({ cardId, destZone, destIndex } = {}) {
    if (!scene) {
      return;
    }
    const targets = [];
    const viewHintEls = typeof scene.getHintEls === "function" ? scene.getHintEls() : [];
    if (Array.isArray(viewHintEls) && viewHintEls.length > 0) {
      targets.push(...viewHintEls);
    } else {
      if (typeof scene.getCardEl === "function") {
        targets.push(scene.getCardEl(cardId));
      }
      if (typeof scene.getSlotEl === "function" && (destZone === "free" || destZone === "home")) {
        targets.push(scene.getSlotEl(destZone, destIndex));
      } else if (typeof scene.getTopCardEl === "function") {
        targets.push(scene.getTopCardEl(destZone, destIndex) ?? scene.getSlotEl(destZone, destIndex));
      }
    }
    for (const el of targets) {
      const rect = getRect(el);
      if (!rect) {
        continue;
      }
      const ring = document.createElement("div");
      ring.className = "dopa-ring dopa-hint-ring";
      ring.style.left = `${rect.left}px`;
      ring.style.top = `${rect.top}px`;
      ring.style.width = `${rect.width}px`;
      ring.style.height = `${rect.height}px`;
      if (!addNode(ring, 2, true)) {
        continue;
      }
      playNodeAnimation(
        ring,
        [
          { transform: "scale(1)", opacity: 0.9 },
          { transform: "scale(1.14)", opacity: 0.15 },
          { transform: "scale(1)", opacity: 0.9 },
          { transform: "scale(1.14)", opacity: 0 },
        ],
        { duration: 900, easing: "ease-in-out" }
      );
    }
  }

  function undoRipple({ cardIds } = {}) {
    const ripple = document.createElement("div");
    ripple.className = "dopa-ripple";
    setTransformOriginCenter(ripple);
    if (addNode(ripple, 2, false)) {
      playNodeAnimation(
        ripple,
        [
          { transform: "scale(0.2)", opacity: 0.85 },
          { transform: "scale(1.7)", opacity: 0 },
        ],
        { duration: 300, easing: "ease-out" }
      );
    }
    if (scene && typeof scene.getCardEl === "function" && Array.isArray(cardIds)) {
      for (const id of cardIds.slice(0, 8)) {
        const el = scene.getCardEl(id);
        if (el) {
          addClassEffect(el, "dopa-land-pulse", 260, true);
        }
      }
    }
  }

  function stuckVignette() {
    const vignette = document.createElement("div");
    vignette.className = "dopa-stuck-vignette";
    if (!addNode(vignette, 3, false)) {
      return;
    }
    playNodeAnimation(vignette, [{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], {
      duration: 900,
      easing: "ease-in-out",
    });
  }

  /* ---------------- 勝利演出 ---------------- */

  const WIN_DURATION_MS = 4500;
  const WIN_FADE_MS = 500;
  const WIN_DISMISS_MS = 300;

  function nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function randomColor() {
    const colors = ["#e6c15a", "#ff7a7a", "#7fd8ff", "#ffffff", "#9fe08a"];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /** 紙吹雪と花火の粒子を作る(デスクトップ 180 / モバイル 90) */
  function createWinParticles(width, height) {
    const confettiCount = mobile ? 54 : 120;
    const fireworkCount = mobile ? 12 : 20;
    const confetti = [];
    for (let i = 0; i < confettiCount; i++) {
      confetti.push({
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.5,
        vx: (Math.random() - 0.5) * 70,
        vy: 70 + Math.random() * 140,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 8,
        size: 4 + Math.random() * 5,
        color: randomColor(),
        shape: Math.random() < 0.35 ? "rect" : "circle",
      });
    }
    const fireworks = [];
    const bursts = [
      { t: 0, x: width * 0.22, y: height * 0.22 },
      { t: 350, x: width * 0.5, y: height * 0.16 },
      { t: 700, x: width * 0.78, y: height * 0.24 },
    ];
    for (const burst of bursts) {
      const color = randomColor();
      for (let i = 0; i < fireworkCount; i++) {
        const angle = (i / fireworkCount) * Math.PI * 2 + Math.random() * 0.2;
        fireworks.push({
          birth: burst.t,
          x: burst.x,
          y: burst.y,
          vx: Math.cos(angle) * (90 + Math.random() * 130),
          vy: Math.sin(angle) * (90 + Math.random() * 130),
          life: 600 + Math.random() * 250,
          color,
        });
      }
    }
    return { confetti, fireworks };
  }

  function drawWinFrame() {
    if (!winState || !winCanvas) {
      return;
    }
    const { ctx2d, width, height, startedAt, particles, fadeStart } = winState;
    const now = nowMs();
    const elapsed = now - startedAt;
    let fade = 1;
    if (elapsed > WIN_DURATION_MS - WIN_FADE_MS) {
      fade = Math.max(0, (WIN_DURATION_MS - elapsed) / WIN_FADE_MS);
    }
    if (fadeStart !== null) {
      fade *= Math.max(0, 1 - (now - fadeStart) / WIN_DISMISS_MS);
    }
    ctx2d.clearRect(0, 0, width, height);
    ctx2d.globalAlpha = fade;

    const t = elapsed / 1000;
    for (const p of particles.confetti) {
      const x = p.x + p.vx * t;
      const y = p.y + p.vy * t + 0.5 * 55 * t * t;
      ctx2d.save();
      ctx2d.translate(x, y);
      ctx2d.rotate(p.rot + p.vr * t);
      ctx2d.fillStyle = p.color;
      ctx2d.globalAlpha = fade * 0.85;
      if (p.shape === "rect") {
        ctx2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else {
        ctx2d.beginPath();
        ctx2d.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx2d.fill();
      }
      ctx2d.restore();
    }

    for (const p of particles.fireworks) {
      const dt = (elapsed - p.birth) / 1000;
      if (dt < 0 || dt > p.life / 1000) {
        continue;
      }
      const alpha = Math.max(0, 1 - dt / (p.life / 1000));
      const x = p.x + p.vx * dt;
      const y = p.y + p.vy * dt + 0.5 * 110 * dt * dt;
      ctx2d.globalAlpha = fade * alpha;
      ctx2d.fillStyle = p.color;
      ctx2d.beginPath();
      ctx2d.arc(x, y, 1.2 + alpha * 1.8, 0, Math.PI * 2);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;

    const dismissing = fadeStart !== null && now - fadeStart >= WIN_DISMISS_MS;
    if (dismissing || elapsed >= WIN_DURATION_MS) {
      stopWin();
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      winRaf = requestAnimationFrame(drawWinFrame);
    }
  }

  function winCelebrate() {
    if (typeof document === "undefined") {
      return;
    }
    // 勝利演出を最優先するため、一時的な DOM 演出を先に片付ける
    cancelAll();
    if (!scene || typeof scene.getWinLayer !== "function") {
      return;
    }
    const layer = scene.getWinLayer();
    if (!layer) {
      return;
    }
    const viewport =
      typeof scene.getViewport === "function" ? scene.getViewport() : { width: 0, height: 0, dpr: 1 };
    const width = viewport.width || 0;
    const height = viewport.height || 0;
    if (width <= 0 || height <= 0) {
      return;
    }
    const dpr = Math.min(viewport.dpr || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.pointerEvents = "none";
    layer.innerHTML = "";
    layer.appendChild(canvas);
    winLayerEl = layer;
    winCanvas = canvas;

    const ctx2d = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx2d) {
      stopWin();
      return;
    }
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    winState = {
      ctx2d,
      width,
      height,
      startedAt: nowMs(),
      particles: createWinParticles(width, height),
      fadeStart: null,
    };

    winHiddenListener = () => {
      if (document.visibilityState === "hidden") {
        stopWin();
      }
    };
    document.addEventListener("visibilitychange", winHiddenListener);

    if (typeof requestAnimationFrame === "function") {
      winRaf = requestAnimationFrame(drawWinFrame);
    }
  }

  function fadeWin() {
    if (!winState || winState.fadeStart !== null) {
      return;
    }
    winState.fadeStart = nowMs();
  }

  function stopWin() {
    if (winRaf !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(winRaf);
    }
    winRaf = null;
    winState = null;
    if (winHiddenListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", winHiddenListener);
    }
    winHiddenListener = null;
    if (winCanvas) {
      winCanvas.width = 0;
      winCanvas.height = 0;
      if (winCanvas.parentNode) {
        winCanvas.remove();
      }
      winCanvas = null;
    }
    if (winLayerEl) {
      winLayerEl.innerHTML = "";
    }
  }

  function getDebugState() {
    return {
      enabled,
      activeEffects:
        effectActive + nodeInfo.size + classEffects.length + screenEffects.length + (winCanvas ? 1 : 0),
      activeNodes: nodeInfo.size,
      activeAnimations: animationSet.size,
      activeClasses: classEffects.length,
      activeScreenEffects: screenEffects.length,
      activeRegistryEffects: effectActive,
      lastPlacement,
      lastTextTimeline,
      hitStopCount,
      lastHitStopMs,
      hitStopActive: hitStopUntil > nowMs(),
      hasWinCanvas: !!winCanvas,
      mobile,
      reducedMotion,
      hasStage: !!scene,
      generation: dopaGen,
    };
  }

  return {
    setEnabled,
    preloadImages: preloadDopaImages,
    playEffect,
    hitStop,
    selectionPulse,
    dragLift,
    flightTrail,
    landingBurst,
    homeGlow,
    failFlash,
    dealSparkles,
    hintRings,
    undoRipple,
    stuckVignette,
    winCelebrate,
    fadeWin,
    cancelAnchored,
    cancelEffects,
    cancelAll,
    getDebugState,
  };
}
