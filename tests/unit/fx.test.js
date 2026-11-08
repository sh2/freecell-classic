import { describe, it, expect } from "vitest";
import {
  COLORS,
  GRAVITY,
  ORIGIN_Y_RATIO,
  PARTICLE_COUNT,
  DURATION_MS,
  BASE_CARD_WIDTH,
  SPEED,
  BRAKE,
  LIFE_JITTER,
  FADE_START,
  OUTLINE_RATIO,
  OUTLINE_SPEED_MIN,
  OUTLINE_SPEED_MAX,
  INNER_SPEED_MIN,
  INNER_SPEED_MAX,
  EMBER_ENABLED,
  EMBER_COLOR,
  EMBER_THRESHOLD_MIN,
  EMBER_THRESHOLD_MAX,
  EMBER_TRANSITION,
  MAX_BURSTS,
  groupForIndex,
  speedRangeForGroup,
  pickBurstColor,
  particleCountFor,
  burstScales,
  fadeFactors,
  shouldStartEmber,
  emberColorForProgress,
} from "../../src/js/fx.js";

describe("fx 調整用定数", () => {
  it("色は金・桜色・水色・紫・緑の5色", () => {
    expect(COLORS).toEqual(["#e0a916", "#ef7d9c", "#45a5e8", "#8656e8", "#34b26b"]);
  });

  it("重力は100〜130", () => {
    expect(GRAVITY).toBeGreaterThanOrEqual(100);
    expect(GRAVITY).toBeLessThanOrEqual(130);
  });

  it("輪郭の基準初速は300〜360", () => {
    expect(SPEED).toBeGreaterThanOrEqual(300);
    expect(SPEED).toBeLessThanOrEqual(360);
  });

  it("乗算ブレーキは2.2〜2.7/s", () => {
    expect(BRAKE).toBeGreaterThanOrEqual(2.2);
    expect(BRAKE).toBeLessThanOrEqual(2.7);
  });

  it("発火位置は対象セルの上端から33%", () => {
    expect(ORIGIN_Y_RATIO).toBeCloseTo(0.33, 5);
  });

  it("基準カード幅は88pxで、パーティクルは96個", () => {
    expect(BASE_CARD_WIDTH).toBe(88);
    expect(PARTICLE_COUNT).toBe(96);
  });

  it("持続時間は1000ms、寿命ばらつきは0.3", () => {
    expect(DURATION_MS).toBe(1000);
    expect(LIFE_JITTER).toBeCloseTo(0.3, 5);
  });

  it("フェード開始は0.6〜0.7", () => {
    expect(FADE_START).toBeGreaterThanOrEqual(0.6);
    expect(FADE_START).toBeLessThanOrEqual(0.7);
  });

  it("同時バースト上限は3", () => {
    expect(MAX_BURSTS).toBe(3);
  });

  it("粒数倍率は既定で96粒、1.4の二乗で188粒、2.0の二乗で384粒、不正値は等倍", () => {
    expect(particleCountFor()).toBe(96);
    expect(particleCountFor(1)).toBe(96);
    expect(particleCountFor(1.96)).toBe(188);
    expect(particleCountFor(4)).toBe(384);
    expect(particleCountFor(0)).toBe(96);
    expect(particleCountFor(Number.NaN)).toBe(96);
  });

  it("大きさ倍率は広がりにだけ掛かり、粒と重力は画面幅由来の scale のまま", () => {
    const standard = burstScales(BASE_CARD_WIDTH, 1);
    const large = burstScales(BASE_CARD_WIDTH, 2);
    // 倍率 2.0 でも粒の大きさ・重力に使う scale は標準と同じ
    expect(large.particleScale).toBe(standard.particleScale);
    // 広がり (初速) だけが倍率どおり大きくなる
    expect(large.spreadScale).toBe(standard.spreadScale * 2);

    // 狭い画面では粒と重力は 0.5 倍、広がりは倍率を掛けた 1.0 倍
    const narrow = burstScales(BASE_CARD_WIDTH / 2, 2);
    expect(narrow.particleScale).toBe(0.5);
    expect(narrow.spreadScale).toBe(1);
    expect(burstScales(BASE_CARD_WIDTH, 0).spreadScale).toBe(1);
  });
});

describe("2集団の分布", () => {
  it("輪郭は約55%（96粒で53粒）、残りは内側", () => {
    const groups = Array.from({ length: PARTICLE_COUNT }, (_, i) => groupForIndex(i, PARTICLE_COUNT));
    const outlineCount = groups.filter((group) => group === "outline").length;
    expect(OUTLINE_RATIO).toBeCloseTo(0.55, 5);
    expect(outlineCount).toBe(53);
    expect(PARTICLE_COUNT - outlineCount).toBe(43);
  });

  it("輪郭は0.9〜1.0、内側は0.1〜0.9の速さ係数を使う", () => {
    expect(speedRangeForGroup("outline")).toEqual({
      min: OUTLINE_SPEED_MIN,
      max: OUTLINE_SPEED_MAX,
    });
    expect(speedRangeForGroup("inner")).toEqual({
      min: INNER_SPEED_MIN,
      max: INNER_SPEED_MAX,
    });
    expect(OUTLINE_SPEED_MIN).toBe(0.9);
    expect(OUTLINE_SPEED_MAX).toBe(1.0);
    expect(INNER_SPEED_MIN).toBe(0.1);
    expect(INNER_SPEED_MAX).toBe(0.9);
  });
});

describe("バースト色の選択", () => {
  it("直前のバーストと同色を続けない", () => {
    for (const previous of COLORS) {
      for (const random of [0, 0.2, 0.5, 0.8, 0.999]) {
        const color = pickBurstColor(previous, () => random);
        expect(COLORS).toContain(color);
        expect(color).not.toBe(previous);
      }
    }
    expect(pickBurstColor(null, () => 0)).toBe(COLORS[0]);
  });
});

describe("寿命によるフェード", () => {
  it("FADE_START までは alpha も大きさも 1", () => {
    expect(fadeFactors(0).alpha).toBe(1);
    expect(fadeFactors(0).size).toBe(1);
    expect(fadeFactors(FADE_START).alpha).toBe(1);
    expect(fadeFactors(FADE_START).size).toBe(1);
  });

  it("寿命末で alpha 0・大きさ 0.4 へ単調に下がる", () => {
    const points = [FADE_START, 0.75, 0.85, 0.95, 1];
    const factors = points.map((p) => fadeFactors(p));
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i].alpha).toBeLessThan(factors[i - 1].alpha);
      expect(factors[i].size).toBeLessThan(factors[i - 1].size);
    }
    expect(fadeFactors(1).alpha).toBeCloseTo(0, 5);
    expect(fadeFactors(1).size).toBeCloseTo(0.4, 5);
  });
});

describe("余燼", () => {
  it("下向きに転じ、しきい値を超えたときだけ開始する", () => {
    expect(EMBER_ENABLED).toBe(true);
    expect(EMBER_THRESHOLD_MIN).toBeGreaterThanOrEqual(0.55);
    expect(EMBER_THRESHOLD_MAX).toBeLessThanOrEqual(0.68);
    expect(EMBER_TRANSITION).toBeCloseTo(0.1, 5);
    expect(shouldStartEmber(10, 0.6, 0.55)).toBe(true);
    expect(shouldStartEmber(-10, 0.6, 0.55)).toBe(false);
    expect(shouldStartEmber(10, 0.5, 0.55)).toBe(false);
    expect(shouldStartEmber(10, 0.6, 0.55, false)).toBe(false);
  });

  it("開始前は元の色、遷移後は赤黒になる", () => {
    expect(EMBER_TRANSITION).toBeGreaterThan(0);
    for (const base of COLORS) {
      expect(emberColorForProgress(base, null, 0.5)).toBe(base);
      expect(emberColorForProgress(base, 0.5, 0.5)).toBe(base);
      expect(emberColorForProgress(base, 0.5, 0.5 + EMBER_TRANSITION / 2)).not.toBe(base);
      expect(emberColorForProgress(base, 0.5, 0.5 + EMBER_TRANSITION / 2)).not.toBe(EMBER_COLOR);
      expect(emberColorForProgress(base, 0.5, 0.5 + EMBER_TRANSITION)).toBe(EMBER_COLOR);
      expect(emberColorForProgress(base, 0.5, 1)).toBe(EMBER_COLOR);
      expect(emberColorForProgress(base, 0.5, 0.5 + EMBER_TRANSITION, false)).toBe(base);
    }
  });
});
