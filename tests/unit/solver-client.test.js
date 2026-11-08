import { describe, expect, it } from "vitest";
import {
  REPLAY_HOME_WAIT_MS,
  REPLAY_WAIT_MS,
  replayWaitMs,
} from "../../src/js/solver-client.js";

/**
 * 自動解答の再生待ち時間 (solver-client.js) の単体テスト。
 * 待ちは「直前に再生した手」の destZone で決まる。
 */

/** 解答手 fixture(solver の出力形式のうち待ち時間の決定に使う項目のみ) */
function move(destZone) {
  return { cardId: 0, destZone, destIndex: 0, count: 1 };
}

describe("replayWaitMs", () => {
  it("ホーム行きの手の直後は待ちゼロ", () => {
    expect(replayWaitMs(move("home"))).toBe(0);
    expect(REPLAY_HOME_WAIT_MS).toBe(0);
  });

  it("ホーム行き以外(列移動・フリーセル)の直後は 250ms", () => {
    expect(replayWaitMs(move("cascade"))).toBe(250);
    expect(replayWaitMs(move("free"))).toBe(250);
    expect(REPLAY_WAIT_MS).toBe(250);
  });

  it("再生の先頭(直前の手がない)は待たない", () => {
    expect(replayWaitMs(null)).toBe(0);
    expect(replayWaitMs(undefined)).toBe(0);
  });

  it("定数どおりの値で、ホーム行きの待ちはホーム以外より短い", () => {
    expect(replayWaitMs(move("home"))).toBe(REPLAY_HOME_WAIT_MS);
    expect(replayWaitMs(move("cascade"))).toBe(REPLAY_WAIT_MS);
    expect(REPLAY_HOME_WAIT_MS).toBeLessThan(REPLAY_WAIT_MS);
  });
});
