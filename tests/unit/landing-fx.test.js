import { describe, expect, it } from "vitest";
import {
  MAX_SHARD_BURSTS,
  SHARD_BLACK,
  SHARD_COUNT,
  SHARD_DURATION_MS,
  SHARD_LENGTH,
  SHARD_RED,
  SHARD_SPEED_MAX,
  SHARD_SPEED_MIN,
  SHARD_WIDTH,
  SLOT_GLOW_DURATION_MS,
  SNAP_DURATION_MS,
  SNAP_EASING,
  SNAP_SCALE_START,
  createShards,
  extraEffectFor,
  isRedSuit,
  shardAlphaAt,
  shardColorForSuit,
} from "../../src/js/landing-fx.js";

describe("セル着地エフェクトの調整用定数", () => {
  it("スナップは scale 1.07 → 1 を 170ms で収める", () => {
    expect(SNAP_SCALE_START).toBe(1.07);
    expect(SNAP_DURATION_MS).toBe(170);
    expect(SNAP_EASING).toBe("cubic-bezier(0.34, 1.45, 0.64, 1)");
    expect(SLOT_GLOW_DURATION_MS).toBe(260);
  });

  it("小破裂は 14 本・0.26 秒・速度 130〜260px/s・太さ 2.5px", () => {
    expect(SHARD_COUNT).toBe(14);
    expect(SHARD_DURATION_MS).toBe(260);
    expect(SHARD_SPEED_MIN).toBe(130);
    expect(SHARD_SPEED_MAX).toBe(260);
    expect(SHARD_WIDTH).toBe(2.5);
    expect(SHARD_LENGTH).toBeGreaterThan(0);
    expect(MAX_SHARD_BURSTS).toBe(3);
  });

  it("小破裂の色は赤 #ff7a72 / 黒 #9fd8ff", () => {
    expect(SHARD_RED).toBe("#ff7a72");
    expect(SHARD_BLACK).toBe("#9fd8ff");
  });
});

describe("行き先別の配分", () => {
  it("フリーセルは追加効果なし、ホームはランクを問わず burst", () => {
    expect(extraEffectFor("free")).toBeNull();
    expect(extraEffectFor("cascade")).toBeNull();
    expect(extraEffectFor("home")).toBe("burst");
  });

  it("赤スートは ♦/♥ だけ", () => {
    expect(isRedSuit(0)).toBe(false); // ♣
    expect(isRedSuit(1)).toBe(true); // ♦
    expect(isRedSuit(2)).toBe(true); // ♥
    expect(isRedSuit(3)).toBe(false); // ♠
  });

  it("スート色を小破裂に使う", () => {
    expect(shardColorForSuit(1)).toBe(SHARD_RED);
    expect(shardColorForSuit(2)).toBe(SHARD_RED);
    expect(shardColorForSuit(0)).toBe(SHARD_BLACK);
    expect(shardColorForSuit(3)).toBe(SHARD_BLACK);
  });
});

describe("小破裂の破片", () => {
  /** 呼ぶたびに values を順に返す決定的な乱数 */
  function sequence(values) {
    let i = 0;
    return () => values[i++ % values.length];
  }

  it("14 本を放射状に、速度 130〜260px/s の範囲で作る", () => {
    const shards = createShards(sequence([0, 0, 0.25, 0.5, 0.5, 1, 0.75, 0.25]));
    expect(shards).toHaveLength(SHARD_COUNT);
    for (const shard of shards) {
      expect(shard.angle).toBeGreaterThanOrEqual(0);
      expect(shard.angle).toBeLessThanOrEqual(Math.PI * 2);
      expect(shard.speed).toBeGreaterThanOrEqual(SHARD_SPEED_MIN);
      expect(shard.speed).toBeLessThanOrEqual(SHARD_SPEED_MAX);
    }
    // 固定乱数では最小値・最大値を含む
    expect(shards[0]).toEqual({ angle: 0, speed: SHARD_SPEED_MIN });
    expect(shards[1]).toEqual({ angle: Math.PI / 2, speed: (SHARD_SPEED_MIN + SHARD_SPEED_MAX) / 2 });
  });

  it("進行度に応じて不透明度が 1 → 0 に下がる", () => {
    expect(shardAlphaAt(0)).toBe(1);
    expect(shardAlphaAt(0.5)).toBeCloseTo(0.5, 5);
    expect(shardAlphaAt(1)).toBe(0);
    expect(shardAlphaAt(-1)).toBe(1);
    expect(shardAlphaAt(2)).toBe(0);
  });
});
