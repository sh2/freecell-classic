/* =========================================================
 * ドパモード サウンド (Web Audio API の合成のみ)
 * 音声ファイル・外部ライブラリは使わない。
 * AudioContext は最初のユーザー操作(unlock)まで生成しない。
 * 単体テストでは AudioContextCtor に fake を注入する。
 * ========================================================= */


/** 削除した軽いレシピ(チャイム / BEEP / 音階・アルペジオ系) */
export const DOPA_REMOVED_RECIPES = Object.freeze([
  "sparkle",
  "ssr",
  "slot",
  "bounce",
  "combo",
  "rank",
  "finale",
  "crown",
  "countdown",
  "curtain",
  "staffroll",
]);

/**
 * 現行レシピ一覧。low は低域成分の宣言、lowHz は基音の目安。
 * 軽いメロディ系は削除し、低音の効いたレシピへ寄せている。
 */
export const DOPA_AUDIO_RECIPES = Object.freeze({
  select: { low: true, lowHz: 120 },
  "drag-start": { low: true, lowHz: 140 },
  "drop-target": { low: true, lowHz: 110 },
  "move-cascade": { low: true, lowHz: 130 },
  "move-free": { low: true, lowHz: 150 },
  "move-home": { low: true, lowHz: 112 },
  landing: { low: true, lowHz: 92 },
  "fail-invalid": { low: true, lowHz: 150 },
  "fail-too-many": { low: true, lowHz: 150 },
  undo: { low: true, lowHz: 142 },
  deal: { low: true, lowHz: 92 },
  hint: { low: true, lowHz: 120 },
  "auto-start": { low: true, lowHz: 124 },
  "auto-end": { low: true, lowHz: 94 },
  "solver-move": { low: true, lowHz: 128 },
  stuck: { low: true, lowHz: 120 },
  win: { low: true, lowHz: 55 },
  "toggle-on": { low: true, lowHz: 104 },
  "toggle-off": { low: true, lowHz: 132 },
  crack: { low: true, lowHz: 120 },
  thump: { low: true, lowHz: 70 },
  whoosh: { low: true, lowHz: 90 },
  warp: { low: true, lowHz: 70 },
  rocket: { low: true, lowHz: 80 },
  explosion: { low: true, lowHz: 28 },
  "heavy-gun": { low: true, lowHz: 42 },
  machinegun: { low: true, lowHz: 48 },
  iaido: { low: true, lowHz: 60 },
  saber: { low: true, lowHz: 92 },
  meteor: { low: true, lowHz: 70 },
  lightning: { low: true, lowHz: 55 },
  beam: { low: true, lowHz: 60 },
  rush: { low: true, lowHz: 50 },
  drill: { low: true, lowHz: 70 },
  groundcrack: { low: true, lowHz: 40 },
  blackhole: { low: true, lowHz: 60 },
  slowmo: { low: true, lowHz: 90 },
  glitch: { low: true, lowHz: 70 },
  spotlight: { low: true, lowHz: 80 },
  magic: { low: true, lowHz: 55 },
  "magic-boon": { low: true, lowHz: 55 },
  cutin: { low: true, lowHz: 70 },
  voice: { low: true, lowHz: 110 },
  damage: { low: true, lowHz: 70 },
  don: { low: true, lowHz: 45 },
  crowd: { low: true, lowHz: 90 },
  firework: { low: true, lowHz: 50 },
  sakura: { low: true, lowHz: 90 },
  space: { low: true, lowHz: 70 },
  underwater: { low: true, lowHz: 80 },
  coin: { low: true, lowHz: 80 },
  glass: { low: true, lowHz: 60 },
  "fail-cross": { low: true, lowHz: 60 },
  "fail-sink": { low: true, lowHz: 90 },
  "stuck-gray": { low: true, lowHz: 80 },
  "stuck-skull": { low: true, lowHz: 55 },
  impact: { low: true, lowHz: 35 },
  "impact-soft": { low: true, lowHz: 50 },
  rumble: { low: true, lowHz: 45 },
});

/** マスターゲインの通常値(0.22 を超えない) */
const MASTER_GAIN = 0.22;

/** ブラウザーの AudioContext 実装を返す(無ければ null) */
function defaultAudioContextCtor() {
  if (typeof globalThis === "undefined") {
    return null;
  }
  return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
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

/** WaveShaper 用の歪みカーブ(ソフトクリップ) */
function makeDistortionCurve(amount = 200) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = Math.max(1, amount);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/** ドパモードのサウンドを生成する。AudioContextCtor はテスト用の差し替え */
export function createDopaAudio({ AudioContextCtor, now, mobile, maxVoices } = {}) {
  const Ctor = AudioContextCtor !== undefined ? AudioContextCtor : defaultAudioContextCtor();
  const clock = now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const mobileFlag = mobile ?? detectMobile();
  const voiceLimit = maxVoices ?? (mobileFlag ? 8 : 12);

  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let noiseBuffer = null;
  let enabled = false;
  let lifecycleHooked = false;

  const voices = new Set();
  const timers = new Set();
  const distortionCurves = new Map();

  /** 使える AudioContext 実装があるか */
  function isAvailable() {
    return typeof Ctor === "function";
  }

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

  /** masterGain を target へ sec 秒でランプする(初期 0 からの立ち上げ・OFF 用) */
  function rampMaster(target, sec) {
    if (!masterGain) {
      return;
    }
    const t = ctx.currentTime;
    const gain = masterGain.gain;
    if (typeof gain.cancelScheduledValues === "function") {
      gain.cancelScheduledValues(t);
    }
    if (typeof gain.setValueAtTime === "function") {
      gain.setValueAtTime(Math.max(0.0001, gain.value ?? 0.0001), t);
    }
    if (typeof gain.linearRampToValueAtTime === "function") {
      gain.linearRampToValueAtTime(target, t + sec);
    } else {
      gain.value = target;
    }
  }

  /** 1 秒のホワイトノイズバッファを 1 回だけ生成して再利用する */
  function makeNoiseBuffer(context) {
    if (typeof context.createBuffer !== "function") {
      return null;
    }
    const buffer = context.createBuffer(1, context.sampleRate || 44100, context.sampleRate || 44100);
    if (typeof buffer.getChannelData !== "function") {
      return buffer;
    }
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** AudioContext とマスター系ノードを遅延生成する */
  function ensureContext() {
    if (!isAvailable()) {
      return null;
    }
    if (ctx) {
      return ctx;
    }
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
      return null;
    }
    try {
      masterGain = ctx.createGain();
      compressor = ctx.createDynamicsCompressor();
      masterGain.gain.value = 0.0001;
      if (compressor.threshold) {
        compressor.threshold.value = -18;
      }
      if (compressor.ratio) {
        compressor.ratio.value = 4;
      }
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);
      noiseBuffer = makeNoiseBuffer(ctx);
    } catch {
      ctx = null;
      masterGain = null;
      compressor = null;
      return null;
    }
    hookLifecycle();
    return ctx;
  }

  /** ページ非表示・破棄時に音を残さない */
  function hookLifecycle() {
    if (lifecycleHooked || typeof document === "undefined") {
      return;
    }
    lifecycleHooked = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        stopAll({ fadeMs: 0 });
        suspend();
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => stopAll({ fadeMs: 0 }));
    }
  }

  function suspend() {
    if (!ctx || typeof ctx.suspend !== "function") {
      return;
    }
    try {
      const p = ctx.suspend();
      if (p && typeof p.catch === "function") {
        p.catch(() => {});
      }
    } catch {
      // 失敗しても視覚演出は継続する
    }
  }

  /** AudioContext を開始 / 再開する。自動再生制限の失敗は握りつぶす */
  function unlock() {
    const c = ensureContext();
    if (!c) {
      return false;
    }
    if (c.state === "suspended" && typeof c.resume === "function") {
      try {
        const p = c.resume();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch {
        // 失敗しても視覚演出は継続する
      }
    }
    if (enabled) {
      rampMaster(MASTER_GAIN, 0.03);
    }
    return true;
  }

  /** voice を停止して参照を切る */
  function stopVoice(voice) {
    if (!voices.has(voice)) {
      return;
    }
    disconnectVoice(voice, true);
  }

  function cleanupVoice(voice) {
    if (!voices.has(voice)) {
      return;
    }
    disconnectVoice(voice, false);
  }

  function disconnectVoice(voice, stop) {
    voices.delete(voice);
    if (voice.timer) {
      clearTimeout(voice.timer);
      timers.delete(voice.timer);
      voice.timer = null;
    }
    if (stop) {
      try {
        voice.source.stop();
      } catch {
        // すでに停止済みなら無視する
      }
    }
    try {
      voice.source.disconnect();
    } catch {
      // 未接続なら無視する
    }
    for (const node of [voice.filter, voice.gain, voice.shaper]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // 未接続なら無視する
        }
      }
    }
  }

  /** voice を登録し、終了時(onended / タイマー)に参照を切る */
  function registerVoice(source, gain, filter, priority, duration, shaper = null) {
    const voice = { source, gain, filter, shaper, priority, timer: null };
    voices.add(voice);
    source.onended = () => cleanupVoice(voice);
    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", () => cleanupVoice(voice));
    }
    voice.timer = schedule(() => cleanupVoice(voice), Math.ceil(duration * 1000) + 80);
    return voice;
  }

  /** 同時発音の上限を超える場合、優先度の低い voice から間引く */
  function makeRoom(priority) {
    if (voices.size < voiceLimit) {
      return true;
    }
    const candidates = [...voices].filter((v) => v.priority < priority).sort((a, b) => a.priority - b.priority);
    while (voices.size >= voiceLimit && candidates.length > 0) {
      stopVoice(candidates.shift());
    }
    return voices.size < voiceLimit;
  }

  function connectVoice(source, filter, gain, shaper = null) {
    if (filter) {
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }
    if (shaper) {
      gain.connect(shaper);
      shaper.connect(masterGain);
    } else {
      gain.connect(masterGain);
    }
  }

  /** 歪みノードを作る。AudioContext が非対応なら null */
  function createShaper(amount) {
    const c = ctx;
    if (!c || !amount || typeof c.createWaveShaper !== "function") {
      return null;
    }
    try {
      const shaper = c.createWaveShaper();
      const key = Math.round(amount);
      if (!distortionCurves.has(key)) {
        distortionCurves.set(key, makeDistortionCurve(key));
      }
      shaper.curve = distortionCurves.get(key);
      if ("oversample" in shaper) {
        shaper.oversample = "4x";
      }
      return shaper;
    } catch {
      return null;
    }
  }

  /** 低いハム音へビブラートを掛ける(ライトセーバー用) */
  function startVibrato(target, freq, depth, t, duration, priority) {
    const c = ctx;
    if (!c || !target || typeof c.createOscillator !== "function") {
      return null;
    }
    const lfo = c.createOscillator();
    lfo.type = "sine";
    if (lfo.frequency) {
      lfo.frequency.setValueAtTime(freq, t);
    }
    const gain = c.createGain();
    if (gain.gain) {
      gain.gain.setValueAtTime(depth, t);
    }
    lfo.connect(gain);
    gain.connect(target);
    lfo.start(t);
    lfo.stop(t + duration + 0.02);
    return registerVoice(lfo, gain, null, priority, duration);
  }

  /** ADSR の A/D だけを持つ短いエンベロープ */
  function applyEnvelope(param, t, peak, attack, duration) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + duration);
  }

  function startTone({
    freq,
    endFreq = null,
    type = "sine",
    start = null,
    duration = 0.1,
    peak = 0.05,
    attack = 0.005,
    filterType = null,
    filterFreq = null,
    filterEndFreq = null,
    detune = 0,
    distortion = 0,
    vibratoHz = 0,
    vibratoDepth = 0,
    priority = 2,
  }) {
    const c = ctx;
    if (!c) {
      return null;
    }
    const t = start ?? c.currentTime;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune && osc.detune) {
      osc.detune.setValueAtTime(detune, t);
    }
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + duration);
    }
    const gain = c.createGain();
    applyEnvelope(gain.gain, t, peak, attack, duration);
    let filter = null;
    if (filterType && typeof c.createBiquadFilter === "function") {
      filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq ?? 800, t);
      if (filterEndFreq !== null) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterEndFreq), t + duration);
      }
    }
    const shaper = createShaper(distortion);
    connectVoice(osc, filter, gain, shaper);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    const voice = registerVoice(osc, gain, filter, priority, duration, shaper);
    if (vibratoHz > 0 && vibratoDepth > 0) {
      startVibrato(osc.frequency, vibratoHz, vibratoDepth, t, duration, priority);
    }
    return voice;
  }

  function startNoise({
    start = null,
    duration = 0.1,
    peak = 0.05,
    attack = 0.003,
    filterType = "bandpass",
    filterFreq = 800,
    filterEndFreq = null,
    distortion = 0,
    priority = 1,
  }) {
    const c = ctx;
    if (!c || !noiseBuffer) {
      return null;
    }
    const t = start ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const gain = c.createGain();
    applyEnvelope(gain.gain, t, peak, attack, duration);
    let filter = null;
    if (typeof c.createBiquadFilter === "function") {
      filter = c.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, t);
      if (filterEndFreq !== null) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(1, filterEndFreq), t + duration);
      }
    }
    const shaper = createShaper(distortion);
    connectVoice(src, filter, gain, shaper);
    src.start(t);
    src.stop(t + duration + 0.02);
    return registerVoice(src, gain, filter, priority, duration, shaper);
  }

  /** 失敗音(低域の矩形波) */
  function playFail(t) {
    startTone({
      freq: 150,
      endFreq: 88,
      type: "square",
      start: t,
      duration: 0.14,
      peak: 0.04,
      filterType: "lowpass",
      filterFreq: 600,
      priority: 3,
    });
  }

  /** B 群・E 群の音量と低域を底上げするレシピ */
  const BOOSTED_RECIPES = new Set([
    "explosion",
    "heavy-gun",
    "machinegun",
    "iaido",
    "saber",
    "meteor",
    "lightning",
    "beam",
    "rush",
    "drill",
    "groundcrack",
    "blackhole",
    "magic",
    "firework",
    "sakura",
    "space",
    "underwater",
    "coin",
  ]);

  /** 音色レシピを再生する。OFF・AudioContext 不在・上限超過では鳴らさない */
  function play(recipe, opts = {}) {
    if (!enabled) {
      return false;
    }
    const c = ensureContext();
    if (!c) {
      return false;
    }
    if (c.state === "suspended" && typeof c.resume === "function") {
      try {
        const p = c.resume();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch {
        // 失敗しても視覚演出は継続する
      }
    }
    const t = c.currentTime;
    const scale = typeof opts.volumeScale === "number" ? opts.volumeScale : 1;
    const boost = BOOSTED_RECIPES.has(recipe) ? 1.35 : 1;
    const scaled = (peak) => peak * scale * boost;

    const playVoice = (priority, fn) => {
      if (!makeRoom(priority)) {
        return false;
      }
      fn();
      return true;
    };

    switch (recipe) {
      case "select":
        return playVoice(2, () => {
          startNoise({ start: t, duration: 0.05, peak: scaled(0.045), filterType: "lowpass", filterFreq: 1100, priority: 2 });
          startTone({ freq: 120, endFreq: 68, type: "sine", start: t, duration: 0.075, peak: scaled(0.075), priority: 2 });
        });
      case "drag-start":
        return playVoice(1, () =>
          startNoise({
            start: t,
            duration: 0.14,
            peak: scaled(0.055),
            filterType: "bandpass",
            filterFreq: 300,
            filterEndFreq: 900,
            priority: 1,
          })
        );
      case "drop-target":
        return playVoice(1, () => {
          startNoise({ start: t, duration: 0.035, peak: scaled(0.035), filterType: "lowpass", filterFreq: 700, priority: 1 });
          startTone({ freq: 110, endFreq: 78, type: "sine", start: t, duration: 0.04, peak: scaled(0.05), priority: 1 });
        });
      case "move-cascade":
        return playVoice(2, () => {
          startTone({ freq: 130, endFreq: 68, type: "sine", start: t, duration: 0.12, peak: scaled(0.08), priority: 2 });
          startNoise({ start: t, duration: 0.08, peak: scaled(0.04), filterType: "lowpass", filterFreq: 520, priority: 2 });
        });
      case "move-free":
        return playVoice(2, () => {
          startTone({ freq: 150, endFreq: 78, type: "sine", start: t, duration: 0.1, peak: scaled(0.075), priority: 2 });
          startNoise({ start: t, duration: 0.06, peak: scaled(0.035), filterType: "lowpass", filterFreq: 900, priority: 2 });
        });
      case "move-home":
        return playVoice(2, () => {
          startTone({ freq: 112, endFreq: 54, type: "sine", start: t, duration: 0.24, peak: scaled(0.1), priority: 2 });
          startTone({ freq: 84, endFreq: 62, type: "triangle", start: t, duration: 0.2, peak: scaled(0.05), priority: 2 });
          startNoise({ start: t, duration: 0.12, peak: scaled(0.045), filterType: "lowpass", filterFreq: 620, priority: 2 });
        });
      case "landing":
        return playVoice(1, () => {
          startTone({ freq: 92, endFreq: 48, type: "sine", start: t, duration: 0.09, peak: scaled(0.07), priority: 1 });
          startNoise({ start: t, duration: 0.05, peak: scaled(0.03), filterType: "lowpass", filterFreq: 760, priority: 1 });
        });
      case "fail-invalid":
        return playVoice(3, () => playFail(t));
      case "fail-too-many":
        return playVoice(3, () => {
          playFail(t);
          playFail(t + 0.09);
        });
      case "undo":
        return playVoice(2, () => {
          startTone({ freq: 142, endFreq: 96, type: "sine", start: t, duration: 0.1, peak: scaled(0.06), priority: 2 });
          startTone({ freq: 100, endFreq: 68, type: "sine", start: t + 0.08, duration: 0.1, peak: scaled(0.05), priority: 2 });
          startNoise({ start: t, duration: 0.12, peak: scaled(0.035), filterType: "lowpass", filterFreq: 540, priority: 2 });
        });
      case "deal":
        return playVoice(2, () => {
          for (let i = 0; i < 3; i++) {
            startNoise({
              start: t + i * 0.06,
              duration: 0.06,
              peak: scaled(0.045),
              filterType: "lowpass",
              filterFreq: 820,
              priority: 2,
            });
          }
          startTone({ freq: 92, endFreq: 58, type: "sine", start: t, duration: 0.3, peak: scaled(0.08), priority: 2 });
        });
      case "hint":
        return playVoice(1, () => {
          startTone({ freq: 120, endFreq: 80, type: "sine", start: t, duration: 0.25, peak: scaled(0.05), priority: 1 });
          startNoise({ start: t, duration: 0.2, peak: scaled(0.025), filterType: "lowpass", filterFreq: 500, priority: 1 });
        });
      case "auto-start":
        return playVoice(1, () => {
          startTone({ freq: 124, endFreq: 78, type: "sine", start: t, duration: 0.2, peak: scaled(0.06), priority: 1 });
          startNoise({ start: t, duration: 0.16, peak: scaled(0.035), filterType: "lowpass", filterFreq: 620, priority: 1 });
        });
      case "auto-end":
        return playVoice(1, () => {
          startTone({ freq: 94, endFreq: 58, type: "sine", start: t, duration: 0.24, peak: scaled(0.06), priority: 1 });
          startNoise({ start: t, duration: 0.18, peak: scaled(0.03), filterType: "lowpass", filterFreq: 520, priority: 1 });
        });
      case "solver-move":
        return playVoice(1, () => {
          startTone({ freq: 128, endFreq: 78, type: "sine", start: t, duration: 0.1, peak: scaled(0.05), filterType: "lowpass", filterFreq: 620, priority: 1 });
          startNoise({ start: t, duration: 0.05, peak: scaled(0.025), filterType: "lowpass", filterFreq: 480, priority: 1 });
        });
      case "stuck":
        return playVoice(3, () => {
          startTone({ freq: 120, type: "sine", start: t, duration: 0.4, peak: scaled(0.055), attack: 0.01, priority: 3 });
          startTone({ freq: 108, type: "sine", start: t, duration: 0.4, peak: scaled(0.045), attack: 0.01, priority: 3 });
          startNoise({ start: t, duration: 0.3, peak: scaled(0.03), filterType: "lowpass", filterFreq: 380, priority: 3 });
        });
      case "win":
        return playVoice(3, () => {
          startNoise({ start: t, duration: 0.5, peak: scaled(0.12), filterType: "lowpass", filterFreq: 2400, filterEndFreq: 120, distortion: 300, priority: 3 });
          startNoise({ start: t + 0.25, duration: 0.45, peak: scaled(0.07), filterType: "lowpass", filterFreq: 1800, filterEndFreq: 100, priority: 3 });
          startTone({ freq: 65, endFreq: 30, type: "sine", start: t, duration: 1.2, peak: scaled(0.18), attack: 0.01, distortion: 200, priority: 3 });
          startTone({ freq: 98, endFreq: 42, type: "sawtooth", start: t, duration: 0.7, peak: scaled(0.08), distortion: 240, priority: 3 });
        });
      case "toggle-on":
        return playVoice(2, () => {
          startTone({ freq: 104, endFreq: 62, type: "sine", start: t, duration: 0.1, peak: scaled(0.075), priority: 2 });
          startNoise({ start: t, duration: 0.06, peak: scaled(0.04), filterType: "lowpass", filterFreq: 760, priority: 2 });
        });
      case "toggle-off":
        return playVoice(1, () => {
          startTone({ freq: 132, endFreq: 66, type: "sine", start: t, duration: 0.12, peak: scaled(0.065), priority: 1 });
          startNoise({ start: t, duration: 0.06, peak: scaled(0.03), filterType: "lowpass", filterFreq: 600, priority: 1 });
        });
      case "crack":
        return playVoice(2, () => {
          startNoise({ start: t, duration: 0.12, peak: scaled(0.06), filterType: "highpass", filterFreq: 1400, priority: 2 });
          startTone({ freq: 320, endFreq: 120, type: "square", start: t, duration: 0.12, peak: scaled(0.04), priority: 2 });
        });
      case "thump":
        return playVoice(2, () =>
          startTone({ freq: 120, endFreq: 70, type: "sine", start: t, duration: 0.18, peak: scaled(0.08), priority: 2 })
        );
      case "whoosh":
        return playVoice(1, () =>
          startNoise({
            start: t,
            duration: 0.22,
            peak: scaled(0.05),
            filterType: "bandpass",
            filterFreq: 500,
            filterEndFreq: 2400,
            priority: 1,
          })
        );
      case "warp":
        return playVoice(2, () => {
          startTone({ freq: 1200, endFreq: 180, type: "sine", start: t, duration: 0.32, peak: scaled(0.05), priority: 2 });
          startTone({ freq: 300, endFreq: 900, type: "triangle", start: t + 0.16, duration: 0.24, peak: scaled(0.04), priority: 2 });
        });
      case "rocket":
        return playVoice(2, () => {
          startNoise({
            start: t,
            duration: 0.4,
            peak: scaled(0.06),
            filterType: "highpass",
            filterFreq: 900,
            priority: 2,
          });
          startTone({ freq: 220, endFreq: 880, type: "sawtooth", start: t, duration: 0.4, peak: scaled(0.04), priority: 2 });
        });
      case "explosion":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.75,
            peak: scaled(0.15),
            filterType: "lowpass",
            filterFreq: 2600,
            filterEndFreq: 110,
            distortion: 380,
            priority: 3,
          });
          startTone({
            freq: 110,
            endFreq: 28,
            type: "sine",
            start: t,
            duration: 0.85,
            peak: scaled(0.18),
            attack: 0.004,
            distortion: 260,
            priority: 3,
          });
          startTone({
            freq: 240,
            endFreq: 48,
            type: "sawtooth",
            start: t,
            duration: 0.38,
            peak: scaled(0.08),
            distortion: 320,
            priority: 3,
          });
          startNoise({
            start: t,
            duration: 0.16,
            peak: scaled(0.07),
            filterType: "highpass",
            filterFreq: 2200,
            priority: 3,
          });
        });
      case "heavy-gun":
        return playVoice(3, () => {
          for (let i = 0; i < 12; i++) {
            const at = t + i * 0.052;
            startNoise({
              start: at,
              duration: 0.035,
              peak: scaled(0.09),
              filterType: "highpass",
              filterFreq: 900 + (i % 3) * 300,
              distortion: 260,
              priority: 3,
            });
            startTone({
              freq: 150 - i * 4,
              endFreq: 48,
              type: "square",
              start: at,
              duration: 0.06,
              peak: scaled(0.075),
              distortion: 300,
              priority: 3,
            });
            if (i % 3 === 0) {
              startTone({
                freq: 82,
                endFreq: 42,
                type: "sine",
                start: at,
                duration: 0.16,
                peak: scaled(0.09),
                priority: 3,
              });
            }
          }
        });
      case "machinegun":
        return playVoice(3, () => {
          for (let i = 0; i < 10; i++) {
            startNoise({
              start: t + i * 0.06,
              duration: 0.035,
              peak: scaled(0.06),
              filterType: "highpass",
              filterFreq: 1200,
              distortion: 180,
              priority: 3,
            });
            startTone({
              freq: 220 - i * 6,
              type: "square",
              start: t + i * 0.06,
              duration: 0.04,
              peak: scaled(0.05),
              distortion: 200,
              priority: 3,
            });
          }
        });
      case "saber":
        return playVoice(3, () => {
          startTone({
            freq: 92,
            endFreq: 96,
            type: "sawtooth",
            start: t,
            duration: 0.55,
            peak: scaled(0.11),
            attack: 0.01,
            distortion: 220,
            vibratoHz: 5.5,
            vibratoDepth: 11,
            priority: 3,
          });
          startTone({
            freq: 118,
            type: "sawtooth",
            start: t,
            duration: 0.55,
            peak: scaled(0.06),
            detune: 16,
            distortion: 180,
            priority: 3,
          });
          startNoise({
            start: t,
            duration: 0.38,
            peak: scaled(0.09),
            filterType: "bandpass",
            filterFreq: 320,
            filterEndFreq: 3200,
            priority: 3,
          });
          startTone({
            freq: 1800,
            endFreq: 380,
            type: "triangle",
            start: t + 0.08,
            duration: 0.32,
            peak: scaled(0.035),
            priority: 3,
          });
        });
      case "iaido":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.22,
            peak: scaled(0.1),
            filterType: "bandpass",
            filterFreq: 500,
            filterEndFreq: 5600,
            distortion: 160,
            priority: 3,
          });
          startTone({
            freq: 96,
            type: "sawtooth",
            start: t,
            duration: 0.42,
            peak: scaled(0.08),
            distortion: 200,
            vibratoHz: 6,
            vibratoDepth: 10,
            priority: 3,
          });
          startTone({ freq: 2400, endFreq: 900, type: "triangle", start: t + 0.16, duration: 0.2, peak: scaled(0.05), priority: 3 });
        });
      case "meteor":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.55,
            peak: scaled(0.09),
            filterType: "lowpass",
            filterFreq: 3200,
            filterEndFreq: 240,
            priority: 3,
          });
          startTone({ freq: 640, endFreq: 70, type: "sawtooth", start: t, duration: 0.55, peak: scaled(0.06), priority: 3 });
        });
      case "lightning":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.3,
            peak: scaled(0.1),
            filterType: "highpass",
            filterFreq: 2200,
            priority: 3,
          });
          startTone({ freq: 1500, endFreq: 200, type: "square", start: t, duration: 0.16, peak: scaled(0.05), priority: 3 });
        });
      case "beam":
        return playVoice(3, () => {
          startTone({ freq: 180, endFreq: 1400, type: "sawtooth", start: t, duration: 0.45, peak: scaled(0.07), priority: 3 });
          startTone({ freq: 360, endFreq: 2800, type: "square", start: t, duration: 0.4, peak: scaled(0.03), priority: 3 });
          startNoise({ start: t, duration: 0.4, peak: scaled(0.04), filterType: "bandpass", filterFreq: 1800, priority: 3 });
        });
      case "rush":
        return playVoice(3, () => {
          for (let i = 0; i < 7; i++) {
            startNoise({
              start: t + i * 0.07,
              duration: 0.05,
              peak: scaled(0.055),
              filterType: "bandpass",
              filterFreq: 600 + i * 180,
              priority: 3,
            });
          }
          startTone({ freq: 140, endFreq: 90, type: "sine", start: t, duration: 0.5, peak: scaled(0.06), priority: 3 });
        });
      case "drill":
        return playVoice(2, () => {
          for (let i = 0; i < 12; i++) {
            startTone({
              freq: 420 + (i % 3) * 70,
              type: "triangle",
              start: t + i * 0.055,
              duration: 0.05,
              peak: scaled(0.035),
              priority: 2,
            });
          }
        });
      case "groundcrack":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.6,
            peak: scaled(0.1),
            filterType: "lowpass",
            filterFreq: 700,
            filterEndFreq: 120,
            priority: 3,
          });
          startTone({ freq: 70, endFreq: 40, type: "sine", start: t, duration: 0.6, peak: scaled(0.1), priority: 3 });
        });
      case "blackhole":
        return playVoice(3, () => {
          startTone({ freq: 90, endFreq: 620, type: "sine", start: t, duration: 0.75, peak: scaled(0.05), priority: 3 });
          startTone({ freq: 620, endFreq: 60, type: "triangle", start: t + 0.72, duration: 0.5, peak: scaled(0.06), priority: 3 });
          startNoise({
            start: t + 0.6,
            duration: 0.5,
            peak: scaled(0.06),
            filterType: "bandpass",
            filterFreq: 300,
            filterEndFreq: 2400,
            priority: 3,
          });
        });
      case "impact":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.32,
            peak: scaled(0.12),
            filterType: "lowpass",
            filterFreq: 1500,
            filterEndFreq: 100,
            distortion: 300,
            priority: 3,
          });
          startTone({ freq: 55, endFreq: 28, type: "sine", start: t, duration: 0.5, peak: scaled(0.16), distortion: 220, priority: 3 });
          startTone({ freq: 120, endFreq: 38, type: "sawtooth", start: t, duration: 0.25, peak: scaled(0.07), distortion: 260, priority: 3 });
        });
      case "impact-soft":
        return playVoice(2, () => {
          startNoise({ start: t, duration: 0.18, peak: scaled(0.06), filterType: "lowpass", filterFreq: 700, priority: 2 });
          startTone({ freq: 80, endFreq: 38, type: "sine", start: t, duration: 0.28, peak: scaled(0.1), priority: 2 });
        });
      case "rumble":
        return playVoice(3, () => {
          startTone({ freq: 45, endFreq: 38, type: "sine", start: t, duration: 0.9, peak: scaled(0.13), attack: 0.02, priority: 3 });
          startTone({ freq: 72, endFreq: 60, type: "triangle", start: t, duration: 0.8, peak: scaled(0.06), attack: 0.03, priority: 3 });
          startNoise({ start: t, duration: 0.8, peak: scaled(0.05), filterType: "lowpass", filterFreq: 220, priority: 3 });
        });
      /* ---------------- 増強版 C/D 群 ---------------- */
      case "slowmo":
        return playVoice(1, () => {
          startTone({ freq: 440, endFreq: 110, type: "sine", start: t, duration: 0.7, peak: scaled(0.04), priority: 1 });
          startNoise({ start: t, duration: 0.5, peak: scaled(0.025), filterType: "lowpass", filterFreq: 400, priority: 1 });
        });
      case "glitch":
        return playVoice(2, () => {
          for (let i = 0; i < 6; i++) {
            startNoise({
              start: t + i * 0.045,
              duration: 0.04,
              peak: scaled(0.04),
              filterType: "bandpass",
              filterFreq: 180 + i * 120,
              priority: 2,
            });
          }
          startTone({ freq: 60, endFreq: 40, type: "square", start: t, duration: 0.24, peak: scaled(0.06), filterType: "lowpass", filterFreq: 260, priority: 2 });
        });
      case "spotlight":
        return playVoice(1, () => {
          startNoise({ start: t, duration: 0.6, peak: scaled(0.04), filterType: "bandpass", filterFreq: 500, filterEndFreq: 1400, priority: 1 });
          startTone({ freq: 70, type: "sine", start: t, duration: 0.8, peak: scaled(0.06), attack: 0.04, priority: 1 });
        });
      case "magic":
        return playVoice(3, () => {
          startNoise({
            start: t,
            duration: 0.55,
            peak: scaled(0.07),
            filterType: "bandpass",
            filterFreq: 260,
            filterEndFreq: 1800,
            priority: 3,
          });
          startTone({
            freq: 55,
            endFreq: 48,
            type: "sawtooth",
            start: t,
            duration: 0.8,
            peak: scaled(0.12),
            attack: 0.02,
            distortion: 180,
            vibratoHz: 4.5,
            vibratoDepth: 3,
            priority: 3,
          });
          startTone({
            freq: 82,
            endFreq: 72,
            type: "triangle",
            start: t + 0.05,
            duration: 0.7,
            peak: scaled(0.07),
            detune: -12,
            distortion: 120,
            priority: 3,
          });
          startTone({ freq: 120, endFreq: 60, type: "sine", start: t, duration: 0.45, peak: scaled(0.08), priority: 3 });
        });
      case "magic-boon":
        return playVoice(3, () => {
          startTone({
            freq: 55,
            endFreq: 48,
            type: "sine",
            start: t,
            duration: 1.6,
            peak: scaled(0.2),
            attack: 0.8,
            distortion: 180,
            vibratoHz: 3.2,
            vibratoDepth: 2.5,
            priority: 3,
          });
          startTone({
            freq: 82,
            endFreq: 74,
            type: "sawtooth",
            start: t + 0.05,
            duration: 1.45,
            peak: scaled(0.09),
            attack: 0.8,
            filterType: "lowpass",
            filterFreq: 260,
            detune: -16,
            distortion: 140,
            priority: 3,
          });
          startNoise({
            start: t,
            duration: 1.5,
            peak: scaled(0.06),
            attack: 0.7,
            filterType: "lowpass",
            filterFreq: 240,
            filterEndFreq: 120,
            priority: 3,
          });
        });
      case "cutin":
        return playVoice(3, () => {
          startNoise({ start: t, duration: 0.24, peak: scaled(0.09), filterType: "lowpass", filterFreq: 1000, filterEndFreq: 150, distortion: 260, priority: 3 });
          startTone({ freq: 48, endFreq: 30, type: "sine", start: t, duration: 0.5, peak: scaled(0.14), distortion: 200, priority: 3 });
          startTone({ freq: 96, endFreq: 44, type: "sawtooth", start: t, duration: 0.28, peak: scaled(0.06), distortion: 300, priority: 3 });
        });
      case "voice":
        return playVoice(1, () => {
          startNoise({
            start: t,
            duration: 0.5,
            peak: scaled(0.05),
            filterType: "bandpass",
            filterFreq: 240,
            filterEndFreq: 700,
            priority: 1,
          });
          startTone({ freq: 110, endFreq: 90, type: "sawtooth", start: t, duration: 0.35, peak: scaled(0.035), filterType: "lowpass", filterFreq: 350, priority: 1 });
        });
      case "damage":
        return playVoice(3, () => {
          startTone({ freq: 220, endFreq: 70, type: "square", start: t, duration: 0.18, peak: scaled(0.06), priority: 3 });
          startNoise({ start: t, duration: 0.12, peak: scaled(0.05), filterType: "lowpass", filterFreq: 900, priority: 3 });
        });
      case "don":
        return playVoice(3, () => {
          startTone({ freq: 110, endFreq: 45, type: "sine", start: t, duration: 0.24, peak: scaled(0.1), priority: 3 });
          startNoise({ start: t, duration: 0.1, peak: scaled(0.06), filterType: "lowpass", filterFreq: 700, priority: 3 });
        });
      case "crowd":
        return playVoice(2, () => {
          startNoise({
            start: t,
            duration: 0.9,
            peak: scaled(0.09),
            filterType: "bandpass",
            filterFreq: 500,
            filterEndFreq: 1200,
            priority: 2,
          });
          startTone({ freq: 82, endFreq: 60, type: "sine", start: t, duration: 0.8, peak: scaled(0.07), attack: 0.03, priority: 2 });
        });
      case "firework":
        return playVoice(2, () => {
          startNoise({ start: t, duration: 0.4, peak: scaled(0.08), filterType: "highpass", filterFreq: 1400, priority: 2 });
          startTone({ freq: 120, endFreq: 50, type: "sine", start: t, duration: 0.35, peak: scaled(0.08), priority: 2 });
          startNoise({ start: t + 0.2, duration: 0.35, peak: scaled(0.05), filterType: "bandpass", filterFreq: 2400, priority: 2 });
        });
      case "sakura":
        return playVoice(1, () => {
          startNoise({ start: t, duration: 1.1, peak: scaled(0.045), filterType: "bandpass", filterFreq: 500, filterEndFreq: 1200, priority: 1 });
          startTone({ freq: 65, type: "sine", start: t, duration: 1.0, peak: scaled(0.06), attack: 0.08, priority: 1 });
        });
      case "space":
        return playVoice(1, () => {
          startTone({ freq: 70, type: "sine", start: t, duration: 1.2, peak: scaled(0.06), attack: 0.08, priority: 1 });
          startTone({ freq: 104, type: "triangle", start: t + 0.1, duration: 1.1, peak: scaled(0.03), attack: 0.1, priority: 1 });
        });
      case "underwater":
        return playVoice(1, () => {
          startNoise({ start: t, duration: 0.9, peak: scaled(0.05), filterType: "lowpass", filterFreq: 420, priority: 1 });
          startTone({ freq: 72, endFreq: 55, type: "sine", start: t, duration: 0.85, peak: scaled(0.07), attack: 0.03, priority: 1 });
          startTone({ freq: 108, endFreq: 82, type: "triangle", start: t + 0.18, duration: 0.5, peak: scaled(0.035), priority: 1 });
        });
      case "coin":
        return playVoice(2, () => {
          for (let i = 0; i < 7; i++) {
            startNoise({ start: t + i * 0.07, duration: 0.04, peak: scaled(0.03), filterType: "highpass", filterFreq: 2200, priority: 2 });
            startTone({ freq: 90 - i * 3, type: "sine", start: t + i * 0.07, duration: 0.08, peak: scaled(0.045), priority: 2 });
          }
        });
      case "glass":
        return playVoice(3, () => {
          startNoise({ start: t, duration: 0.55, peak: scaled(0.11), filterType: "highpass", filterFreq: 2800, priority: 3 });
          for (let i = 0; i < 6; i++) {
            startTone({
              freq: 2200 + Math.random() * 2600,
              type: "sine",
              start: t + i * 0.05,
              duration: 0.18,
              peak: scaled(0.03),
              priority: 3,
            });
          }
        });
      case "fail-cross":
        return playVoice(3, () => {
          startTone({ freq: 160, endFreq: 80, type: "square", start: t, duration: 0.22, peak: scaled(0.06), priority: 3 });
          startTone({ freq: 120, endFreq: 60, type: "sawtooth", start: t, duration: 0.22, peak: scaled(0.04), priority: 3 });
        });
      case "fail-sink":
        return playVoice(3, () => {
          startTone({ freq: 1400, endFreq: 180, type: "sine", start: t, duration: 0.75, peak: scaled(0.055), priority: 3 });
        });
      case "stuck-gray":
        return playVoice(3, () => {
          for (let i = 0; i < 4; i++) {
            startTone({ freq: 1200, type: "square", start: t + i * 0.18, duration: 0.03, peak: scaled(0.03), priority: 3 });
          }
          startTone({ freq: 220, type: "sine", start: t + 0.72, duration: 0.5, peak: scaled(0.04), attack: 0.01, priority: 3 });
          startTone({ freq: 207.65, type: "sine", start: t + 0.72, duration: 0.5, peak: scaled(0.035), attack: 0.01, priority: 3 });
        });
      case "stuck-skull":
        return playVoice(3, () => {
          startTone({ freq: 110, endFreq: 55, type: "sawtooth", start: t, duration: 1.0, peak: scaled(0.06), priority: 3 });
          startTone({ freq: 84, type: "sine", start: t + 0.1, duration: 0.9, peak: scaled(0.05), attack: 0.05, priority: 3 });
        });
      default:
        return false;
    }
  }

  function stopAll({ fadeMs = 0 } = {}) {
    const delay = fadeMs > 0 ? fadeMs : 0;
    for (const voice of [...voices]) {
      if (delay > 0) {
        schedule(() => stopVoice(voice), delay);
      } else {
        stopVoice(voice);
      }
    }
  }

  function setEnabled(on) {
    const next = !!on;
    if (next === enabled) {
      return;
    }
    enabled = next;
    clearTimers();
    if (!next) {
      if (masterGain) {
        rampMaster(0.0001, 0.05);
        schedule(() => stopAll({ fadeMs: 0 }), 60);
        schedule(() => suspend(), 120);
      }
      return;
    }
    const c = ensureContext();
    if (!c) {
      return;
    }
    unlock();
    rampMaster(MASTER_GAIN, 0.03);
  }

  function getDebugState() {
    return {
      enabled,
      available: isAvailable(),
      contextState: ctx ? ctx.state : "none",
      activeVoices: voices.size,
      mobile: mobileFlag,
      voiceLimit,
      clock: clock(),
    };
  }

  return {
    isAvailable,
    unlock,
    play,
    setEnabled,
    stopAll,
    getDebugState,
  };
}
