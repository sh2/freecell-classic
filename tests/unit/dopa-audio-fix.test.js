import { describe, expect, it, vi } from "vitest";
import { createDopaAudio, DOPA_AUDIO_RECIPES } from "../../src/js/dopa-audio.js";

/**
 * fix-01 FB-1: 爆発・重火器・魔法・ライトセーバー系の音が
 * WaveShaper / detune / ビブラート等を使って鳴ることを検証する。
 * 実音は鳴らさず、fake AudioContext の生成物だけを見る。
 */

function param(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function createFakeContext() {
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    oscillators: [],
    buffers: [],
    shapers: [],
    filters: [],
    createGain() {
      return { gain: param(1), connect: vi.fn(), disconnect: vi.fn() };
    },
    createDynamicsCompressor() {
      return { threshold: param(-18), ratio: param(4), connect: vi.fn(), disconnect: vi.fn() };
    },
    createBuffer(_channels, length) {
      return { getChannelData: () => new Float32Array(length) };
    },
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: param(440),
        detune: param(0),
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createBiquadFilter() {
      const filter = {
        type: "lowpass",
        frequency: param(800),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      ctx.filters.push(filter);
      return filter;
    },
    createBufferSource() {
      const src = {
        buffer: null,
        onended: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      return src;
    },
    createWaveShaper() {
      const shaper = { curve: null, oversample: null, connect: vi.fn(), disconnect: vi.fn() };
      ctx.shapers.push(shaper);
      return shaper;
    },
    resume() {
      return Promise.resolve();
    },
    suspend() {
      return Promise.resolve();
    },
  };
  return ctx;
}

function setup() {
  const ctx = createFakeContext();
  function FakeAudioContext() {
    return ctx;
  }
  const audio = createDopaAudio({ AudioContextCtor: FakeAudioContext, maxVoices: 48 });
  audio.setEnabled(true);
  return { ctx, audio };
}

describe("fix-01 FB-1: 攻撃的な音のレシピ", () => {
  it("explosion は歪み(WaveShaper)とサブベースを使う", () => {
    const { ctx, audio } = setup();
    expect(audio.play("explosion")).toBe(true);
    expect(ctx.shapers.length).toBeGreaterThan(0);
    expect(ctx.shapers[0].curve).not.toBeNull();
    expect(ctx.oscillators.some((o) => o.type === "sine")).toBe(true);
    const freqs = ctx.oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0][0]);
    expect(Math.min(...freqs)).toBeLessThanOrEqual(120);
  });

  it("heavy-gun は短い破裂音を連打する", () => {
    const { ctx, audio } = setup();
    expect(audio.play("heavy-gun")).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(12);
    expect(ctx.shapers.length).toBeGreaterThan(0);
  });

  it("magic は低域ドローンと帯域スイープを使う(高音アルペジオなし)", () => {
    const { ctx, audio } = setup();
    expect(audio.play("magic")).toBe(true);
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(3);
    expect(ctx.oscillators.some((o) => o.detune.setValueAtTime.mock.calls.length > 0)).toBe(true);
    expect(
      ctx.filters.some((f) => f.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)
    ).toBe(true);
    const freqs = ctx.oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0][0]);
    expect(Math.min(...freqs)).toBeLessThanOrEqual(60);
    for (const freq of freqs) {
      expect(freq).toBeLessThanOrEqual(200);
    }
  });

  it("saber は低い鋸波ハムとビブラート、スウィングノイズを使う", () => {
    const { ctx, audio } = setup();
    expect(audio.play("saber")).toBe(true);
    expect(ctx.oscillators.some((o) => o.type === "sawtooth")).toBe(true);
    // メインの鋸波 + ビブラート用 LFO
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(3);
    expect(
      ctx.filters.some((f) => f.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)
    ).toBe(true);
  });
});

describe("fix-03 FB-9: レシピ一覧と実装の一致", () => {
  it("export した全レシピが実際に再生できる", () => {
    for (const name of Object.keys(DOPA_AUDIO_RECIPES)) {
      const { audio } = setup();
      expect(audio.play(name), `${name} が再生できない`).toBe(true);
    }
  });
});

describe("fix-03 FB-9R: 基本操作音の実音が低域中心", () => {
  const basics = [
    "select",
    "drop-target",
    "move-cascade",
    "move-free",
    "move-home",
    "landing",
    "undo",
    "deal",
    "auto-start",
    "auto-end",
    "solver-move",
    "toggle-on",
    "toggle-off",
    "hint",
    "stuck",
    "fail-invalid",
    "fail-too-many",
  ];

  it("基本操作音に 300Hz を超えるオシレーター基音が無い", () => {
    for (const name of basics) {
      const { ctx, audio } = setup();
      expect(audio.play(name), name).toBe(true);
      for (const osc of ctx.oscillators) {
        const freq = osc.frequency.setValueAtTime.mock.calls[0][0];
        expect(freq, `${name} の基音 ${freq}Hz`).toBeLessThanOrEqual(300);
      }
    }
  });

  it("基本操作音はローパス/帯域ノイズ経路を持つ", () => {
    for (const name of basics) {
      const { ctx, audio } = setup();
      audio.play(name);
      const lowFilters = ctx.filters.filter((filter) => {
        const call = filter.frequency.setValueAtTime.mock.calls[0];
        return call && call[0] <= 1200;
      });
      expect(lowFilters.length, `${name} に低域フィルターが無い`).toBeGreaterThan(0);
    }
  });
});

describe("fix-04 FB-12: magic-boon", () => {
  it("55Hz 前後のサブベースと低域ノイズで唸る", () => {
    const { ctx, audio } = setup();
    expect(audio.play("magic-boon")).toBe(true);
    const freqs = ctx.oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0][0]);
    expect(Math.min(...freqs)).toBeLessThanOrEqual(80);
    expect(Math.max(...freqs)).toBeLessThanOrEqual(120);
    expect(ctx.shapers.length).toBeGreaterThan(0);
  });
});
