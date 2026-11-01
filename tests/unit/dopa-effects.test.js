import { describe, expect, it, vi } from "vitest";
import { createDopaMode } from "../../src/js/dopa.js";
import {
  DOPA_EFFECT_IDS,
  DOPA_EFFECT_META,
  DOPA_ASSIGNMENTS,
  DOPA_CATEGORIES,
  EPIC_CHANCE,
  EPIC_MULTIPLIER,
  pickDuration,
  shouldEpic,
} from "../../src/js/dopa-effects.js";
import { EFFECT_HANDLERS_A } from "../../src/js/dopa-effects-a.js";
import { EFFECT_HANDLERS_B } from "../../src/js/dopa-effects-b.js";
import { EFFECT_HANDLERS_C } from "../../src/js/dopa-effects-c.js";
import { EFFECT_HANDLERS_D } from "../../src/js/dopa-effects-d.js";
import { EFFECT_HANDLERS_E } from "../../src/js/dopa-effects-e.js";
import { EFFECT_HANDLERS_F } from "../../src/js/dopa-effects-f.js";
import { EFFECT_HANDLERS_G } from "../../src/js/dopa-effects-g.js";
import { DOPA_ONOMATOPE } from "../../src/js/dopa-effects-d.js";
import { DOPA_AUDIO_RECIPES, DOPA_REMOVED_RECIPES } from "../../src/js/dopa-audio.js";
import { LOCAL_EFFECT_SCALE, scaleLocalSpread } from "../../src/js/dopa-visuals.js";
import {
  DOPA_TEXT_POOLS,
  TEXT_ANCHORS,
  TEXT_MOTIONS,
  chooseTextAnchor,
  chooseTextMotion,
  buildTextTimeline,
} from "../../src/js/dopa-text.js";

/**
 * 増強版の演出レジストリと割り当ての検証。
 * ID は固定(56 件)で、すべて実プレイのどこかで発火する割り当てを持つ。
 */

const EXPECTED_IDS = [
  "a01-ghost",
  "a02-crack",
  "a03-giant",
  "a04-spin",
  "a05-boomerang",
  "a06-warp",
  "a07-tornado",
  "a08-rocket",
  "a09-bounce",
  "a10-split",
  "b01-explosion",
  "b02-machinegun",
  "b03-iaido",
  "b04-meteor",
  "b05-lightning",
  "b06-beam",
  "b07-rush",
  "b08-drill",
  "b09-groundcrack",
  "b10-blackhole",
  "c01-punchzoom",
  "c02-speedlines",
  "c03-slowmo",
  "c04-invert",
  "c05-glitch",
  "c06-split-screen",
  "c07-fisheye",
  "c08-kaleido",
  "c09-spotlight",
  "c10-felt",
  "d01-cutin",
  "d02-commentary",
  "d03-damage",
  "d04-combo",
  "d05-onomatopeia",
  "d06-rank",
  "d07-ticker",
  "d08-crowd",
  "e01-magic",
  "e02-ssr",
  "e03-slot",
  "e04-firework",
  "e05-sakura",
  "e06-space",
  "e07-underwater",
  "e08-casino",
  "f01-foundation-finale",
  "f02-crown",
  "f03-countdown",
  "f04-curtain",
  "f05-glassbreak",
  "f06-staffroll",
  "g01-fail-cross",
  "g02-fail-sink",
  "g03-stuck-gray",
  "g04-stuck-skull",
];

/** 割り当て表に現れる ID をすべて集める */
function collectAssignedIds(value, output = new Set()) {
  if (typeof value === "string") {
    if (value.includes("-") && DOPA_EFFECT_META[value]) {
      output.add(value);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssignedIds(item, output);
    }
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectAssignedIds(item, output);
    }
  }
  return output;
}

function createFakeVisuals() {
  return {
    setEnabled() {},
    playEffect() {
      return true;
    },
    winCelebrate() {},
    fadeWin() {},
    cancelEffects() {},
    cancelAnchored() {},
    cancelAll() {},
    getDebugState() {
      return { activeEffects: 0, activeRegistryEffects: 0 };
    },
  };
}

function createFakeAudio() {
  return {
    setEnabled() {},
    unlock() {},
    play() {
      return true;
    },
    stopAll() {},
    getDebugState() {
      return { activeVoices: 0 };
    },
  };
}

function setup() {
  const visuals = createFakeVisuals();
  const audio = createFakeAudio();
  const dopa = createDopaMode({ audio, visuals, env: { now: () => 0 } });
  return { dopa, visuals, audio };
}

describe("増強版: 演出レジストリ", () => {
  it("registered がチケットの 56 ID と完全一致する", () => {
    expect(DOPA_EFFECT_IDS).toHaveLength(56);
    expect([...DOPA_EFFECT_IDS]).toEqual(EXPECTED_IDS);
    expect(Object.keys(DOPA_EFFECT_META)).toHaveLength(56);
  });

  it("カテゴリ別の件数が A10 / B10 / C10 / D8 / E8 / F6 / G4 になる", () => {
    expect(DOPA_CATEGORIES.A).toHaveLength(10);
    expect(DOPA_CATEGORIES.B).toHaveLength(10);
    expect(DOPA_CATEGORIES.C).toHaveLength(10);
    expect(DOPA_CATEGORIES.D).toHaveLength(8);
    expect(DOPA_CATEGORIES.E).toHaveLength(8);
    expect(DOPA_CATEGORIES.F).toHaveLength(6);
    expect(DOPA_CATEGORIES.G).toHaveLength(4);
  });

  it("各 ID が割り当て表のどこかに現れる", () => {
    const assigned = collectAssignedIds(DOPA_ASSIGNMENTS);
    for (const id of EXPECTED_IDS) {
      expect(assigned.has(id), `${id} が割り当てに無い`).toBe(true);
    }
    expect(assigned.size).toBe(56);
  });

  it("base が 2.5 秒以内で、epic 時も 6 秒以内に収まる", () => {
    for (const id of EXPECTED_IDS) {
      const base = DOPA_EFFECT_META[id].duration;
      expect(base).toBeLessThanOrEqual(2500);
      expect(base * EPIC_MULTIPLIER).toBeLessThanOrEqual(6000);
    }
  });

  it("56 ID すべてに実装ハンドラーがある", () => {
    const handlers = {
      ...EFFECT_HANDLERS_A,
      ...EFFECT_HANDLERS_B,
      ...EFFECT_HANDLERS_C,
      ...EFFECT_HANDLERS_D,
      ...EFFECT_HANDLERS_E,
      ...EFFECT_HANDLERS_F,
      ...EFFECT_HANDLERS_G,
    };
    expect(Object.keys(handlers).sort()).toEqual([...EXPECTED_IDS].sort());
    for (const id of EXPECTED_IDS) {
      expect(typeof handlers[id]).toBe("function");
    }
  });
});

describe("fix-01 FB-1: 派手な効果音の割り当て", () => {
  it("爆発・重火器・魔法・ライトセーバー系のレシピを指す", () => {
    expect(DOPA_EFFECT_META["b01-explosion"].sound).toBe("explosion");
    expect(DOPA_EFFECT_META["b04-meteor"].sound).toBe("explosion");
    expect(DOPA_EFFECT_META["f05-glassbreak"].sound).toBe("explosion");
    expect(DOPA_EFFECT_META["b02-machinegun"].sound).toBe("heavy-gun");
    expect(DOPA_EFFECT_META["b03-iaido"].sound).toBe("saber");
    expect(DOPA_EFFECT_META["e01-magic"].sound).toBe("magic-boon");
    expect(DOPA_EFFECT_META["e02-ssr"].sound).toBe("magic-boon");
    expect(DOPA_EFFECT_META["e03-slot"].sound).toBe("magic");
  });

  it("B 群・E 群は優しい sparkle を使わない", () => {
    for (const id of [...DOPA_CATEGORIES.B, ...DOPA_CATEGORIES.E]) {
      expect(DOPA_EFFECT_META[id].sound, `${id} が sparkle`).not.toBe("sparkle");
    }
  });
});

describe("fix-01 FB-2: 英語オノマトペ", () => {
  it("d05 の文言プールが英大文字と ! のみで 10 種以上", () => {
    expect(DOPA_ONOMATOPE.length).toBeGreaterThanOrEqual(10);
    for (const word of DOPA_ONOMATOPE) {
      expect(word).toMatch(/^[A-Z!]+$/);
    }
    expect(DOPA_ONOMATOPE).toContain("BOOM!");
    expect(DOPA_ONOMATOPE).toContain("KABOOM!");
    expect(DOPA_ONOMATOPE).toContain("RATATATA!");
  });
});

describe("fix-01 FB-3: 局所演出の拡大", () => {
  it("局所スケール定数が 2〜3 で、バースト系の飛程に掛かる", () => {
    expect(LOCAL_EFFECT_SCALE).toBeGreaterThanOrEqual(2);
    expect(LOCAL_EFFECT_SCALE).toBeLessThanOrEqual(3);
    expect(scaleLocalSpread(10)).toBeGreaterThanOrEqual(20);
    expect(scaleLocalSpread(10)).toBeLessThanOrEqual(30);
  });
});

describe("fix-03 FB-9: 低音重視の音レシピ", () => {
  it("削除した軽いレシピが現行一覧に存在しない", () => {
    expect(DOPA_REMOVED_RECIPES.length).toBeGreaterThanOrEqual(5);
    for (const name of DOPA_REMOVED_RECIPES) {
      expect(DOPA_AUDIO_RECIPES[name], `${name} が残っている`).toBeUndefined();
    }
  });

  it("全演出の sound が現行レシピに存在する", () => {
    for (const id of EXPECTED_IDS) {
      const sound = DOPA_EFFECT_META[id].sound;
      expect(DOPA_AUDIO_RECIPES[sound], `${id} -> ${sound}`).toBeDefined();
    }
  });

  it("全レシピに低域成分の宣言(low: true / lowHz <= 160Hz)がある", () => {
    for (const [name, recipe] of Object.entries(DOPA_AUDIO_RECIPES)) {
      expect(recipe.low, `${name} の low 宣言`).toBe(true);
      expect(recipe.lowHz, `${name} の lowHz`).toBeLessThanOrEqual(160);
    }
  });
});

describe("fix-04 FB-12: 魔法陣の低域ドローン", () => {
  it("e01 は magic-boon を指し、基音が 80Hz 以下", () => {
    expect(DOPA_EFFECT_META["e01-magic"].sound).toBe("magic-boon");
    expect(DOPA_AUDIO_RECIPES["magic-boon"]).toBeDefined();
    expect(DOPA_AUDIO_RECIPES["magic-boon"].lowHz).toBeLessThanOrEqual(80);
  });
});

describe("fix-02 FB-4: 英語文言プール", () => {
  it("全プール文字列に日本語(ひらがな・カタカナ・漢字)が含まれない", () => {
    const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;
    for (const [name, pool] of Object.entries(DOPA_TEXT_POOLS)) {
      expect(Array.isArray(pool), `${name} が配列でない`).toBe(true);
      for (const text of pool) {
        expect(typeof text).toBe("string");
        expect(text, `${name}: ${text}`).not.toMatch(japanese);
      }
    }
  });

  it("主要プールが 10 種程度ある", () => {
    for (const name of ["cutin", "commentary", "crowd", "slowmo", "space", "underwater"]) {
      expect(DOPA_TEXT_POOLS[name].length).toBeGreaterThanOrEqual(10);
    }
    expect(DOPA_TEXT_POOLS.onomatope.length).toBeGreaterThanOrEqual(10);
  });
});

describe("fix-02 FB-6: アンカーと文字アニメーション", () => {
  it("直前と同じアンカーを避け、rng で候補が変わる", () => {
    const first = chooseTextAnchor(() => 0, null);
    expect(first.name).toBe(TEXT_ANCHORS[0].name);
    const next = chooseTextAnchor(() => 0, first.name);
    expect(next.name).not.toBe(first.name);
    const last = chooseTextAnchor(() => 0.999, null);
    expect(last.name).toBe(TEXT_ANCHORS[TEXT_ANCHORS.length - 1].name);
    expect(TEXT_ANCHORS.length).toBeGreaterThanOrEqual(6);
  });

  it("motion が cutin / letters / punch から選ばれる", () => {
    expect(TEXT_MOTIONS).toEqual(["cutin", "letters", "punch"]);
    expect(chooseTextMotion(() => 0)).toBe("cutin");
    expect(chooseTextMotion(() => 0.34)).toBe("letters");
    expect(chooseTextMotion(() => 0.99)).toBe("punch");
  });
});

describe("fix-03 FB-8 / FB-10: 共通部品", () => {
  it("テキストの hold が 120〜250ms(epic は 300ms まで)", () => {
    const normal = buildTextTimeline(900);
    expect(normal.hold).toBeGreaterThanOrEqual(120);
    expect(normal.hold).toBeLessThanOrEqual(250);
    expect(normal.enter).toBeGreaterThan(0);
    expect(normal.exit).toBeGreaterThan(0);
    const epic = buildTextTimeline(2700, { epic: true });
    expect(epic.hold).toBeGreaterThanOrEqual(120);
    expect(epic.hold).toBeLessThanOrEqual(300);
  });
});

describe("fix-02 FB-7: ジッターと epic", () => {
  it("通常は base の 0.8〜1.3 倍、epic は base の 3 倍", () => {
    const base = DOPA_EFFECT_META["b01-explosion"].duration;
    expect(pickDuration("b01-explosion", () => 0, { epic: false })).toBeCloseTo(base * 0.8, 5);
    expect(pickDuration("b01-explosion", () => 1, { epic: false })).toBeCloseTo(base * 1.3, 5);
    const mid = pickDuration("b01-explosion", () => 0.5, { epic: false });
    expect(mid).toBeGreaterThanOrEqual(base * 0.8);
    expect(mid).toBeLessThanOrEqual(base * 1.3);
    expect(pickDuration("e02-ssr", () => 0.7, { epic: true })).toBe(
      DOPA_EFFECT_META["e02-ssr"].duration * EPIC_MULTIPLIER
    );
  });

  it("epic の確定条件と 12% 抽選", () => {
    expect(EPIC_CHANCE).toBeCloseTo(0.12, 5);
    expect(shouldEpic("e02-ssr", () => 0.99)).toBe(true);
    expect(shouldEpic("f01-foundation-finale", () => 0.99)).toBe(true);
    expect(shouldEpic("f02-crown", () => 0.99)).toBe(true);
    expect(shouldEpic("a01-ghost", () => 0.99, { combo: 8 })).toBe(true);
    expect(shouldEpic("d01-cutin", () => 0.05)).toBe(true);
    expect(shouldEpic("d01-cutin", () => 0.5)).toBe(false);
    expect(shouldEpic("a01-ghost", () => 0)).toBe(false);
  });
});

describe("増強版: triggerEffect と debug", () => {
  it("56 件を順に発火すると counts がすべて 1 になり、history が発火順になる", () => {
    const { dopa } = setup();
    for (const id of EXPECTED_IDS) {
      expect(dopa.triggerEffect(id)).toBe(true);
    }
    const effects = dopa.debugState().effects;
    expect(effects.registered).toEqual(EXPECTED_IDS);
    expect(effects.history).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) {
      expect(effects.counts[id]).toBe(1);
    }
    expect(effects.active).toBe(0);
  });

  it("未知の ID は発火せず counts を増やさない", () => {
    const { dopa } = setup();
    expect(dopa.triggerEffect("z99-unknown")).toBe(false);
    const effects = dopa.debugState().effects;
    expect(Object.values(effects.counts).reduce((a, b) => a + b, 0)).toBe(0);
    expect(effects.history).toEqual([]);
  });

  it("同じ ID の再発火で counts が増える", () => {
    const { dopa } = setup();
    dopa.triggerEffect("a01-ghost");
    dopa.triggerEffect("a01-ghost");
    expect(dopa.debugState().effects.counts["a01-ghost"]).toBe(2);
  });
});

describe("増強版: 勝利シーケンス", () => {
  it("f04 → f05 → f06 の順に発火する", () => {
    vi.useFakeTimers();
    try {
      const { dopa } = setup();
      dopa.setEnabled(true);
      dopa.handle({ type: "win" });
      expect(dopa.debugState().effects.history).toEqual(["f04-curtain"]);
      vi.advanceTimersByTime(1000);
      expect(dopa.debugState().effects.history).toEqual(["f04-curtain", "f05-glassbreak"]);
      vi.advanceTimersByTime(1100);
      expect(dopa.debugState().effects.history).toEqual([
        "f04-curtain",
        "f05-glassbreak",
        "f06-staffroll",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("OFF にすると待機中の勝利シーケンスが発火しない", () => {
    vi.useFakeTimers();
    try {
      const { dopa } = setup();
      dopa.setEnabled(true);
      dopa.handle({ type: "win" });
      dopa.setEnabled(false);
      vi.advanceTimersByTime(3000);
      expect(dopa.debugState().effects.history).toEqual(["f04-curtain"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
