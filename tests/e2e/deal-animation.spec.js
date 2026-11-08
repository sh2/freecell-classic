import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

test.describe("配布アニメーション", () => {
  test("アニメーション有効で新しいゲームを開始すると配布が走り、全 52 枚が表示される", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.startGame(page, 2);
    await h.waitForDealStart(page);

    const during = await page.evaluate(() => ({
      stocks: document.querySelectorAll(".deal-stock, .deal-stock-card").length,
      clones: document.querySelectorAll("#anim-layer .card.deal-clone").length,
      faceUp: document.querySelectorAll("#anim-layer .deal-clone .corner").length,
      hidden: document.querySelectorAll("#game .card.anim-hidden").length,
      debug: JSON.parse(JSON.stringify(window.__dealDebug)),
    }));
    expect(during.stocks).toBe(0);
    expect(during.clones).toBeGreaterThan(0);
    expect(during.faceUp).toBeGreaterThan(0);
    expect(during.hidden).toBeGreaterThan(0);
    expect(during.debug.active).toBe(true);
    expect(during.debug.cardCount).toBe(52);

    await h.waitForDealEnd(page);

    const after = await page.evaluate(() => ({
      cards: document.querySelectorAll("#game .card").length,
      uniqueIds: new Set(
        [...document.querySelectorAll("#game .card")].map((el) => Number(el.dataset.cardId))
      ).size,
      hidden: document.querySelectorAll("#game .card.anim-hidden").length,
      stocks: document.querySelectorAll(".deal-stock, .deal-stock-card").length,
      clones: document.querySelectorAll("#anim-layer .deal-clone").length,
      debug: JSON.parse(JSON.stringify(window.__dealDebug)),
    }));
    expect(after.cards).toBe(52);
    expect(after.uniqueIds).toBe(52);
    expect(after.hidden).toBe(0);
    expect(after.stocks).toBe(0);
    expect(after.clones).toBe(0);
    expect(after.debug.active).toBe(false);
    expect(after.debug.skipped).toBe(false);
    expect(after.debug.dealtCount).toBe(52);
    expect(after.debug.durationMs).toBeLessThanOrEqual(950);
  });

  test("PC 幅では配布の起点がトップ行に収まり、どのカスケードカードとも重ならない", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.startGame(page, 9);
    await h.waitForDealStart(page);

    const geom = await page.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
      };
      // 最後に飛ぶクローンは、まだ起点で待機している
      const clones = [...document.querySelectorAll("#anim-layer .card.deal-clone")];
      const origin = box(clones[clones.length - 1]);
      const cardRects = [...document.querySelectorAll("#game .cascade .card")].map(box);
      const overlaps = cardRects.some(
        (b) =>
          origin.left < b.right &&
          origin.right > b.left &&
          origin.top < b.bottom &&
          origin.bottom > b.top
      );
      return {
        origin,
        topArea: box(document.querySelector(".top-area")),
        cascadeArea: box(document.getElementById("cascade-area")),
        freeArea: box(document.getElementById("free-cells")),
        homeArea: box(document.getElementById("home-cells")),
        stocks: document.querySelectorAll(".deal-stock, .deal-stock-card").length,
        overlaps,
      };
    });

    expect(geom.stocks).toBe(0);
    expect(Math.abs(geom.origin.top - geom.topArea.top)).toBeLessThanOrEqual(1);
    expect(geom.origin.bottom).toBeLessThanOrEqual(geom.cascadeArea.top + 1);
    expect(geom.overlaps).toBe(false);

    const gapCenter = (geom.freeArea.right + geom.homeArea.left) / 2;
    expect(Math.abs(geom.origin.left + geom.origin.width / 2 - gapCenter)).toBeLessThanOrEqual(1);
  });

  test("配布中のクリックで即座に配り終え、その入力はゲーム操作にならない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.startGame(page, 3);
    await h.waitForDealStart(page);

    const center = await h.gameCenter(page);
    await page.mouse.click(center.x, center.y);
    await h.waitForDealEnd(page);

    const debug = await h.dealDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.skipped).toBe(true);
    expect(debug.dealtCount).toBe(52);

    const state = await h.state(page);
    expect(state.moveCount).toBe(0);
    expect(state.historyLength).toBe(0);
    expect(state.selected).toBeNull();
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await page.locator(".deal-stock, .deal-stock-card").count()).toBe(0);
    expect(await page.locator("#game .card").count()).toBe(52);
  });

  test("配布中にキー入力しても即座に配り終え、ショートカットは動かない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.startGame(page, 4);
    await h.waitForDealStart(page);

    await page.keyboard.press("Control+z"); // アンドゥではなくスキップだけ
    await h.waitForDealEnd(page);

    const debug = await h.dealDebug(page);
    expect(debug.skipped).toBe(true);
    expect(debug.dealtCount).toBe(52);
    const state = await h.state(page);
    expect(state.moveCount).toBe(0);
    expect(state.historyLength).toBe(0);
  });

  test("animationsEnabled=false では起点も作らず即座に配置する", async ({ page }) => {
    await h.openGame(page, 7); // ヘルパーが animationsEnabled=false にしている
    const debug = await h.dealDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.dealtCount).toBe(52);
    expect(debug.cardCount).toBe(52);
    expect(debug.immediate).toBeGreaterThanOrEqual(1);
    expect(await page.locator(".deal-stock, .deal-stock-card").count()).toBe(0);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await page.locator("#game .card").count()).toBe(52);
    expect((await h.state(page)).moveCount).toBe(0);
  });

  test("SP 幅でも配布の起点と盤面が画面内に収まる", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await h.openGame(page, 5);
    await h.setAnimations(page, true);
    await h.startGame(page, 6);
    await h.waitForDealStart(page);

    const during = await page.evaluate(() => {
      const clones = [...document.querySelectorAll("#anim-layer .card.deal-clone")];
      const origin = clones[clones.length - 1].getBoundingClientRect();
      const game = document.getElementById("game").getBoundingClientRect();
      return {
        origin: { left: origin.left, right: origin.right, top: origin.top, width: origin.width },
        game: { left: game.left, right: game.right, width: game.width },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        stocks: document.querySelectorAll(".deal-stock, .deal-stock-card").length,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(during.stocks).toBe(0);
    expect(during.origin.width).toBeGreaterThan(0);
    expect(during.origin.left).toBeGreaterThanOrEqual(0);
    expect(during.origin.right).toBeLessThanOrEqual(during.viewport.width);
    expect(during.origin.top).toBeGreaterThanOrEqual(0);
    expect(during.scrollWidth).toBeLessThanOrEqual(during.viewport.width + 1);
    expect(during.origin.left).toBeGreaterThanOrEqual(during.game.left - 1);
    expect(during.origin.right).toBeLessThanOrEqual(during.game.right + 1);

    await h.waitForDealEnd(page);
    expect(await page.locator("#game .card").count()).toBe(52);
    expect(await page.locator(".deal-stock, .deal-stock-card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    );
    expect(overflow).toBe(true);
  });

  test("配布中のリサイズでも破綻せず全カードが表示される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.startGame(page, 8);
    await h.waitForDealStart(page);

    await page.setViewportSize({ width: 720, height: 820 });
    await h.waitForDealEnd(page);

    const debug = await h.dealDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.dealtCount).toBe(52);
    expect(await page.locator("#game .card").count()).toBe(52);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await page.locator(".deal-stock, .deal-stock-card").count()).toBe(0);
  });

  test("prefers-reduced-motion では配布アニメーションを走らせず即座に配置する", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    const before = await h.dealDebug(page);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches
      )
    ).toBe(true);

    await h.startGame(page, 2);

    const after = await h.dealDebug(page);
    expect(after.immediate).toBeGreaterThan(before.immediate);
    expect(after.active).toBe(false);
    expect(after.dealtCount).toBe(52);
    await expect(page.locator("#game .card")).toHaveCount(52);
    await expect(page.locator("#game .card.anim-hidden")).toHaveCount(0);
    await expect(page.locator("#anim-layer .card.deal-clone")).toHaveCount(0);
  });
});
