import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

/**
 * 発光要素の出現を MutationObserver で記録する。
 * 表示時間が短い静止光でも、要素が DOM に挿入された瞬間のクラスと
 * CSS アニメーション名を取りこぼさず検証できるようにする。
 */
async function startSheenProbe(page) {
  await page.evaluate(() => {
    window.__sheenProbe = [];
    window.__sheenSeen = new WeakSet();
    const record = (node) => {
      if (!node || node.nodeType !== 1) {
        return;
      }
      const els = [];
      if (node.classList && node.classList.contains("hint-sheen")) {
        els.push(node);
      }
      if (node.querySelectorAll) {
        node.querySelectorAll(".hint-sheen").forEach((el) => els.push(el));
      }
      for (const el of els) {
        if (window.__sheenSeen.has(el)) {
          continue;
        }
        window.__sheenSeen.add(el);
        const before = getComputedStyle(el, "::before");
        window.__sheenProbe.push({
          className: el.className,
          animation: before.animationName,
          animationDuration: before.animationDuration,
          left: Number.parseFloat(el.style.left),
          top: Number.parseFloat(el.style.top),
          width: Number.parseFloat(el.style.width),
          height: Number.parseFloat(el.style.height),
        });
      }
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          record(n);
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.__sheenMo = mo;
  });
}

/** 発光の出現記録を返す */
function sheenProbe(page) {
  return page.evaluate(() => window.__sheenProbe || []);
}

/** ヒントを押し、発光が始まるまで待つ */
async function requestHint(page) {
  const active = page.waitForFunction(
    () => window.__hintSheenDebug && window.__hintSheenDebug.active === true,
    undefined,
    { timeout: 10000 }
  );
  await page.click("#hint-btn");
  await active;
}

/** 発光が終わり、要素が片付くまで待つ */
async function waitForSheenGone(page, timeout = 2000) {
  await page.waitForFunction(
    () => !window.__hintSheenDebug || window.__hintSheenDebug.active === false,
    undefined,
    { timeout }
  );
  await expect(page.locator("#hint-sheen-layer .hint-sheen")).toHaveCount(0);
}

test.describe("ヒント時のカード発光", () => {
  test("ヒント表示で移動元カードにだけ帯が 1 回走る", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await h.setAnimations(page, true);
    await startSheenProbe(page);

    await requestHint(page);

    const info = await page.evaluate(() => {
      const src = document.querySelector("#game .card.hint-source");
      const target = document.querySelector("#game .card.hint-target");
      const sheen = document.querySelector("#hint-sheen-layer .hint-sheen");
      const srcRect = src.getBoundingClientRect();
      const sheenRect = sheen.getBoundingClientRect();
      return {
        debug: JSON.parse(JSON.stringify(window.__hintSheenDebug)),
        srcId: Number(src.dataset.cardId),
        targetId: target ? Number(target.dataset.cardId) : null,
        sheenCount: document.querySelectorAll("#hint-sheen-layer .hint-sheen").length,
        srcRect: { left: srcRect.left, top: srcRect.top, width: srcRect.width, height: srcRect.height },
        sheenRect: {
          left: sheenRect.left,
          top: sheenRect.top,
          width: sheenRect.width,
          height: sheenRect.height,
        },
      };
    });

    expect(info.debug.plays).toBe(1);
    expect(info.debug.mode).toBe("sweep");
    expect(info.debug.cardId).toBe(info.srcId);
    expect(info.sheenCount).toBe(1);

    // 発光要素は移動元カードの範囲と一致する(移動先には付かない)
    expect(info.sheenRect.left).toBeCloseTo(info.srcRect.left, 0);
    expect(info.sheenRect.top).toBeCloseTo(info.srcRect.top, 0);
    expect(info.sheenRect.width).toBeCloseTo(info.srcRect.width, 0);
    expect(info.sheenRect.height).toBeCloseTo(info.srcRect.height, 0);
    expect(info.targetId).not.toBe(info.debug.cardId);

    const probe = await sheenProbe(page);
    expect(probe).toHaveLength(1);
    expect(probe[0].className).toContain("hint-sheen--sweep");
    expect(probe[0].animation).toBe("hint-sheen-sweep");
    expect(Number.parseFloat(probe[0].animationDuration)).toBeLessThanOrEqual(900);
  });

  test("発光は 1 回で終わり、ヒントの枠は残る。再表示でまた 1 回だけ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await h.setAnimations(page, true);
    await startSheenProbe(page);

    await requestHint(page);
    await waitForSheenGone(page);
    await page.waitForTimeout(400);

    const after = await h.hintSheenDebug(page);
    expect(after.plays).toBe(1);
    expect(after.active).toBe(false);
    expect(await page.locator("#hint-sheen-layer .hint-sheen").count()).toBe(0);
    // 枠表示は従来どおり残る
    await expect(page.locator("#game .card.hint-source")).toBeVisible();

    await requestHint(page);
    const second = await h.hintSheenDebug(page);
    expect(second.plays).toBe(2);
    expect((await sheenProbe(page)).length).toBe(2);
  });

  test("reduced-motion では帯を走らせず静止光を添える", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    // in-game 設定は有効にしても reduced-motion が優先される
    await h.setAnimations(page, true);
    await startSheenProbe(page);

    await requestHint(page);

    const debug = await h.hintSheenDebug(page);
    const probe = await sheenProbe(page);
    expect(debug.mode).toBe("still");
    expect(probe).toHaveLength(1);
    expect(probe[0].className).toContain("hint-sheen--still");
    expect(probe[0].animation).toBe("none");

    await waitForSheenGone(page);
  });

  test("ゲーム内アニメーション無効でも帯を走らせず静止光を添える", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await h.setAnimations(page, false);
    await startSheenProbe(page);

    await requestHint(page);

    const debug = await h.hintSheenDebug(page);
    const probe = await sheenProbe(page);
    expect(debug.mode).toBe("still");
    expect(probe).toHaveLength(1);
    expect(probe[0].className).toContain("hint-sheen--still");
    expect(probe[0].animation).toBe("none");
  });

  test("発光中でもドラッグでき、発光はドラッグレイヤーに残らない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await h.setAnimations(page, true);

    await requestHint(page);
    const point = await h.clickPoint(page, 51); // フリーセルの ♠K
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 40, point.y, { steps: 5 });

    await page.waitForFunction(
      () => document.querySelectorAll("#hint-sheen-layer .hint-sheen").length === 0,
      undefined,
      { timeout: 1000 }
    );
    const during = await page.evaluate(() => ({
      dragCards: document.querySelectorAll("#drag-layer .card").length,
      sheenInDrag: document.querySelectorAll("#drag-layer .hint-sheen").length,
      active: window.__hintSheenDebug.active,
    }));
    expect(during.dragCards).toBe(1);
    expect(during.sheenInDrag).toBe(0);
    expect(during.active).toBe(false);

    const to = await h.slotPoint(page, "home", 3);
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await h.waitForAnimationsDone(page);

    const state = await h.state(page);
    expect(state.foundations[3]).toHaveLength(13);
    expect(state.won).toBe(true);
    expect(await page.locator("#hint-sheen-layer .hint-sheen").count()).toBe(0);
  });

  test("ヒントが移動元カードを持たないときは発光しない", async ({ page }) => {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class NoSolutionWorker {
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
                  solved: false,
                  status: "unsolved",
                  moves: [],
                  nodes: 10,
                  timeMs: 5,
                  totalNodes: 10,
                  totalTimeMs: 5,
                  finalMode: "safe",
                  strategy: "fast-safe",
                  fallbackUsed: true,
                  attempts: {},
                },
              },
            });
          }, 10);
        }

        terminate() {
          this.terminated = true;
        }
      };
      void NativeWorker;
    });

    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await h.setAnimations(page, true);
    await startSheenProbe(page);

    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("探索上限内では解答を発見できませんでした", {
      timeout: 2000,
    });

    const debug = await h.hintSheenDebug(page);
    expect(debug.plays).toBe(0);
    expect(debug.active).toBe(false);
    expect(await page.locator("#hint-sheen-layer .hint-sheen").count()).toBe(0);
    expect(await sheenProbe(page)).toHaveLength(0);
  });
});
