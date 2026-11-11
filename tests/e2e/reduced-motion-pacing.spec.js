import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";

const h = state;

/**
 * reduced-motion などで飛行アニメーションが走らないときのペーシング。
 * page.clock でタイマーを制御し、本来の飛行時間ぶん間隔が空くことを検証する。
 */

/** カードの現在の矩形(左上) */
function cardRect(page, cardId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`#game .card[data-card-id="${id}"]`);
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }, cardId);
}

/** flightDuration(dist) と同じ式(距離×0.45、150〜400ms) */
function flightMs(from, to) {
  const dist = Math.hypot(to.left - from.left, to.top - from.top);
  return Math.min(400, Math.max(150, Math.round(dist * 0.45)));
}

function moveCount(page) {
  return page.evaluate(() => window.__testApi.snapshot().moveCount);
}

function animationPending(page) {
  return page.evaluate(() => Boolean(window.__animDebug && window.__animDebug.pending));
}

/** AC, 2C, 3C を順に自動移動できる盤面(3 段の連鎖) */
function autoChainBoard() {
  return {
    cascades: [[8, 4, 0], [], [], [], [], [], [], []], // 3C, 2C, AC
    freeCells: [],
    foundations: [[], [1, 5], [2, 6], [3, 7]],
  };
}

test.describe("reduced-motion 時の自動送りペーシング", () => {
  test("自動送り連鎖の各段は本来の飛行時間ぶん空く", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // ヘルパーによる強制無効化は行わず、OS 設定だけで飛行が止まることを使う
    await h.openGame(page, 1, { disableAnimations: false });
    await h.setBoard(page, autoChainBoard());
    expect(
      await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
    ).toBe(true);
    const originAc = await cardRect(page, 0);
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));

    await page.click("#auto-move-btn");
    // 最初の段は同期的に着地し、その後の段はウェイトで間隔が空く
    expect(await moveCount(page)).toBe(1);
    expect(await animationPending(page)).toBe(true);

    // 1 段目: AC の移動前後距離から本来の飛行時間を求め、境界を検証する
    const wait1 = flightMs(originAc, await cardRect(page, 0));
    const origin2c = await cardRect(page, 4);
    await page.clock.runFor(wait1 - 1);
    expect(await moveCount(page)).toBe(1);
    await page.clock.runFor(1);
    expect(await moveCount(page)).toBe(2);

    // 2 段目: 2C
    const wait2 = flightMs(origin2c, await cardRect(page, 4));
    const origin3c = await cardRect(page, 8);
    await page.clock.runFor(wait2 - 1);
    expect(await moveCount(page)).toBe(2);
    await page.clock.runFor(1);
    expect(await moveCount(page)).toBe(3);

    // 3 段目: 3C。最後の段もウェイトしてから連鎖を終える
    const wait3 = flightMs(origin3c, await cardRect(page, 8));
    await page.clock.runFor(wait3 - 1);
    expect(await moveCount(page)).toBe(3);
    expect(await animationPending(page)).toBe(true);
    await page.clock.runFor(1);
    expect(await animationPending(page)).toBe(false);
  });

  test("飛行が走る通常環境ではウェイトを足さない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.setBoard(page, autoChainBoard());

    await page.click("#auto-move-btn");
    await h.waitForAnimationsDone(page);
    expect(await moveCount(page)).toBe(3);
    // 飛行完了後にコールバックが呼ばれ、ペーシングのウェイトは開始されない
    expect(await page.evaluate(() => window.__animDebug.paceCount)).toBe(0);
  });

  test("連鎖中に新規ゲームを始めると保留コールバックが盤面を動かさない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, autoChainBoard());
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));

    await page.click("#auto-move-btn");
    expect(await moveCount(page)).toBe(1);
    expect(await animationPending(page)).toBe(true);

    // ウェイト中に新規ゲームを開始する(再描画で保留コールバックを破棄)
    await page.evaluate(() => window.__testApi.startGame(99));
    expect(await animationPending(page)).toBe(false);
    await page.clock.runFor(10000);

    const s = await h.state(page);
    expect(s.gameNumber).toBe(99);
    expect(s.moveCount).toBe(0);
    expect(s.foundations.every((pile) => pile.length === 0)).toBe(true);
  });
});

test.describe("reduced-motion 時の自動解答ペーシング", () => {
  /** 自動解答の手順を固定する Worker。時計を止めた状態でも結果を返す */
  async function installReplayWorker(page, moves) {
    await page.addInitScript((replayMoves) => {
      window.Worker = class MockSolverWorker {
        constructor() {
          this.onmessage = null;
          this.onerror = null;
          this.terminated = false;
        }
        postMessage(message) {
          setTimeout(() => {
            if (this.terminated) {
              return;
            }
            this.onmessage?.({
              data: {
                type: "result",
                requestId: message.requestId,
                result: {
                  solved: true,
                  status: "solved",
                  moves: replayMoves,
                  nodes: replayMoves.length,
                  timeMs: 1,
                  totalNodes: replayMoves.length,
                  totalTimeMs: 1,
                  finalMode: "fast",
                  strategy: "fast-safe",
                  fallbackUsed: false,
                  attempts: {},
                },
              },
            });
          }, 0);
        }
        terminate() {
          this.terminated = true;
        }
      };
    }, moves);
  }

  /** 自動解答で「ホーム以外 → ホーム(非勝利) → ホーム(非勝利)」と進む盤面。
   *  ♠ は A〜10 までホーム、K は列、J/Q はフリーセル。 */
  function replayBoard() {
    const pile = (suit) => Array.from({ length: 13 }, (_, r) => r * 4 + suit);
    return {
      cascades: [[51], [], [], [], [], [], [], []], // ♠K
      freeCells: [null, null, 43, 47], // ♠J, ♠Q
      foundations: [pile(0), pile(1), pile(2), pile(3).slice(0, 10)], // ♠A〜10
    };
  }

  test("再生間隔は本来の飛行時間 + 既存ウェイト(250ms / 0ms)", async ({ page }) => {
    await installReplayWorker(page, [
      { cardId: 47, count: 1, destZone: "free", destIndex: 0 }, // ホーム以外(+250)
      { cardId: 43, count: 1, destZone: "home", destIndex: 3 }, // ホーム(+0)
      { cardId: 47, count: 1, destZone: "home", destIndex: 3 }, // ホーム(+0)
    ]);
    await h.openGame(page, 1); // アニメーション無効
    await h.setBoard(page, replayBoard());
    const originQ = await cardRect(page, 47);
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));

    await page.locator("#auto-solve-toggle").check();
    await page.clock.runFor(0); // Worker の結果を受けて 1 手目を適用
    expect(await moveCount(page)).toBe(1);
    expect(await animationPending(page)).toBe(true);

    // 1 手目はホーム以外: 飛行時間 + 250ms 後に 2 手目
    const wait1 = flightMs(originQ, await cardRect(page, 47));
    const originJ = await cardRect(page, 43);
    const gap1 = wait1 + 250;
    await page.clock.runFor(gap1 - 1);
    expect(await moveCount(page)).toBe(1);
    await page.clock.runFor(1);
    expect(await moveCount(page)).toBe(2);

    // 2 手目はホーム: 飛行時間 + 0ms 後に 3 手目
    const wait2 = flightMs(originJ, await cardRect(page, 43));
    const originQ2 = await cardRect(page, 47);
    await page.clock.runFor(wait2 - 1);
    expect(await moveCount(page)).toBe(2);
    await page.clock.runFor(1);
    expect(await moveCount(page)).toBe(3);

    // 3 手目も終了まで本来の飛行時間を待つ
    const wait3 = flightMs(originQ2, await cardRect(page, 47));
    await page.clock.runFor(wait3 - 1);
    expect(await page.locator("#auto-solve-toggle").isChecked()).toBe(true);
    await page.clock.runFor(1);
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
  });

  test("再生中にトグルOFFすると保留中のウェイトが盤面を動かさない", async ({ page }) => {
    await installReplayWorker(page, [
      { cardId: 47, count: 1, destZone: "free", destIndex: 0 },
      { cardId: 43, count: 1, destZone: "home", destIndex: 3 },
    ]);
    await h.openGame(page, 1);
    await h.setBoard(page, replayBoard());
    await page.clock.install();
    await page.clock.pauseAt(await page.evaluate(() => Date.now()));

    await page.locator("#auto-solve-toggle").check();
    await page.clock.runFor(1);
    expect(await moveCount(page)).toBe(1);

    // ウェイト中に OFF → 保留コールバックを破棄
    await page.locator("#auto-solve-toggle").uncheck();
    expect(await animationPending(page)).toBe(false);
    await page.clock.runFor(10000);

    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.foundations[3]).toHaveLength(10); // ♠J はまだホームへ行かない
    expect(s.freeCells[2]).toBe(43);
    expect(s.freeCells[0]).toBe(47);
  });
});

test.describe("reduced-motion 時の配布", () => {
  test("配布は従来どおり即配置のまま(ペーシング対象外)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1, { disableAnimations: false });
    // 配布クローンは作られず、全カードが即座に盤面へ出ている
    await expect(page.locator("#anim-layer .deal-clone")).toHaveCount(0);
    const s = await h.state(page);
    expect(s.cascades.flat()).toHaveLength(52);
  });
});
