import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSolverClient,
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

describe("自動解答の飛行待ち", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function replayFixture() {
    vi.useFakeTimers();
    vi.stubGlobal("document", { getElementById: () => null });
    const workers = [];
    vi.stubGlobal("Worker", class {
      constructor() {
        workers.push(this);
      }
      postMessage(message) {
        this.requestId = message.requestId;
      }
      terminate() {}
    });
    const card = { id: 51, suit: 3, rank: 13 };
    const state = {
      cascades: Array.from({ length: 8 }, () => []),
      freeCells: [card, null, null, null],
      foundations: Array.from({ length: 4 }, () => []),
      won: false,
    };
    const app = {
      getState: () => state,
      getAutoMoveEnabled: () => true,
      setAutoMoveEnabled: vi.fn(),
      setAutoSolving: vi.fn(),
      applyMoveAnimated: vi.fn((loc, zone, index) => {
        const moved = state.freeCells[loc.index];
        state.freeCells[loc.index] = null;
        state.freeCells[index] = moved;
        return { ok: true };
      }),
    };
    const callbacks = [];
    const view = {
      setSolverBusy: vi.fn(),
      setSolverStage: vi.fn(),
      showToast: vi.fn(),
      runAfterAnimations: (callback) => callbacks.push(callback),
    };
    const client = createSolverClient({ app, view });
    const moves = [
      { cardId: 51, count: 1, destZone: "free", destIndex: 2 },
      { cardId: 51, count: 1, destZone: "free", destIndex: 0 },
    ];
    function start() {
      client.requestSolution({ autoPlay: true });
      const worker = workers.at(-1);
      worker.onmessage({ data: { type: "result", requestId: worker.requestId, result: { solved: true, moves } } });
    }
    return { app, callbacks, client, start, state };
  }

  it("飛行中は待機し、複数登録された完了通知から次の手を一度だけ適用する", () => {
    const { app, callbacks, start } = replayFixture();
    start();
    vi.advanceTimersByTime(750);
    expect(app.applyMoveAnimated).toHaveBeenCalledTimes(1);
    expect(callbacks).toHaveLength(4);
    for (const callback of callbacks.splice(0)) {
      callback();
    }
    vi.advanceTimersByTime(REPLAY_WAIT_MS);
    expect(app.applyMoveAnimated).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(app.applyMoveAnimated).toHaveBeenCalledTimes(2);
  });

  it("中断後の古い完了通知は次の再生に干渉しない", () => {
    const { app, callbacks, client, start } = replayFixture();
    start();
    const oldCallback = callbacks[0];
    client.cancelAutoSolve();
    expect(app.setAutoMoveEnabled).toHaveBeenLastCalledWith(true);
    // 新しい解答の最初の手は中断時の盤面から元のセルに戻す。
    client.requestSolution({ autoPlay: true });
    oldCallback();
    vi.advanceTimersByTime(REPLAY_WAIT_MS);
    expect(app.applyMoveAnimated).toHaveBeenCalledTimes(2);
    expect(client.isAutoSolving()).toBe(true);
    client.cancelAutoSolve();
    vi.advanceTimersByTime(1000);
    expect(app.applyMoveAnimated).toHaveBeenCalledTimes(2);
  });
});
