import { describe, expect, it, vi } from "vitest";
import { createDopaAudio } from "../../src/js/dopa-audio.js";

/**
 * ドパモード サウンドの単体テスト。
 * AudioContext は fake を注入し、生成タイミング・resume・有効化の
 * ライフサイクルだけを検証する(実音は鳴らさない)。
 */

function createFakeParam(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function createFakeContext(initialState = "running") {
  const ctx = {
    state: initialState,
    currentTime: 0,
    sampleRate: 44100,
    destination: { id: "destination" },
    resumeCalls: 0,
    suspendCalls: 0,
    createdGains: [],
    createdCompressors: [],
    oscillators: [],
    bufferSources: [],
    filters: [],
    createGain() {
      const gain = { gain: createFakeParam(1), connect: vi.fn(), disconnect: vi.fn() };
      ctx.createdGains.push(gain);
      return gain;
    },
    createDynamicsCompressor() {
      const compressor = {
        threshold: createFakeParam(-24),
        ratio: createFakeParam(12),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      ctx.createdCompressors.push(compressor);
      return compressor;
    },
    createBuffer() {
      return { getChannelData: () => new Float32Array(16) };
    },
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: createFakeParam(440),
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
        frequency: createFakeParam(800),
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
      ctx.bufferSources.push(src);
      return src;
    },
    resume() {
      ctx.resumeCalls += 1;
      ctx.state = "running";
      return Promise.resolve();
    },
    suspend() {
      ctx.suspendCalls += 1;
      ctx.state = "suspended";
      return Promise.resolve();
    },
  };
  return ctx;
}

function setup({ initialState = "running", resumeRejects = false } = {}) {
  const ctx = createFakeContext(initialState);
  if (resumeRejects) {
    ctx.resume = () => {
      ctx.resumeCalls += 1;
      return Promise.reject(new Error("blocked"));
    };
  }
  const calls = { constructed: 0 };
  function FakeAudioContext() {
    calls.constructed += 1;
    return ctx;
  }
  const audio = createDopaAudio({ AudioContextCtor: FakeAudioContext, maxVoices: 4 });
  return { ctx, calls, audio };
}

describe("createDopaAudio: ライフサイクル", () => {
  it("AudioContext が無い環境では no-op になる", () => {
    const audio = createDopaAudio({ AudioContextCtor: null });
    expect(audio.isAvailable()).toBe(false);
    expect(audio.unlock()).toBe(false);
    expect(audio.play("select")).toBe(false);
    expect(audio.getDebugState().activeVoices).toBe(0);
  });

  it("unlock() まで context を生成しない", () => {
    const { calls, audio } = setup();
    expect(calls.constructed).toBe(0);
    audio.unlock();
    expect(calls.constructed).toBe(1);
    audio.unlock();
    expect(calls.constructed).toBe(1);
  });

  it("suspended のとき resume() を呼ぶ", () => {
    const { ctx, audio } = setup({ initialState: "suspended" });
    audio.unlock();
    expect(ctx.resumeCalls).toBe(1);
  });

  it("resume() が reject しても throw しない", () => {
    const { audio } = setup({ initialState: "suspended", resumeRejects: true });
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.play("select")).not.toThrow();
  });

  it("setEnabled(false) で masterGain が 0 へランプし、context を suspend する", () => {
    vi.useFakeTimers();
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    const master = ctx.createdGains[0];
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalled();
    audio.setEnabled(false);
    expect(master.gain.linearRampToValueAtTime.mock.calls.at(-1)[0]).toBeCloseTo(0.0001, 4);
    vi.advanceTimersByTime(200);
    expect(ctx.state).toBe("suspended");
    vi.useRealTimers();
  });

  it("OFF 中の play() は AudioContext を再生成しない", () => {
    const { calls, audio } = setup();
    audio.setEnabled(true);
    audio.setEnabled(false);
    const before = calls.constructed;
    expect(audio.play("select")).toBe(false);
    expect(calls.constructed).toBe(before);
  });

  it("デバッグ状態を返す", () => {
    const { audio } = setup();
    audio.setEnabled(true);
    const state = audio.getDebugState();
    expect(state.enabled).toBe(true);
    expect(state.available).toBe(true);
    expect(state.activeVoices).toBe(0);
    expect(state.voiceLimit).toBe(4);
  });
});

describe("createDopaAudio: 音のレシピ", () => {
  it("select は低域の打撃音とローパスノイズで鳴る", () => {
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    expect(audio.play("select")).toBe(true);
    expect(ctx.oscillators).toHaveLength(1);
    const freq = ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0];
    expect(freq).toBeLessThanOrEqual(300);
    for (const osc of ctx.oscillators) {
      expect(osc.start).toHaveBeenCalled();
      expect(osc.stop).toHaveBeenCalled();
    }
    expect(ctx.bufferSources).toHaveLength(1);
    expect(audio.getDebugState().activeVoices).toBe(2);
  });

  it("move-home は音階ではなく低域の打撃音になる", () => {
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    audio.play("move-home", { semitone: 12 });
    const freqs = ctx.oscillators.map((o) => o.frequency.setValueAtTime.mock.calls[0][0]);
    expect(freqs).toHaveLength(2);
    for (const freq of freqs) {
      expect(freq).toBeLessThanOrEqual(300);
    }
    expect(ctx.bufferSources.length).toBeGreaterThanOrEqual(1);
  });

  it("noise 系レシピは再利用バッファを AudioBufferSource で再生する", () => {
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    expect(audio.play("drag-start")).toBe(true);
    expect(ctx.bufferSources).toHaveLength(1);
    expect(ctx.bufferSources[0].buffer).not.toBeNull();
    expect(ctx.bufferSources[0].start).toHaveBeenCalled();
  });

  it("同時発音上限を超えたら低優先度の voice を間引き、例外を出さない", () => {
    const { audio } = setup();
    audio.setEnabled(true);
    audio.play("landing"); // priority 1 の voice 2 つ
    expect(audio.getDebugState().activeVoices).toBe(2);
    audio.play("landing");
    expect(audio.getDebugState().activeVoices).toBe(4);
    // 重要音(priority 3)は装飾音を落として枠を作り、鳴る
    expect(audio.play("fail-invalid")).toBe(true);
    expect(audio.getDebugState().activeVoices).toBeLessThanOrEqual(4);
  });

  it("未知のレシピは false を返し、voice を作らない", () => {
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    expect(audio.play("no-such-recipe")).toBe(false);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it("OFF にすると 60ms 後に全 voice が停止する", () => {
    vi.useFakeTimers();
    const { audio } = setup();
    audio.setEnabled(true);
    audio.play("select");
    expect(audio.getDebugState().activeVoices).toBe(2);
    audio.setEnabled(false);
    vi.advanceTimersByTime(70);
    expect(audio.getDebugState().activeVoices).toBe(0);
    vi.useRealTimers();
  });

  it("stopAll は masterGain を 0 に固定せず、次の play が鳴る(新規ゲーム用)", () => {
    const { ctx, audio } = setup();
    audio.setEnabled(true);
    const master = ctx.createdGains[0];
    audio.play("select");
    const ramps = master.gain.linearRampToValueAtTime.mock.calls.length;
    audio.stopAll({ fadeMs: 0 });
    expect(audio.getDebugState().activeVoices).toBe(0);
    expect(master.gain.linearRampToValueAtTime.mock.calls.length).toBe(ramps);
    expect(audio.play("deal")).toBe(true);
    expect(audio.getDebugState().activeVoices).toBeGreaterThan(0);
  });
});
