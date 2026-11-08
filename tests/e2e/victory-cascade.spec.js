import { test, expect } from "@playwright/test";
import * as h from "./helpers.js";

/** 盤面中央の座標 */
async function gameCenter(page) {
  const box = await page.locator("#game").boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** 勝利盤面にしてカスケードを開始する(アニメーション有効) */
async function startVictory(page) {
  await h.openGame(page, 1);
  await h.setAnimations(page, true);
  await h.setWinBoard(page);
  await h.waitForVictoryStart(page);
}

/** オーバーレイの背景クリックで閉じ、カスケード画像の片付けを待つ */
async function closeOverlayByBackdrop(page) {
  await page.click("#overlay", { position: { x: 10, y: 10 } });
  await h.waitForVictoryVisualsCleared(page);
}

test.describe("勝利時カスケード", () => {
  test("勝利直後に 1 回だけ発火し、ホーム山が減り、スタンプが蓄積する", async ({ page }) => {
    await startVictory(page);

    const atStart = await page.evaluate(() => ({
      overlayHidden: document.getElementById("overlay").classList.contains("hidden"),
      fires: window.__victoryDebug.fires,
      active: window.__victoryDebug.active,
      stampCanvases: document.querySelectorAll("#stamp-canvas").length,
      stampZ: Number(getComputedStyle(document.getElementById("stamp-canvas")).zIndex),
      animZ: Number(getComputedStyle(document.getElementById("anim-layer")).zIndex),
    }));
    expect(atStart.active).toBe(true);
    expect(atStart.fires).toBe(1);
    expect(atStart.overlayHidden).toBe(true);
    expect(atStart.stampCanvases).toBe(1);
    expect(atStart.stampZ).toBeLessThan(atStart.animZ);

    await page.waitForFunction(() => window.__victoryDebug.released >= 8, undefined, {
      timeout: 5000,
    });

    const during = await page.evaluate(() => ({
      debug: JSON.parse(JSON.stringify(window.__victoryDebug)),
      hiddenHome: document.querySelectorAll("#home-cells .card.anim-hidden").length,
      visibleHome: document.querySelectorAll("#home-cells .card:not(.anim-hidden)").length,
      overlayHidden: document.getElementById("overlay").classList.contains("hidden"),
      canvases: document.querySelectorAll("canvas").length,
      clones: document.querySelectorAll("#anim-layer .card").length,
    }));
    expect(during.debug.released).toBeGreaterThanOrEqual(8);
    expect(during.hiddenHome).toBe(during.debug.released);
    expect(during.visibleHome).toBe(52 - during.debug.released);
    expect(during.overlayHidden).toBe(true);
    expect(during.clones).toBeGreaterThanOrEqual(during.debug.released);
    // スタンプ用の DOM 要素は #stamp-canvas だけ (#fx-canvas / #landing-fx-canvas は既存)
    expect(during.canvases).toBe(3);
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);

    // Escape でスキップし、その入力がゲーム操作にならない
    await page.keyboard.press("Escape");
    await h.waitForVictoryEnd(page);

    const after = await h.victoryDebug(page);
    expect(after.active).toBe(false);
    expect(after.skipped).toBe(true);
    expect(after.fires).toBe(1);
    expect(after.visualsRemaining).toBe(true);
    expect(after.cleared).toBe(false);
    expect(await h.overlayVisible(page)).toBe(true);
    // モーダルの背後には、スキップした時点の画像が残っている
    expect(await page.locator("#anim-layer .card").count()).toBeGreaterThan(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);

    // モーダルを閉じたタイミングで片付く
    await closeOverlayByBackdrop(page);
    const cleared = await h.victoryDebug(page);
    expect(cleared.visualsRemaining).toBe(false);
    expect(cleared.cleared).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await page.locator("#home-cells .card").count()).toBe(52);

    const state = await h.state(page);
    expect(state.moveCount).toBe(52);
    expect(state.historyLength).toBe(0);
    expect(state.selected).toBeNull();
  });

  test("通常の手で勝利してもカスケードが発火し、オーバーレイは完了後", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    const foundations = [];
    for (let suit = 0; suit < 4; suit++) {
      const pile = [];
      const maxRank = suit === 3 ? 12 : 13;
      for (let rank = 1; rank <= maxRank; rank++) {
        pile.push((rank - 1) * 4 + suit);
      }
      foundations.push(pile);
    }
    // あと 1 手 (K♠) で勝利する盤面
    await h.setBoard(page, {
      cascades: [[51]],
      freeCells: [null, null, null, null],
      foundations,
      moveCount: 0,
    });
    await h.dblClickCard(page, 51);
    await h.waitForVictoryStart(page);

    const debug = await h.victoryDebug(page);
    expect(debug.fires).toBe(1);
    expect(debug.active).toBe(true);
    expect(await h.overlayVisible(page)).toBe(false);
    const state = await h.state(page);
    expect(state.won).toBe(true);
    expect(state.moveCount).toBe(1);
    expect(state.historyLength).toBe(1);

    await page.keyboard.press("Escape");
    await h.waitForVictoryEnd(page);
    expect(await h.overlayVisible(page)).toBe(true);
    expect((await h.victoryDebug(page)).visualsRemaining).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBeGreaterThan(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);

    // 新しいゲームでモーダルを閉じても片付けが漏れない
    await page.click("#overlay-new-game");
    await h.waitForDealEnd(page);
    const cleared = await h.victoryDebug(page);
    expect(cleared.visualsRemaining).toBe(false);
    expect(cleared.cleared).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await h.overlayVisible(page)).toBe(false);
    expect((await h.state(page)).won).toBe(false);
  });

  test("カスケード中のクリックで即座に終了＋オーバーレイ表示され、操作にならない", async ({
    page,
  }) => {
    await startVictory(page);
    await page.waitForFunction(() => window.__victoryDebug.released >= 3, undefined, {
      timeout: 5000,
    });
    const center = await gameCenter(page);
    await page.mouse.click(center.x, center.y);
    await h.waitForVictoryEnd(page);

    const debug = await h.victoryDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.skipped).toBe(true);
    expect(debug.released).toBeLessThan(52);
    expect(debug.visualsRemaining).toBe(true);
    expect(await h.overlayVisible(page)).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBeGreaterThan(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);

    await closeOverlayByBackdrop(page);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);

    const state = await h.state(page);
    expect(state.moveCount).toBe(52);
    expect(state.historyLength).toBe(0);
    expect(state.selected).toBeNull();
  });

  test("全カードが床に触れた 1 秒後に仕上げ花火が始まり、20 発すべて上がって完了する", async ({
    page,
  }) => {
    // 完了まで待つので長めのタイムアウトを使う
    test.setTimeout(60000);
    await startVictory(page);

    await h.waitForVictoryFireworks(page);

    const atFireworks = await h.victoryDebug(page);
    expect(atFireworks.released).toBe(52);
    expect(atFireworks.floorTouches).toBe(52);
    expect(atFireworks.fireworks).toBe(20);
    // 花火中もまだオーバーレイは出ていない
    expect(await h.overlayVisible(page)).toBe(false);

    // 発ごとの記録から、倍率の並び・粒数・間隔・最終発の位置を確認する
    const log = atFireworks.fireworksLog;
    expect(log).toHaveLength(20);
    expect(log.map((fire) => fire.sizeMultiplier)).toEqual([
      1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4,
      1.0, 1.4, 2.0,
    ]);
    expect(log.map((fire) => fire.particleCount)).toEqual(
      log.map((fire) => Math.round(96 * fire.sizeMultiplier ** 2))
    );
    expect(
      log.filter((fire) => fire.sizeMultiplier === 1.0).every((fire) => fire.particleCount === 96)
    ).toBe(true);
    expect(
      log.filter((fire) => fire.sizeMultiplier === 1.4).every((fire) => fire.particleCount === 188)
    ).toBe(true);
    expect(log[19].particleCount).toBe(384);

    // 19発目→20発目だけ約1,000ms、他は約190ms
    const intervals = log.slice(1).map((fire, index) => fire.firedAt - log[index].firedAt);
    expect(intervals).toHaveLength(19);
    for (let i = 0; i < intervals.length - 1; i++) {
      expect(intervals[i]).toBeGreaterThanOrEqual(120);
      expect(intervals[i]).toBeLessThanOrEqual(600);
    }
    expect(intervals[18]).toBeGreaterThanOrEqual(900);
    expect(intervals[18]).toBeLessThanOrEqual(1600);

    // 最終発は盤面の左右中央・上端から高さ35%
    const gameBox = await page.locator("#game").boundingBox();
    const final = log[19];
    expect(Math.abs(final.x - (gameBox.x + gameBox.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(final.y - (gameBox.y + gameBox.height * 0.35))).toBeLessThanOrEqual(1);

    // 倍率 2.0 は広がりにだけ掛かり、粒の大きさ用 scale は標準と同じ
    const fxScales = await page.evaluate(() => ({
      particle: window.__fxDebug.lastParticleScale,
      spread: window.__fxDebug.lastSpreadScale,
    }));
    expect(fxScales.particle).toBeGreaterThan(0);
    expect(fxScales.spread).toBeCloseTo(fxScales.particle * 2, 5);

    await h.waitForVictoryEnd(page);
    const after = await h.victoryDebug(page);
    expect(after.fires).toBe(1); // 繰り返し発火しない
    expect(after.completed).toBe(1);
    expect(after.skipped).toBe(false);
    expect(after.fireworks).toBe(20);
    // 既存 fx の同時上限 MAX_BURSTS=3 では落ちる発数。20 発すべて記録される
    expect(await h.fxBursts(page)).toBe(20);

    // 完了直後: オーバーレイ表示中で、カスケード画像はまだ残っている
    expect(await h.overlayVisible(page)).toBe(true);
    expect(after.visualsRemaining).toBe(true);
    expect(after.cleared).toBe(false);
    expect(await page.locator("#anim-layer .victory-clone").count()).toBe(52);
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);

    // U-1: 静止したクローンの下端がフッター上端のラインに一致する
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector(".site-footer");
      const game = document.getElementById("game");
      const footerTop = footer.getBoundingClientRect().top;
      const gameBottom = game.getBoundingClientRect().bottom;
      const bottoms = [...document.querySelectorAll("#anim-layer .victory-clone")].map(
        (el) => el.getBoundingClientRect().bottom
      );
      return {
        footerTop,
        gameBottom,
        count: bottoms.length,
        maxDiff: Math.max(...bottoms.map((bottom) => Math.abs(bottom - footerTop))),
      };
    });
    expect(geometry.count).toBe(52);
    expect(geometry.maxDiff).toBeLessThanOrEqual(3);
    // ゲーム盤面の下端ではなく、その下のフッター上端が地面になっている
    expect(geometry.footerTop).toBeGreaterThan(geometry.gameBottom);

    // モーダルを閉じると画像が片付き、完成したホーム山が戻る
    await closeOverlayByBackdrop(page);
    const cleared = await h.victoryDebug(page);
    expect(cleared.visualsRemaining).toBe(false);
    expect(cleared.cleared).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await page.locator("#home-cells .card").count()).toBe(52);

    const state = await h.state(page);
    expect(state.won).toBe(true);
    expect(state.moveCount).toBe(52);
    expect(state.historyLength).toBe(0);
  });

  test("カスケード中に新しいゲームを始めると中断され、オーバーレイも残留物も残らない", async ({
    page,
  }) => {
    await startVictory(page);
    await page.waitForFunction(() => window.__victoryDebug.released >= 4, undefined, {
      timeout: 5000,
    });

    await h.startGame(page, 2);

    const debug = await h.victoryDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.skipped).toBe(false);
    expect(debug.interrupted).toBeGreaterThanOrEqual(1);
    expect(debug.visualsRemaining).toBe(false);
    expect(debug.cleared).toBe(true);
    expect(await h.overlayVisible(page)).toBe(false);

    // 新しいゲームの配布が終われば、カスケードの残留物は一切ない
    await h.waitForDealEnd(page);
    expect(await h.overlayVisible(page)).toBe(false);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);

    const state = await h.state(page);
    expect(state.gameNumber).toBe(2);
    expect(state.won).toBe(false);
  });

  test("animationsEnabled=false では発火せず、従来どおり即オーバーレイ", async ({ page }) => {
    await h.openGame(page, 1); // ヘルパーが animationsEnabled=false にしている
    await h.setWinBoard(page);

    const debug = await h.victoryDebug(page);
    expect(debug.fires).toBe(0);
    expect(debug.active).toBe(false);
    expect(await h.overlayVisible(page)).toBe(true);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect((await h.state(page)).won).toBe(true);
  });

  test("prefers-reduced-motion では発火せず、従来どおり即オーバーレイ", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await h.setAnimations(page, true); // ゲーム側のフラグを有効にしても OS 設定が優先される
    await h.setWinBoard(page);

    const debug = await h.victoryDebug(page);
    expect(debug.fires).toBe(0);
    expect(debug.active).toBe(false);
    expect(await h.overlayVisible(page)).toBe(true);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect((await h.state(page)).won).toBe(true);
  });
});
