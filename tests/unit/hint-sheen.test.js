import { describe, it, expect } from "vitest";
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
} from "../../src/js/hint-sheen.js";

/** rgba(...) の alpha を取り出す */
function alphaOf(color) {
  const match = /rgba\([^)]*,\s*([0-9.]+)\s*\)/.exec(color);
  return match ? Number(match[1]) : NaN;
}

describe("hint-sheen 調整用定数", () => {
  it("帯の所要時間は 900ms 以下、静止光も短い", () => {
    expect(SWEEP_DURATION_MS).toBeGreaterThan(0);
    expect(SWEEP_DURATION_MS).toBeLessThanOrEqual(900);
    expect(STATIC_DURATION_MS).toBeGreaterThan(0);
    expect(STATIC_DURATION_MS).toBeLessThanOrEqual(900);
  });

  it("帯の幅はカード幅の 0〜1 倍、傾きは控えめ", () => {
    expect(SWEEP_BAND_RATIO).toBeGreaterThan(0);
    expect(SWEEP_BAND_RATIO).toBeLessThanOrEqual(1);
    expect(Math.abs(SWEEP_SKEW_DEG)).toBeLessThanOrEqual(30);
  });

  it("発光は絵柄の視認性を損なわない濃さ(色味の alpha は 0.6 以下)", () => {
    for (const color of [
      SWEEP_LEAD,
      SWEEP_MAIN,
      SWEEP_TAIL,
      SWEEP_GLOW,
      STATIC_TOP,
      STATIC_BOTTOM,
      STATIC_GLOW,
    ]) {
      expect(alphaOf(color)).toBeGreaterThan(0);
      expect(alphaOf(color)).toBeLessThanOrEqual(0.6);
    }
    // 白いハイライトはカード面より明るく見えるが、白同士なので絵柄を隠さない
    expect(alphaOf(SWEEP_WHITE)).toBeGreaterThan(alphaOf(SWEEP_MAIN));
  });
});

describe("発光モードの判定", () => {
  it("アニメーション有効かつ reduced-motion でないときだけ帯を走らせる", () => {
    expect(chooseSheenMode(true, false)).toBe("sweep");
  });

  it("reduced-motion では帯を走らせない", () => {
    expect(chooseSheenMode(true, true)).toBe("still");
    expect(chooseSheenMode(false, true)).toBe("still");
  });

  it("ゲーム内アニメーション無効でも帯を走らせない", () => {
    expect(chooseSheenMode(false, false)).toBe("still");
  });
});

describe("移動元カードの見えている高さ", () => {
  const rect = { top: 100, height: 124 };

  it("後続カードが無ければカード全体", () => {
    expect(visibleSheenHeight(rect, null)).toBe(124);
  });

  it("後続カードに隠れる分だけ切り詰める", () => {
    expect(visibleSheenHeight(rect, { top: 128 })).toBe(28);
    expect(visibleSheenHeight(rect, { top: 120 })).toBe(20);
  });

  it("後続カードが上端以前・下端以降ならカード全体", () => {
    expect(visibleSheenHeight(rect, { top: 100 })).toBe(124);
    expect(visibleSheenHeight(rect, { top: 90 })).toBe(124);
    expect(visibleSheenHeight(rect, { top: 224 })).toBe(124);
    expect(visibleSheenHeight(rect, { top: 300 })).toBe(124);
  });

  it("不正な矩形は 0、不正な後続位置はカード全体", () => {
    expect(visibleSheenHeight(null, null)).toBe(0);
    expect(visibleSheenHeight({ top: 0, height: NaN }, null)).toBe(0);
    expect(visibleSheenHeight(rect, { top: NaN })).toBe(124);
  });
});

describe("E2E デバッグ情報", () => {
  it("初期状態は未発光", () => {
    expect(hintSheenDebug.plays).toBe(0);
    expect(hintSheenDebug.active).toBe(false);
    expect(hintSheenDebug.mode).toBeNull();
    expect(hintSheenDebug.cardId).toBeNull();
  });
});
