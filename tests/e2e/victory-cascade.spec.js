import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

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
      trailZ: Number(getComputedStyle(document.getElementById("trail-canvas")).zIndex),
      animZ: Number(getComputedStyle(document.getElementById("anim-layer")).zIndex),
    }));
    expect(atStart.active).toBe(true);
    expect(atStart.fires).toBe(1);
    expect(atStart.overlayHidden).toBe(true);
    expect(atStart.stampCanvases).toBe(1);
    // 軌跡(#trail-canvas) < 静止カード(#stamp-canvas) < 飛行クローン
    expect(atStart.trailZ).toBeLessThan(atStart.stampZ);
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
    // 風船の DOM クローンは「放出済み - 静止済み」だけ残る(B2)
    expect(during.clones).toBe(during.debug.released - during.debug.resting);
    // canvas は #stamp-canvas / #trail-canvas / #fx-canvas と、小破裂用の 3 枚
    expect(during.canvases).toBe(6);
    // まだ静止前なので軌跡キャンバスに描かれている
    expect(await h.trailPixelCount(page)).toBeGreaterThan(0);

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
    expect(await page.locator("#anim-layer .card").count()).toBe(after.released - after.resting);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);
    expect(
      (await h.stampPixelCount(page)) + (await h.trailPixelCount(page))
    ).toBeGreaterThan(0);

    // モーダルを閉じたタイミングで片付く
    await closeOverlayByBackdrop(page);
    const cleared = await h.victoryDebug(page);
    expect(cleared.visualsRemaining).toBe(false);
    expect(cleared.cleared).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await h.trailPixelCount(page)).toBe(0);
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
    const skipped = await h.victoryDebug(page);
    expect(skipped.visualsRemaining).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(skipped.released - skipped.resting);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);
    expect(
      (await h.stampPixelCount(page)) + (await h.trailPixelCount(page))
    ).toBeGreaterThan(0);

    // 新しいゲームでモーダルを閉じても片付けが漏れない
    await page.click("#overlay-new-game");
    await h.waitForDealEnd(page);
    const cleared = await h.victoryDebug(page);
    expect(cleared.visualsRemaining).toBe(false);
    expect(cleared.cleared).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await h.trailPixelCount(page)).toBe(0);
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
    const center = await h.gameCenter(page);
    await page.mouse.click(center.x, center.y);
    await h.waitForVictoryEnd(page);

    const debug = await h.victoryDebug(page);
    expect(debug.active).toBe(false);
    expect(debug.skipped).toBe(true);
    expect(debug.released).toBeLessThan(52);
    expect(debug.visualsRemaining).toBe(true);
    expect(await h.overlayVisible(page)).toBe(true);
    expect(await page.locator("#anim-layer .card").count()).toBe(debug.released - debug.resting);
    expect(await page.locator("#game .card.anim-hidden").count()).toBeGreaterThan(0);
    expect(
      (await h.stampPixelCount(page)) + (await h.trailPixelCount(page))
    ).toBeGreaterThan(0);

    await closeOverlayByBackdrop(page);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect(await page.locator("#game .card.anim-hidden").count()).toBe(0);
    expect(await h.stampPixelCount(page)).toBe(0);
    expect(await h.trailPixelCount(page)).toBe(0);

    const state = await h.state(page);
    expect(state.moveCount).toBe(52);
    expect(state.historyLength).toBe(0);
    expect(state.selected).toBeNull();
  });

  test("カスケードのクローンには影がない(B1)", async ({ page }) => {
    await startVictory(page);

    const shadows = await page.evaluate(() => {
      const clones = [...document.querySelectorAll("#anim-layer .victory-clone")];
      const boardCard = document.querySelector("#game .card");
      return {
        cloneCount: clones.length,
        cloneShadow: clones.length > 0 ? getComputedStyle(clones[0]).boxShadow : null,
        boardShadow: boardCard ? getComputedStyle(boardCard).boxShadow : null,
      };
    });
    expect(shadows.cloneCount).toBeGreaterThan(0);
    expect(shadows.cloneShadow).toBe("none");
    // 盤面の通常カードの影は残す
    expect(shadows.boardShadow).not.toBe("none");

    await page.keyboard.press("Escape");
    await h.waitForVictoryEnd(page);
  });

  test("カスケードの飛行クローンは transform で動く(P1)", async ({ page }) => {
    await startVictory(page);

    const start = await page.evaluate(() => {
      const clone = document.querySelector("#anim-layer .victory-clone");
      if (!clone) {
        return null;
      }
      window.__p1Clone = clone;
      return {
        left: clone.style.left,
        top: clone.style.top,
        transform: clone.style.transform,
      };
    });
    expect(start).not.toBeNull();
    expect(start.left).toBe("0px");
    expect(start.top).toBe("0px");
    expect(start.transform).toMatch(/translate3d\(/);

    const after = await page.evaluate(async () => {
      const clone = window.__p1Clone;
      const before = clone.style.transform;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        left: clone.style.left,
        top: clone.style.top,
        before,
        after: clone.style.transform,
      };
    });
    expect(after.left).toBe("0px");
    expect(after.top).toBe("0px");
    expect(after.after).toMatch(/translate3d\(/);
    // 位置は left/top ではなく transform の値だけが動く
    expect(after.after).not.toBe(after.before);

    await page.keyboard.press("Escape");
    await h.waitForVictoryEnd(page);
  });

  test("静止したカードはキャンバスへ移り、アニメレイヤーに溜まらない(B2)", async ({ page }) => {
    test.setTimeout(30000);
    await startVictory(page);

    await page.waitForFunction(() => window.__victoryDebug.resting >= 10, undefined, {
      timeout: 15000,
    });
    const during = await page.evaluate(() => ({
      released: window.__victoryDebug.released,
      resting: window.__victoryDebug.resting,
      positions: window.__victoryDebug.restingPositions.length,
      clones: document.querySelectorAll("#anim-layer .victory-clone").length,
    }));
    expect(during.resting).toBeGreaterThanOrEqual(10);
    expect(during.positions).toBe(during.resting);
    // アニメレイヤーには「まだ飛んでいる枚数」しか残らない
    expect(during.clones).toBe(during.released - during.resting);
    expect(during.clones).toBeGreaterThan(0);
    // 軌跡と静止カードは別キャンバスに描かれている
    expect(await h.trailPixelCount(page)).toBeGreaterThan(0);
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);

    await page.waitForFunction(() => window.__victoryDebug.resting === 52, undefined, {
      timeout: 20000,
    });
    expect(await page.locator("#anim-layer .victory-clone").count()).toBe(0);
    // 花火開始前なのでオーバーレイはまだ出ていない
    expect(await h.overlayVisible(page)).toBe(false);

    // 完了後の光景: 静止位置にカード面が見えている(フェルトではない)
    const position = await page.evaluate(() => window.__victoryDebug.restingPositions[0]);
    const box = {
      x: Math.round(position.x + position.width * 0.55),
      y: Math.round(position.y + position.height * 0.08),
      width: Math.max(4, Math.round(position.width * 0.25)),
      height: Math.max(4, Math.round(position.height * 0.12)),
    };
    const mean = await h.averagePixels(page, box);
    console.log(
      `[resting card] rgb=(${mean.r.toFixed(1)},${mean.g.toFixed(1)},${mean.b.toFixed(1)}) ` +
        `lum=${mean.lum.toFixed(1)}`
    );
    expect(mean.lum).toBeGreaterThan(150);
  });

  test("リサイズ後もカスケードの床がフッター上端に一致する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    // 初期化後に画面幅を変え、ジオメトリキャッシュが追随することを確認する
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(300);

    await h.setWinBoard(page);
    await h.waitForVictoryStart(page);
    await page.waitForFunction(() => window.__victoryDebug.resting >= 1, undefined, {
      timeout: 8000,
    });

    const result = await page.evaluate(() => {
      const position = window.__victoryDebug.restingPositions[0];
      const footer = document.querySelector(".site-footer");
      return {
        bottom: position.y + position.height,
        footerTop: footer.getBoundingClientRect().top,
      };
    });
    expect(Math.abs(result.bottom - result.footerTop)).toBeLessThanOrEqual(3);

    await page.keyboard.press("Escape");
    await h.waitForVictoryEnd(page);
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
    // 全カードが静止済みで、DOM クローンは残らずキャンバスに描かれている(B2)
    expect(after.resting).toBe(52);
    expect(after.restingPositions).toHaveLength(52);
    expect(await page.locator("#anim-layer .victory-clone").count()).toBe(0);
    // 静止カードは stamp、軌跡は trail に分かれている
    expect(await h.stampPixelCount(page)).toBeGreaterThan(0);
    expect(await h.trailPixelCount(page)).toBeGreaterThan(0);

    // U-1: 静止したカードの下端がフッター上端のラインに一致する
    const geometry = await page.evaluate(() => {
      const footer = document.querySelector(".site-footer");
      const game = document.getElementById("game");
      const footerTop = footer.getBoundingClientRect().top;
      const gameBottom = game.getBoundingClientRect().bottom;
      const bottoms = window.__victoryDebug.restingPositions.map(
        (position) => position.y + position.height
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
    expect(await h.trailPixelCount(page)).toBe(0);
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
    expect(await h.trailPixelCount(page)).toBe(0);

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
    expect(await h.trailPixelCount(page)).toBe(0);
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
    expect(await h.trailPixelCount(page)).toBe(0);
    expect((await h.state(page)).won).toBe(true);
  });
});
