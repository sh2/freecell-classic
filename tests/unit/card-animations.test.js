import { describe, expect, it } from "vitest";
import { createCardAnimations } from "../../src/js/card-animations.js";

/**
 * カード移動アニメーションのペーシング (card-animations.js) の単体テスト。
 * アニメーション無効時は DOM を触らず、予約済みステップの本来の飛行時間を
 * タイマーで代替する。タイマーは fake に差し替えて決定的に検証する。
 */

/** 差し替え可能な setTimeout / clearTimeout。advance() で時間を進める */
function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeoutFn(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!next || timer.at < next.timer.at)) {
            next = { id, timer };
          }
        }
        if (!next) {
          break;
        }
        timers.delete(next.id);
        now = next.timer.at;
        next.timer.fn();
      }
      now = target;
    },
    pendingCount() {
      return timers.size;
    },
  };
}

/** 位置だけを持つカード要素の fake。render 後の位置へ動かして使う */
function cardAt(left, top) {
  return {
    left,
    top,
    getBoundingClientRect() {
      return { left: this.left, top: this.top, width: 88, height: 124 };
    },
  };
}

/** アニメーション無効・位置取得だけができる cardAnimations を生成する */
function setup(cards) {
  const timers = createFakeTimers();
  const anims = createCardAnimations({
    cardElById: (id) => cards.get(id) ?? null,
    getDragLayer: () => null,
    prefersReducedMotion: () => true,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  anims.setEnabled(false);
  return { anims, timers };
}

/** 移動前の矩形(ready は render 後の DOM 位置) */
function originRect(card) {
  return { left: card.left, top: card.top, width: 88, height: 124 };
}

describe("card-animations: 飛行しない段のペーシング", () => {
  it("pace 指定の段は本来の飛行時間(距離×0.45、150〜400ms)だけ待つ", () => {
    const card = cardAt(0, 0);
    const { anims, timers } = setup(new Map([[1, card]]));
    const origins = { 1: originRect(card) };
    card.left = 1000; // 移動後は clamp 上限の 400ms
    anims.setNextRenderAnimation([{ cardIds: [1], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("landing"));
    anims.runAfterAnimations(() => calls.push("chain"));

    // 同一段内のコールバックは登録順に、ウェイト後にまとめて呼ばれる
    expect(calls).toEqual([]);
    timers.advance(399);
    expect(calls).toEqual([]);
    timers.advance(1);
    expect(calls).toEqual(["landing", "chain"]);
  });

  it("距離が近い段は同じ式で 150ms になる", () => {
    const card = cardAt(0, 0);
    const { anims, timers } = setup(new Map([[1, card]]));
    const origins = { 1: originRect(card) };
    card.top = 100; // 100px → 45ms → 下限 150ms
    anims.setNextRenderAnimation([{ cardIds: [1], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    timers.advance(149);
    expect(calls).toEqual([]);
    timers.advance(1);
    expect(calls).toEqual(["chain"]);
  });

  it("複数枚の段はグループ内の最大飛行時間を待つ", () => {
    const far = cardAt(0, 0);
    const near = cardAt(0, 0);
    const { anims, timers } = setup(
      new Map([
        [1, far],
        [2, near],
      ])
    );
    const origins = { 1: originRect(far), 2: originRect(near) };
    far.left = 1000; // 400ms
    near.left = 100; // 150ms
    anims.setNextRenderAnimation([{ cardIds: [1, 2], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    timers.advance(399);
    expect(calls).toEqual([]);
    timers.advance(1);
    expect(calls).toEqual(["chain"]);
  });

  it("pace 指定がなければ即座に呼ぶ(単発の手動移動)", () => {
    const { anims } = setup(new Map());
    anims.setNextRenderAnimation([], { pace: false });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    expect(calls).toEqual(["chain"]);
  });

  it("再描画によるキャンセル(cancelActiveFlight)でウェイト中のコールバックを破棄する", () => {
    const card = cardAt(0, 0);
    const { anims, timers } = setup(new Map([[1, card]]));
    const origins = { 1: originRect(card) };
    card.left = 1000;
    anims.setNextRenderAnimation([{ cardIds: [1], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    anims.cancelActiveFlight();
    expect(timers.pendingCount()).toBe(0);
    timers.advance(1000);
    expect(calls).toEqual([]);
  });

  it("cancelPendingWait はウェイトとコールバックだけを破棄する", () => {
    const card = cardAt(0, 0);
    const { anims, timers } = setup(new Map([[1, card]]));
    const origins = { 1: originRect(card) };
    card.left = 1000;
    anims.setNextRenderAnimation([{ cardIds: [1], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    anims.cancelPendingWait();
    expect(timers.pendingCount()).toBe(0);
    timers.advance(1000);
    expect(calls).toEqual([]);
  });

  it("アニメーション無効化(setEnabled(false))でもウェイトを破棄する", () => {
    const card = cardAt(0, 0);
    const { anims, timers } = setup(new Map([[1, card]]));
    const origins = { 1: originRect(card) };
    card.left = 1000;
    anims.setNextRenderAnimation([{ cardIds: [1], origins }], { pace: true });
    anims.playArmedAnimations();

    const calls = [];
    anims.runAfterAnimations(() => calls.push("chain"));
    anims.setEnabled(false);
    expect(timers.pendingCount()).toBe(0);
    timers.advance(1000);
    expect(calls).toEqual([]);
  });
});
