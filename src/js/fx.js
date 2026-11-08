/* =========================================================
 * 視覚効果 (fx)
 * 勝利時の仕上げ花火用のパーティクル演出。
 * 下の「調整用定数」だけを変更すれば見た目を調整できる。
 *
 * セル着地時のスナップ・小破裂は landing-fx.js / view.js 側で行う。
 * ========================================================= */

/* ---------------- 調整用定数 ---------------- */

/** 1 回のバーストで出すパーティクル数 */
export const PARTICLE_COUNT = 96;

/** パーティクルの色。バーストごとにこの中から 1 色を選ぶ */
export const COLORS = ["#e0a916", "#ef7d9c", "#45a5e8", "#8656e8", "#34b26b"];

/** バースト全体の持続時間 (ミリ秒) */
export const DURATION_MS = 1000;

/** 重力 (px/s^2)。弱めに沈む */
export const GRAVITY = 115;

/** 輪郭集団の基準初速 (px/s) */
export const SPEED = 300;

/** パーティクルの半径の基準値 (px)。実際は 0.75〜1.25 倍でばらつく */
export const PARTICLE_SIZE = 3.0;

/** 乗算ブレーキの減衰率 (/s) */
export const BRAKE = 2.2;

/** 粒ごとの寿命ばらつき。寿命は DURATION_MS の (1 - LIFE_JITTER)〜1 倍 */
export const LIFE_JITTER = 0.3;

/** 寿命のこの割合までは alpha・大きさを変えない */
export const FADE_START = 0.7;

/** 輪郭集団の割合 (残りは内側集団) */
export const OUTLINE_RATIO = 0.55;

/** 輪郭集団の速さ係数 */
export const OUTLINE_SPEED_MIN = 0.9;
export const OUTLINE_SPEED_MAX = 1.0;

/** 内側集団の速さ係数 */
export const INNER_SPEED_MIN = 0.1;
export const INNER_SPEED_MAX = 0.9;

/** 余燼表現を有効にするか */
export const EMBER_ENABLED = true;

/** 余燼の色 (赤黒) */
export const EMBER_COLOR = "#571f16";

/** 余燼を始める寿命進行度の範囲 (粒ごとに決める) */
export const EMBER_THRESHOLD_MIN = 0.55;
export const EMBER_THRESHOLD_MAX = 0.68;

/** 余燼への遷移にかける寿命比 */
export const EMBER_TRANSITION = 0.1;

/** 残像を出す間隔 (ミリ秒) と個体差 */
export const TRAIL_INTERVAL_MS = 120;
export const TRAIL_INTERVAL_JITTER = 0.25;

/** 残像の寿命 (ミリ秒) */
export const TRAIL_LIFE_MS_MIN = 500;
export const TRAIL_LIFE_MS_MAX = 800;

/** 残像の沈む速さ (px/s) */
export const TRAIL_SPEED_MIN = 12;
export const TRAIL_SPEED_MAX = 48;

/** 残像の初期 alpha */
export const TRAIL_ALPHA = 0.5;

/** 残像の総数上限 */
export const MAX_TRAILS = 240;

/** 基準となるホームセル幅 (px)。これより狭い画面では効果を比例縮小する */
export const BASE_CARD_WIDTH = 88;

/** 発火点の縦位置。対象セルの上端から高さに対する比率 */
export const ORIGIN_Y_RATIO = 0.33;

/** 同時に存在できるバースト数の上限。超過分は捨てる */
export const MAX_BURSTS = 3;

/* ---------------- 実装 ---------------- */

const activeBursts = [];
const ghosts = [];
let canvas = null;
let ctx = null;
let viewWidth = 0;
let viewHeight = 0;
let rafId = null;
let lastFrameTime = null;
let resizeBound = false;

/** E2E 検証専用のデバッグ情報 */
const debug = { bursts: 0, lastScale: 1, lastColor: null, trails: 0 };
if (typeof window !== "undefined") {
  window.__fxDebug = debug;
}

/** 0〜1 に丸める */
function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/** 粒のインデックスから集団を返す */
export function groupForIndex(index, total = PARTICLE_COUNT) {
  const outlineCount = Math.round(total * OUTLINE_RATIO);
  return index < outlineCount ? "outline" : "inner";
}

/** 集団ごとの速さ係数レンジ */
export function speedRangeForGroup(group) {
  if (group === "outline") {
    return { min: OUTLINE_SPEED_MIN, max: OUTLINE_SPEED_MAX };
  }
  return { min: INNER_SPEED_MIN, max: INNER_SPEED_MAX };
}

/**
 * 直前のバースト色を除いて、次のバースト色を選ぶ。
 * previousColor が null / 候補外なら全色から選ぶ。
 */
export function pickBurstColor(previousColor, random = Math.random) {
  const candidates = COLORS.filter((color) => color !== previousColor);
  const pool = candidates.length > 0 ? candidates : COLORS;
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[index];
}

/**
 * 寿命進行度 p から、alpha と大きさの係数を返す。
 * FADE_START までは 1 のまま、そこから寿命末に向けて alpha 0・大きさ 0.4 へ。
 */
export function fadeFactors(progress) {
  const p = clamp01(progress);
  if (p <= FADE_START) {
    return { alpha: 1, size: 1 };
  }
  const t = clamp01((p - FADE_START) / (1 - FADE_START));
  return {
    alpha: 1 - t,
    size: 1 - 0.6 * t,
  };
}

/** 余燼を始める条件を満たすか */
export function shouldStartEmber(vy, progress, threshold, enabled = EMBER_ENABLED) {
  if (!enabled) {
    return false;
  }
  return vy > 0 && clamp01(progress) > threshold;
}

/** 16 進カラーを RGB に分解する */
function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/** RGB を 16 進カラーへ戻す */
function rgbToHex(r, g, b) {
  const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * 余燼の色を返す。emberStart が null なら元の色のまま。
 * emberStart から EMBER_TRANSITION の寿命比で EMBER_COLOR へ遷移する。
 */
export function emberColorForProgress(baseColor, emberStart, progress, enabled = EMBER_ENABLED) {
  if (!enabled || emberStart === null) {
    return baseColor;
  }
  const p = clamp01(progress);
  if (p <= emberStart) {
    return baseColor;
  }
  const t = clamp01((p - emberStart) / EMBER_TRANSITION);
  const start = hexToRgb(baseColor);
  const end = hexToRgb(EMBER_COLOR);
  return rgbToHex(
    start.r + (end.r - start.r) * t,
    start.g + (end.g - start.g) * t,
    start.b + (end.b - start.b) * t
  );
}

/** OS / ブラウザーの reduced-motion 設定が有効か */
function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** canvas の実サイズを devicePixelRatio に合わせて更新する */
function resizeCanvas() {
  if (!canvas || !ctx) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = Math.max(1, Math.round(viewWidth * dpr));
  canvas.height = Math.max(1, Math.round(viewHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** 描画用 canvas を取得する。HTML に無ければ生成する */
function ensureCanvas() {
  if (canvas && ctx) {
    return true;
  }
  if (typeof document === "undefined") {
    return false;
  }
  canvas = document.getElementById("fx-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "fx-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
  }
  ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas = null;
    return false;
  }
  resizeCanvas();
  if (!resizeBound && typeof window !== "undefined") {
    window.addEventListener("resize", resizeCanvas);
    resizeBound = true;
  }
  return true;
}

/** 残像を追加する。上限を超えたら古いものから捨てる */
function addGhost(x, y, size, color, scale) {
  if (ghosts.length >= MAX_TRAILS) {
    ghosts.shift();
  }
  ghosts.push({
    x,
    y,
    size,
    color,
    age: 0,
    life: (TRAIL_LIFE_MS_MIN + Math.random() * (TRAIL_LIFE_MS_MAX - TRAIL_LIFE_MS_MIN)) / 1000,
    vy: (TRAIL_SPEED_MIN + Math.random() * (TRAIL_SPEED_MAX - TRAIL_SPEED_MIN)) * scale,
  });
}

/** パーティクルと残像を 1 フレーム分更新・描画する */
function drawFrame(now) {
  rafId = null;
  if (!ctx) {
    activeBursts.length = 0;
    ghosts.length = 0;
    debug.trails = 0;
    lastFrameTime = null;
    return;
  }
  if (lastFrameTime === null) {
    lastFrameTime = now;
  }
  const dt = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  const particleDraws = [];
  for (let i = activeBursts.length - 1; i >= 0; i--) {
    const burst = activeBursts[i];
    const gravity = GRAVITY * burst.scale;
    const damping = Math.exp(-BRAKE * dt);
    let alive = false;
    for (const particle of burst.particles) {
      particle.age += dt;
      if (particle.age >= particle.life) {
        continue;
      }
      alive = true;
      particle.vx *= damping;
      particle.vy *= damping;
      particle.vy += gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;

      const progress = particle.age / particle.life;
      if (
        particle.emberStart === null &&
        shouldStartEmber(particle.vy, progress, particle.emberThreshold)
      ) {
        particle.emberStart = progress;
      }
      const color = emberColorForProgress(burst.color, particle.emberStart, progress);
      const fade = fadeFactors(progress);

      const ageMs = particle.age * 1000;
      while (ageMs >= particle.nextTrailAt) {
        addGhost(particle.x, particle.y, particle.size * fade.size, color, burst.scale);
        particle.nextTrailAt += particle.trailIntervalMs;
      }

      particleDraws.push({
        x: particle.x,
        y: particle.y,
        size: particle.size * fade.size,
        alpha: fade.alpha,
        color,
      });
    }
    if (!alive) {
      activeBursts.splice(i, 1);
    }
  }

  const ghostDraws = [];
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const ghost = ghosts[i];
    ghost.age += dt;
    if (ghost.age >= ghost.life) {
      ghosts.splice(i, 1);
      continue;
    }
    ghost.y += ghost.vy * dt;
    const progress = clamp01(ghost.age / ghost.life);
    ghostDraws.push({
      x: ghost.x,
      y: ghost.y,
      size: ghost.size * (1 - 0.6 * progress),
      alpha: TRAIL_ALPHA * (1 - progress),
      color: ghost.color,
    });
  }
  debug.trails = ghosts.length;

  ctx.clearRect(0, 0, viewWidth, viewHeight);
  ctx.globalCompositeOperation = "lighter";
  for (const ghost of ghostDraws) {
    ctx.globalAlpha = ghost.alpha;
    ctx.fillStyle = ghost.color;
    ctx.beginPath();
    ctx.arc(ghost.x, ghost.y, ghost.size, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const particle of particleDraws) {
    ctx.globalAlpha = Math.min(1, particle.alpha);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  if (activeBursts.length > 0 || ghosts.length > 0) {
    rafId = window.requestAnimationFrame(drawFrame);
  } else {
    lastFrameTime = null;
    ctx.clearRect(0, 0, viewWidth, viewHeight);
  }
}

/**
 * 指定座標 (ビューポート座標) でパーティクル花火を 1 回発火する。
 * cardWidth が基準幅より小さい場合は、広がり・粒・重力を比例縮小する。
 * reduced-motion 時、同時バースト上限超過時は何もせず false を返す。
 * maxBursts は 1 回の呼び出しだけ同時上限を引き上げる(既定は MAX_BURSTS)。
 * 勝利時カスケードの仕上げ花火で 20 発を落とさずに上げるための最小拡張。
 */
export function burst(x, y, cardWidth = BASE_CARD_WIDTH, maxBursts = MAX_BURSTS) {
  if (prefersReducedMotion()) {
    return false;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  if (activeBursts.length >= maxBursts) {
    return false;
  }
  if (!ensureCanvas()) {
    return false;
  }
  const rawScale = Number.isFinite(cardWidth) && cardWidth > 0 ? cardWidth / BASE_CARD_WIDTH : 1;
  const scale = Math.min(1, rawScale);
  const color = pickBurstColor(debug.lastColor);
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const group = groupForIndex(i, PARTICLE_COUNT);
    const range = speedRangeForGroup(group);
    const speedFactor = range.min + Math.random() * (range.max - range.min);
    const speed = SPEED * scale * speedFactor;
    const angle = Math.random() * Math.PI * 2;
    const lifeFactor = 1 - LIFE_JITTER * Math.random();
    const life = (DURATION_MS / 1000) * lifeFactor;
    const trailInterval =
      TRAIL_INTERVAL_MS * (1 + (Math.random() * 2 - 1) * TRAIL_INTERVAL_JITTER);
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life,
      size: PARTICLE_SIZE * scale * (0.75 + Math.random() * 0.5),
      emberThreshold:
        EMBER_THRESHOLD_MIN + Math.random() * (EMBER_THRESHOLD_MAX - EMBER_THRESHOLD_MIN),
      emberStart: null,
      trailIntervalMs: trailInterval,
      nextTrailAt: trailInterval * (0.5 + Math.random() * 0.5),
    });
  }
  activeBursts.push({ color, particles, scale });
  debug.bursts++;
  debug.lastScale = scale;
  debug.lastColor = color;
  if (rafId === null) {
    lastFrameTime = performance.now();
    rafId = window.requestAnimationFrame(drawFrame);
  }
  return true;
}
