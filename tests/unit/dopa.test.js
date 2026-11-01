import { describe, expect, it, vi } from "vitest";
import { createDopaMode, COMBO_WINDOW_MS } from "../../src/js/dopa.js";
import { createApp } from "../../src/js/app.js";

/**
 * ドパモード コントローラーの単体テスト。
 * view / audio / visuals はすべて記録用の fake を注入し、
 * ゲームロジックや DOM に依存せずレシピ選択と combo を検証する。
 */

function createFakeView() {
  const calls = [];
  let hook = null;
  return {
    calls,
    setDopaMode(on) {
      calls.push(`view:${on}`);
    },
    onBeforeRender(fn) {
      hook = fn;
      calls.push("hook");
    },
    getDopaStage() {
      return null;
    },
    runHook() {
      if (hook) {
        hook();
      }
    },
  };
}

function createFakeAudio() {
  const calls = [];
  return {
    calls,
    setEnabled(on) {
      calls.push(`audio-enabled:${on}`);
    },
    unlock() {
      calls.push("unlock");
    },
    play(recipe, opts) {
      calls.push(`play:${recipe}:${JSON.stringify(opts ?? {})}`);
      return true;
    },
    stopAll(opts) {
      calls.push(`stopAll:${opts ? opts.fadeMs : 0}`);
    },
    getDebugState() {
      return { activeVoices: 0 };
    },
  };
}

function createFakeVisuals() {
  const calls = [];
  return {
    calls,
    setEnabled() {},
    selectionPulse(e) {
      calls.push(`select:${e.cardId}`);
    },
    dragLift(e) {
      calls.push(`dragLift:${e.on}`);
    },
    flightTrail(e) {
      calls.push(`trail:${(e.cardIds ?? []).join(",")}`);
    },
    landingBurst(e) {
      calls.push(`burst:${e.zone}:${e.combo}`);
    },
    homeGlow(e) {
      calls.push(`glow:${e.index}:${e.combo}`);
    },
    failFlash(e) {
      calls.push(`fail:${e.reason}`);
    },
    dealSparkles() {
      calls.push("deal");
    },
    hintRings() {
      calls.push("hint");
    },
    undoRipple() {
      calls.push("undo");
    },
    stuckVignette() {
      calls.push("stuck");
    },
    winCelebrate() {
      calls.push("win");
    },
    fadeWin() {
      calls.push("fadeWin");
    },
    cancelAnchored() {
      calls.push("cancelAnchored");
    },
    cancelAll() {
      calls.push("cancelAll");
    },
    getDebugState() {
      return { activeEffects: 0 };
    },
  };
}

function setup(env = {}) {
  const view = createFakeView();
  const audio = createFakeAudio();
  const visuals = createFakeVisuals();
  let t = 1000;
  const dopa = createDopaMode({
    view,
    audio,
    visuals,
    env: { now: () => t, ...env },
  });
  return {
    view,
    audio,
    visuals,
    dopa,
    advance(ms) {
      t += ms;
    },
    now() {
      return t;
    },
  };
}

describe("createDopaMode: 状態", () => {
  it("デフォルトは OFF で handle() が演出を呼ばない", () => {
    const { dopa, view, audio, visuals } = setup();
    expect(dopa.isEnabled()).toBe(false);
    dopa.handle({ type: "select", cardId: 1 });
    expect(view.calls).toEqual(["hook"]);
    expect(audio.calls).toEqual([]);
    expect(visuals.calls).toEqual([]);
    expect(dopa.debugState().activeEffects).toBe(0);
  });

  it("setEnabled(true/false) が View / Audio / Reset を正しい順で呼ぶ", () => {
    const { dopa, view, audio, visuals } = setup();
    dopa.setEnabled(true);
    expect(view.calls).toContain("view:true");
    expect(audio.calls).toContain("audio-enabled:true");
    expect(audio.calls).toContain("unlock");
    expect(visuals.calls).not.toContain("cancelAll");

    dopa.setEnabled(false);
    expect(view.calls).toContain("view:false");
    expect(audio.calls).toContain("audio-enabled:false");
    expect(visuals.calls).toContain("cancelAll");
    expect(audio.calls.some((c) => c.startsWith("stopAll"))).toBe(true);
  });

  it("同じ値の setEnabled は何もしない(多重呼び出しに耐える)", () => {
    const { dopa, view } = setup();
    dopa.setEnabled(false);
    const before = view.calls.filter((c) => c.startsWith("view:")).length;
    expect(before).toBe(0);
    dopa.setEnabled(true);
    dopa.setEnabled(true);
    const after = view.calls.filter((c) => c.startsWith("view:")).length;
    expect(after).toBe(1);
  });

  it("未知イベントは無視する", () => {
    const { dopa, audio, visuals } = setup();
    dopa.setEnabled(true);
    audio.calls.length = 0;
    visuals.calls.length = 0;
    dopa.handle({ type: "unknown-event" });
    dopa.handle(null);
    expect(audio.calls).toEqual([]);
    expect(visuals.calls).toEqual([]);
  });
});

describe("createDopaMode: イベント→レシピ", () => {
  it("move + dest home はホーム音と発光になる", () => {
    const { dopa, audio, visuals } = setup();
    dopa.setEnabled(true);
    dopa.handle({
      type: "move",
      source: "manual",
      cardIds: [0],
      dest: { zone: "home", index: 0 },
      origins: {},
    });
    expect(visuals.calls).toContain("glow:0:1");
    expect(audio.calls.some((c) => c.includes("play:move-home"))).toBe(true);
  });

  it("move + dest free はフリーセル音になる", () => {
    const { dopa, audio } = setup();
    dopa.setEnabled(true);
    dopa.handle({
      type: "move",
      source: "manual",
      cardIds: [0],
      dest: { zone: "free", index: 1 },
      origins: {},
    });
    expect(audio.calls.some((c) => c.includes("play:move-free"))).toBe(true);
  });

  it("move-fail は失敗音とビネットになる", () => {
    const { dopa, audio, visuals } = setup();
    dopa.setEnabled(true);
    dopa.handle({ type: "move-fail", reason: "too-many" });
    expect(visuals.calls).toContain("fail:too-many");
    expect(audio.calls.some((c) => c.includes("play:fail-too-many"))).toBe(true);
  });

  it("source solver は自動解答用の控えめなレシピになる", () => {
    const { dopa, audio } = setup();
    dopa.setEnabled(true);
    dopa.handle({
      type: "move",
      source: "solver",
      cardIds: [0],
      dest: { zone: "cascade", index: 1 },
      origins: {},
    });
    expect(audio.calls.some((c) => c.includes("play:solver-move"))).toBe(true);
  });

  it("reducedMotion が true でも視覚演出が呼ばれる", () => {
    const { dopa, visuals } = setup({ reducedMotion: true });
    dopa.setEnabled(true);
    dopa.handle({ type: "select", cardId: 5 });
    expect(visuals.calls).toContain("select:5");
  });
});

describe("createDopaMode: combo", () => {
  it("900ms 以内の home で増加し、12 半音で頭打ちになる", () => {
    const { dopa, audio, advance } = setup();
    dopa.setEnabled(true);
    audio.calls.length = 0;
    for (let i = 0; i < 15; i++) {
      dopa.handle({
        type: "home",
        source: "auto-home",
        cardIds: [0],
        dest: { zone: "home", index: i % 4 },
        origins: {},
      });
      advance(100);
    }
    expect(dopa.debugState().combo).toBe(13);
    const homePlays = audio.calls.filter((c) => c.includes("play:move-home"));
    expect(homePlays).toHaveLength(15);
    expect(homePlays[0]).toContain('"semitone":0');
    expect(homePlays[12]).toContain('"semitone":12');
    expect(homePlays[14]).toContain('"semitone":12');
  });

  it("時間経過で combo が 1 に戻る", () => {
    const { dopa, advance } = setup();
    dopa.setEnabled(true);
    const home = () =>
      dopa.handle({
        type: "home",
        source: "auto-home",
        cardIds: [0],
        dest: { zone: "home", index: 0 },
        origins: {},
      });
    home();
    home();
    expect(dopa.debugState().combo).toBe(2);
    advance(COMBO_WINDOW_MS + 1);
    home();
    expect(dopa.debugState().combo).toBe(1);
  });

  it("ホーム以外の move・undo・deal で combo がリセットされる", () => {
    const { dopa } = setup();
    dopa.setEnabled(true);
    const home = () =>
      dopa.handle({
        type: "home",
        source: "auto-home",
        cardIds: [0],
        dest: { zone: "home", index: 0 },
        origins: {},
      });
    home();
    home();
    expect(dopa.debugState().combo).toBe(2);
    dopa.handle({
      type: "move",
      source: "manual",
      cardIds: [0],
      dest: { zone: "cascade", index: 1 },
      origins: {},
    });
    expect(dopa.debugState().combo).toBe(0);

    home();
    home();
    dopa.handle({ type: "undo" });
    expect(dopa.debugState().combo).toBe(0);

    home();
    home();
    dopa.handle({ type: "deal" });
    expect(dopa.debugState().combo).toBe(0);
  });
});

describe("createDopaMode: リセット", () => {
  it("reset() が cancelAll と combo リセットを行う", () => {
    const { dopa, visuals } = setup();
    dopa.setEnabled(true);
    dopa.handle({
      type: "home",
      source: "auto-home",
      cardIds: [0],
      dest: { zone: "home", index: 0 },
      origins: {},
    });
    expect(dopa.debugState().combo).toBe(1);
    dopa.reset("new-game");
    expect(visuals.calls).toContain("cancelAll");
    expect(dopa.debugState().combo).toBe(0);
  });

  it("reset イベントでも同じ掃除を行う", () => {
    const { dopa, visuals } = setup();
    dopa.setEnabled(true);
    visuals.calls.length = 0;
    dopa.handle({ type: "reset", reason: "new-game" });
    expect(visuals.calls).toContain("cancelAll");
  });
});

describe("createDopaMode: 依存なし", () => {
  it("view / audio / visuals 未指定でも生成でき、handle が例外を出さない", () => {
    const dopa = createDopaMode({ env: { now: () => 0 } });
    expect(() => dopa.handle({ type: "win" })).not.toThrow();
    expect(() => dopa.setEnabled(true)).not.toThrow();
    expect(dopa.debugState().enabled).toBe(true);
  });
});

/* ---------------- app との接続 ---------------- */

function createAppView() {
  return {
    render() {},
    setTimerLabel() {},
    showToast() {},
    showWin() {},
    showStuck() {},
    hideOverlay() {},
    seedInput() {
      return null;
    },
    buildBoard() {},
    failFeedback() {},
    setNextRenderAnimation() {},
    runAfterAnimations(fn) {
      fn();
    },
    getCardRects(cardIds) {
      return Object.fromEntries(cardIds.map((id) => [id, { left: 0, top: 0 }]));
    },
    getDragCardRects() {
      return {};
    },
    setAutoSolving() {},
    setAnimationsEnabled() {},
  };
}

describe("createApp + dopa: イベント通知", () => {
  it("成功手・アンドゥ・勝利が dopa へ通知される", () => {
    const view = createAppView();
    const audio = createFakeAudio();
    const visuals = createFakeVisuals();
    const dopa = createDopaMode({ view: createFakeView(), audio, visuals, env: { now: () => 0 } });
    const app = createApp({ view, dopa });
    app.startGame(1);
    expect(visuals.calls).toContain("cancelAll"); // reset
    dopa.setEnabled(true);
    expect(dopa.debugState().enabled).toBe(true);

    app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    expect(audio.calls.some((c) => c.includes("play:move-free"))).toBe(true);
    expect(visuals.calls.some((c) => c.startsWith("trail:"))).toBe(true);

    app.undo();
    expect(audio.calls.some((c) => c.includes("play:undo"))).toBe(true);

    app.setWinBoard(52);
    expect(audio.calls.some((c) => c.includes("play:win"))).toBe(true);
    expect(visuals.calls).toContain("win");
  });

  it("dopa 未指定の createApp でも従来どおり動く", () => {
    const view = createAppView();
    const app = createApp({ view });
    expect(() => app.startGame(1)).not.toThrow();
    expect(app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0).ok).toBe(true);
  });
});

describe("createDopaMode: モバイル環境", () => {
  it("env.mobile が audio/visuals に伝わる", async () => {
    const { createDopaAudio } = await import("../../src/js/dopa-audio.js");
    const audio = createDopaAudio({ AudioContextCtor: null, mobile: true });
    expect(audio.getDebugState().mobile).toBe(true);
    expect(audio.getDebugState().voiceLimit).toBe(8);
  });
});
