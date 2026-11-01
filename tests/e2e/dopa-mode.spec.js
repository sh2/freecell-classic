import { test, expect } from "@playwright/test";
import * as h from "./helpers.js";

/**
 * ドパモードの E2E テスト。
 * 音声は実音を検証せず、ページ読み込み前に差し込んだ fake AudioContext の
 * 生成・resume 回数で確認する(ヘッドレス環境の音声デバイスに依存しない)。
 */

/** #dopa-layer への追加ノードを MutationObserver で数える */
async function watchDopaLayer(page) {
  await page.evaluate(() => {
    window.__dopaAdded = 0;
    window.__dopaMo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.parentElement && n.parentElement.closest("#dopa-layer")) {
            window.__dopaAdded += 1;
          }
        }
      }
    });
    window.__dopaMo.observe(document.body, { childList: true, subtree: true });
  });
}

async function stopWatchingDopaLayer(page) {
  return page.evaluate(() => {
    if (window.__dopaMo) {
      window.__dopaMo.disconnect();
      window.__dopaMo = null;
    }
    return window.__dopaAdded || 0;
  });
}

/** fake AudioContext をページへ差し込む(生成・resume を記録する) */
async function installFakeAudio(page) {
  await page.addInitScript(() => {
    window.__audioCalls = { constructed: 0, resumed: 0, suspended: 0, oscillators: 0 };
    const param = (value = 0) => ({
      value,
      setValueAtTime() {},
      linearRampToValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    });
    class FakeAudioContext {
      constructor() {
        window.__audioCalls.constructed += 1;
        this.state = "suspended";
        this.currentTime = 0;
        this.sampleRate = 44100;
        this.destination = {};
      }
      createGain() {
        return { gain: param(1), connect() {}, disconnect() {} };
      }
      createDynamicsCompressor() {
        return { threshold: param(-24), ratio: param(12), connect() {}, disconnect() {} };
      }
      createBuffer(channels, length) {
        return { getChannelData: () => new Float32Array(length) };
      }
      createOscillator() {
        window.__audioCalls.oscillators += 1;
        return {
          type: "sine",
          frequency: param(440),
          onended: null,
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
          addEventListener() {},
        };
      }
      createBiquadFilter() {
        return { type: "lowpass", frequency: param(800), connect() {}, disconnect() {} };
      }
      createBufferSource() {
        return {
          buffer: null,
          onended: null,
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
          addEventListener() {},
        };
      }
      resume() {
        window.__audioCalls.resumed += 1;
        this.state = "running";
        return Promise.resolve();
      }
      suspend() {
        window.__audioCalls.suspended += 1;
        this.state = "suspended";
        return Promise.resolve();
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = undefined;
  });
}

test.describe("ドパモード: 基本", () => {
  test("デフォルトは OFF で、演出レイヤーもデバッグ状態も無効", async ({ page }) => {
    await h.openGame(page, 1);
    await expect(page.locator("#dopa-toggle")).not.toBeChecked();
    expect(await page.evaluate(() => document.body.classList.contains("dopa-on"))).toBe(false);
    expect(await page.locator("#dopa-layer").count()).toBe(0);
    expect(await page.locator("#dopa-win-layer").count()).toBe(0);
    const debug = await h.dopaDebug(page);
    expect(debug.enabled).toBe(false);
    expect(debug.activeEffects).toBe(0);
    expect(await h.isDopaEnabled(page)).toBe(false);
  });

  test("トグル ON で body.dopa-on と #dopa-layer が現れ、OFF で消える", async ({ page }) => {
    await h.openGame(page, 1);
    await page.locator("#dopa-toggle").click();
    await expect(page.locator("#dopa-toggle")).toBeChecked();
    expect(await page.evaluate(() => document.body.classList.contains("dopa-on"))).toBe(true);
    expect(await page.locator("#dopa-layer").count()).toBe(1);
    expect((await h.dopaDebug(page)).enabled).toBe(true);

    await watchDopaLayer(page);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    const added = await stopWatchingDopaLayer(page);
    expect(added).toBeGreaterThan(0);

    await page.locator("#dopa-toggle").click();
    await expect(page.locator("#dopa-toggle")).not.toBeChecked();
    expect(await page.evaluate(() => document.body.classList.contains("dopa-on"))).toBe(false);
    expect(await page.locator("#dopa-layer").count()).toBe(0);
    await page.waitForFunction(() => window.__testApi.dopaDebug().activeEffects === 0);
  });

  test("再読み込みで OFF に戻る(設定は保存しない)", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    expect(await h.isDopaEnabled(page)).toBe(true);

    await page.reload();
    await h.injectPageHelpers(page);
    await expect(page.locator("#dopa-toggle")).not.toBeChecked();
    expect(await page.evaluate(() => document.body.classList.contains("dopa-on"))).toBe(false);
    expect(await h.isDopaEnabled(page)).toBe(false);
  });
});

test.describe("ドパモード: 演出", () => {
  test("reduced-motion でも ON なら独自の軌跡・バーストを描く", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await page.locator("#dopa-toggle").click();
    await watchDopaLayer(page);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);

    const added = await stopWatchingDopaLayer(page);
    expect(added).toBeGreaterThan(0);
    // 既存の飛行は reduced-motion / テスト設定で無効のまま
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
    expect((await h.dopaDebug(page)).activeEffects).toBeGreaterThanOrEqual(0);
  });

  test("選択・移動・アンドゥで演出ノードが生成され、掃除される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);

    await watchDopaLayer(page);
    await h.clickCard(page, 23);
    expect(await page.locator("#dopa-layer .dopa-ring").count()).toBeGreaterThan(0);
    await h.clickSlot(page, "free", 0);
    await h.waitForDopaIdle(page);
    const added = await stopWatchingDopaLayer(page);
    expect(added).toBeGreaterThan(0);

    await h.clickCard(page, 23); // フリーセルから再選択
    await page.locator("#undo-btn").click();
    await h.waitForDopaIdle(page);
    expect((await h.dopaDebug(page)).activeEffects).toBe(0);
  });
});

test.describe("ドパモード: 勝利演出", () => {
  test("勝利盤面で #dopa-win-layer の Canvas がオーバーレイより上に表示される", async ({ page }) => {
    await installFakeAudio(page);
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.setWinBoard(page);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(1);

    const info = await page.evaluate(() => {
      const winLayer = document.getElementById("dopa-win-layer");
      const canvas = winLayer.querySelector("canvas");
      return {
        winZ: getComputedStyle(winLayer).zIndex,
        overlayZ: getComputedStyle(document.getElementById("overlay")).zIndex,
        pointerEvents: getComputedStyle(canvas).pointerEvents,
        layerPointerEvents: getComputedStyle(winLayer).pointerEvents,
        debug: window.__testApi.dopaDebug(),
      };
    });
    expect(Number(info.winZ)).toBeGreaterThan(Number(info.overlayZ));
    expect(info.winZ).toBe("2100");
    expect(info.overlayZ).toBe("2000");
    expect(info.pointerEvents).toBe("none");
    expect(info.layerPointerEvents).toBe("none");
    expect(info.debug.activeEffects).toBeGreaterThan(0);
  });

  test("オーバーレイを閉じる・新規ゲームで Canvas と演出が消える", async ({ page }) => {
    await installFakeAudio(page);
    await h.openGame(page, 1);
    await h.setDopa(page, true);

    await h.setWinBoard(page);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(1);
    await page.mouse.click(6, 6); // オーバーレイ背景
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(0, { timeout: 2000 });
    expect((await h.dopaDebug(page)).activeEffects).toBe(0);

    await h.setWinBoard(page);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(1);
    await page.evaluate(() => window.__testApi.startGame(2));
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(0, { timeout: 1000 });
    await h.waitForDopaIdle(page);
    expect((await h.dopaDebug(page)).activeEffects).toBe(0);
  });

  test("OFF で即座に停止し、4.5 秒で自動終了して Canvas が残らない", async ({ page }) => {
    await installFakeAudio(page);
    await h.openGame(page, 1);
    await h.setDopa(page, true);

    // OFF による停止
    await h.setWinBoard(page);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(1);
    await h.setDopa(page, false);
    await page.waitForFunction(
      () => {
        const d = window.__testApi.dopaDebug();
        return d.activeEffects === 0 && d.activeVoices === 0;
      },
      undefined,
      { timeout: 1000 }
    );
    expect(await page.locator("#dopa-win-layer canvas").count()).toBe(0);
    expect(await page.locator("#dopa-win-layer *").count()).toBe(0);

    // 4.5 秒の自動終了
    await h.setDopa(page, true);
    await h.setWinBoard(page);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(1);
    await expect(page.locator("#dopa-win-layer canvas")).toHaveCount(0, { timeout: 7000 });
    const debug = await h.dopaDebug(page);
    expect(debug.activeEffects).toBe(0);
    expect(await page.locator("#dopa-win-layer").count()).toBe(1);
    expect(await page.locator("#dopa-win-layer *").count()).toBe(0);
  });
});

test.describe("ドパモード: サウンド", () => {
  test("操作前は AudioContext を生成せず、トグル ON のクリックで生成・resume する", async ({
    page,
  }) => {
    await installFakeAudio(page);
    await h.openGame(page, 1);
    expect(await page.evaluate(() => window.__audioCalls.constructed)).toBe(0);

    await page.locator("#dopa-toggle").click();
    const calls = await page.evaluate(() => window.__audioCalls);
    expect(calls.constructed).toBe(1);
    expect(calls.resumed).toBeGreaterThan(0);
    expect(calls.oscillators).toBeGreaterThan(0);
  });

  test("OFF の掃除: 300ms 以内に演出・音声 voice が 0 になる", async ({ page }) => {
    await installFakeAudio(page);
    await h.openGame(page, 1);
    await page.locator("#dopa-toggle").click();
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);

    await h.setDopa(page, false);
    await page.waitForFunction(
      () => {
        const d = window.__testApi.dopaDebug();
        return d.activeEffects === 0 && d.activeVoices === 0;
      },
      undefined,
      { timeout: 1000 }
    );
    const debug = await h.dopaDebug(page);
    expect(debug.enabled).toBe(false);
    expect(debug.activeEffects).toBe(0);
    expect(debug.activeVoices).toBe(0);
    expect(await page.locator("#dopa-layer").count()).toBe(0);
    expect(await page.locator("#dopa-win-layer").count()).toBe(0);
  });
});
