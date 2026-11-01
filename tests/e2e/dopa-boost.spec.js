import { test, expect } from "@playwright/test";
import * as h from "./helpers.js";
import { DOPA_EFFECT_IDS } from "../../src/js/dopa-effects.js";
import { DOPA_ONOMATOPE } from "../../src/js/dopa-effects-d.js";

/**
 * ドパモード増強版(56 演出)の機械検証。
 * 音声は実音を検証しない(fake AudioContext は既存 dopa-mode.spec.js が担当)。
 */

test.describe("ドパモード増強版: 56 演出", () => {
  test("triggerDopaEffect で 56 件を順に発火でき、counts が増えて active が 0 に戻る", async ({
    page,
  }) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await h.openGame(page, 1);
    await h.setDopa(page, true);

    await page.evaluate((ids) => {
      for (const id of ids) {
        window.__testApi.triggerDopaEffect(id);
      }
    }, DOPA_EFFECT_IDS);

    const effects = await h.dopaEffects(page);
    expect(effects.registered).toEqual(DOPA_EFFECT_IDS);
    expect(effects.history.slice(0, DOPA_EFFECT_IDS.length)).toEqual(DOPA_EFFECT_IDS);
    for (const id of DOPA_EFFECT_IDS) {
      expect(effects.counts[id], `${id} が発火していない`).toBeGreaterThanOrEqual(1);
    }
    expect(effects.active).toBeGreaterThan(0);

    await page.waitForFunction(() => window.__testApi.dopaDebug().effects.active === 0, undefined, {
      timeout: 12000,
    });
    // ノードの終了は演出メタ情報より少し遅れるため、DOM 側も 0 になるまで待つ
    await h.waitForDopaIdle(page, 5000);
    const idle = await h.dopaDebug(page);
    expect(idle.effects.active).toBe(0);
    expect(idle.activeEffects).toBe(0);
    expect(pageErrors.join("\n")).toBe("");
  });

  test("実プレイ(移動)でも counts の合計が増える", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    const before = await h.dopaEffects(page);
    const beforeTotal = Object.values(before.counts).reduce((a, b) => a + b, 0);

    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    await h.waitForDopaIdle(page);

    const after = await h.dopaEffects(page);
    const afterTotal = Object.values(after.counts).reduce((a, b) => a + b, 0);
    expect(afterTotal).toBeGreaterThan(beforeTotal);
  });

  test("OFF にすると画面効果クラスが即座に外れ、盤面に transform/filter が残らない", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "c04-invert");
    expect(await page.evaluate(() => document.getElementById("game").className)).toContain("dopa-fx-");

    await h.setDopa(page, false);
    await page.waitForFunction(() => window.__testApi.dopaDebug().activeEffects === 0, undefined, {
      timeout: 2000,
    });
    const state = await page.evaluate(() => {
      const game = document.getElementById("game");
      const style = getComputedStyle(game);
      return {
        className: game.className,
        inlineTransform: game.style.transform,
        inlineFilter: game.style.filter,
        computedTransform: style.transform,
        computedFilter: style.filter,
      };
    });
    expect(state.className).not.toContain("dopa-fx-");
    expect(state.className).not.toContain("dopa-shake-");
    expect(state.inlineTransform).toBe("");
    expect(state.inlineFilter).toBe("");
    expect(state.computedTransform === "none" || state.computedTransform === "").toBe(true);
    expect(state.computedFilter === "none" || state.computedFilter === "").toBe(true);
  });

  test("勝利時は f04 → f05 → f06 の順で発火する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.setWinBoard(page);
    await page.waitForFunction(
      () => {
        const history = window.__testApi.dopaDebug().effects.history;
        return history.includes("f06-staffroll");
      },
      undefined,
      { timeout: 8000 }
    );
    const effects = await h.dopaEffects(page);
    const order = ["f04-curtain", "f05-glassbreak", "f06-staffroll"].map((id) =>
      effects.history.indexOf(id)
    );
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[2]).toBeGreaterThan(order[1]);
  });
});

test.describe("ドパモード増強版 fix-01", () => {
  test("FB-2/FB-5: d05 は英語プール＋専用クラス＋Serif 斜体", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "d05-onomatopeia");

    const word = (await page.locator(".dopa-onomatopeia").first().textContent())?.trim() ?? "";
    expect(DOPA_ONOMATOPE).toContain(word);
    expect(word).toMatch(/^[A-Z!]+$/);

    const style = await page.evaluate(() => {
      const el = document.querySelector(".dopa-onomatopeia");
      const cs = getComputedStyle(el);
      return {
        hasDedicatedClass: el.classList.contains("dopa-onomatopeia"),
        hasMetalClass: el.classList.contains("dopa-metal-text"),
        fontFamily: cs.fontFamily,
        fontStyle: cs.fontStyle,
        letterSpacing: cs.letterSpacing,
        backgroundImage: cs.backgroundImage,
      };
    });
    expect(style.hasDedicatedClass).toBe(true);
    expect(style.hasMetalClass).toBe(true);
    expect(style.fontFamily).toContain("Times New Roman");
    expect(style.fontFamily).toContain("Georgia");
    expect(style.fontStyle).toBe("italic");
    expect(style.letterSpacing.startsWith("-")).toBe(true);
    expect(style.backgroundImage).toContain("linear-gradient");
  });

  test("FB-5: カットインも Times New Roman 系の斜体で表示される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "d01-cutin");
    const style = await page.evaluate(() => {
      const el = document.querySelector(".dopa-cutin-text");
      const cs = getComputedStyle(el);
      return { fontFamily: cs.fontFamily, fontStyle: cs.fontStyle, fontWeight: cs.fontWeight };
    });
    expect(style.fontFamily).toContain("Times New Roman");
    expect(style.fontStyle).toBe("italic");
    expect(Number(style.fontWeight)).toBeGreaterThanOrEqual(700);
  });

  test("FB-3: 爆発でティルトと背景爆発が出て、終了後・OFF で復帰する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    expect(await page.locator(".dopa-bg-explosion").count()).toBe(0);

    await h.triggerDopaEffect(page, "b01-explosion");
    const during = await page.evaluate(() => {
      const game = document.getElementById("game");
      return {
        tilt: game.classList.contains("dopa-fx-tilt"),
        tiltX: game.style.getPropertyValue("--dopa-tilt-x"),
        tiltY: game.style.getPropertyValue("--dopa-tilt-y"),
        bg: document.querySelectorAll(".dopa-bg-explosion").length,
        bgParticles: document.querySelectorAll(".dopa-bg-particle").length,
      };
    });
    expect(during.tilt).toBe(true);
    expect(during.tiltX).not.toBe("");
    expect(during.tiltY).not.toBe("");
    expect(during.bg).toBeGreaterThan(0);
    expect(during.bgParticles).toBeGreaterThan(0);

    await h.waitForDopaIdle(page, 5000);
    const after = await page.evaluate(() => {
      const game = document.getElementById("game");
      const cs = getComputedStyle(game);
      return {
        tilt: game.classList.contains("dopa-fx-tilt"),
        tiltX: game.style.getPropertyValue("--dopa-tilt-x"),
        tiltY: game.style.getPropertyValue("--dopa-tilt-y"),
        bg: document.querySelectorAll(".dopa-bg-explosion").length,
        bgParticles: document.querySelectorAll(".dopa-bg-particle").length,
        transform: cs.transform,
      };
    });
    expect(after.tilt).toBe(false);
    expect(after.tiltX).toBe("");
    expect(after.tiltY).toBe("");
    expect(after.bg).toBe(0);
    expect(after.bgParticles).toBe(0);
    expect(after.transform === "none" || after.transform === "").toBe(true);

    // OFF でも即停止・復帰する
    await h.triggerDopaEffect(page, "b01-explosion");
    await h.setDopa(page, false);
    await page.waitForFunction(() => window.__testApi.dopaDebug().activeEffects === 0, undefined, {
      timeout: 2000,
    });
    const off = await page.evaluate(() => {
      const game = document.getElementById("game");
      return {
        tilt: game.classList.contains("dopa-fx-tilt"),
        tiltX: game.style.getPropertyValue("--dopa-tilt-x"),
        bg: document.querySelectorAll(".dopa-bg-explosion").length,
      };
    });
    expect(off.tilt).toBe(false);
    expect(off.tiltX).toBe("");
    expect(off.bg).toBe(0);
  });
});

test.describe("ドパモード増強版 fix-02", () => {
  test("FB-6: テキスト演出のアンカーが発火ごとに変わり、motion が記録される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    const anchors = new Set();
    const motions = new Set();
    for (let i = 0; i < 8; i++) {
      await h.triggerDopaEffect(page, "d05-onomatopeia");
      const placement = (await h.dopaDebug(page)).effects.lastPlacement;
      expect(placement).not.toBeNull();
      anchors.add(placement.anchor);
      motions.add(placement.motion);
    }
    expect(anchors.size).toBeGreaterThanOrEqual(2);
    for (const motion of motions) {
      expect(["cutin", "letters", "punch"]).toContain(motion);
    }
  });

  test("FB-7: e02-ssr は確定 epic で base の 3 倍になる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "e02-ssr");
    const effects = (await h.dopaDebug(page)).effects;
    expect(effects.lastEpic).toBe(true);
    expect(effects.lastDuration).toBe(6000);
  });
});

test.describe("ドパモード増強版 fix-03", () => {
  test("FB-8: 枠付きテキストはラッパー内で枠が文字を内包する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    const anchors = new Set();
    const ids = ["d01-cutin", "d02-commentary", "d05-onomatopeia"];
    for (let i = 0; i < 9; i++) {
      const id = ids[i % ids.length];
      await h.triggerDopaEffect(page, id);
      const placement = (await h.dopaDebug(page)).effects.lastPlacement;
      expect(placement).not.toBeNull();
      anchors.add(placement.anchor);
      const boxes = await page.evaluate(() => {
        const wraps = [...document.querySelectorAll(".dopa-text-wrap")];
        const wrap = wraps[wraps.length - 1];
        if (!wrap) {
          return null;
        }
        const frame = wrap.querySelector(".dopa-text-frame");
        const text = wrap.querySelector(".dopa-telop");
        if (!frame || !text) {
          return null;
        }
        const f = frame.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        return {
          frame: { left: f.left, top: f.top, right: f.right, bottom: f.bottom },
          text: { left: t.left, top: t.top, right: t.right, bottom: t.bottom },
          hasFrame: true,
        };
      });
      expect(boxes).not.toBeNull();
      expect(boxes.hasFrame).toBe(true);
      expect(boxes.frame.left).toBeLessThanOrEqual(boxes.text.left + 4);
      expect(boxes.frame.top).toBeLessThanOrEqual(boxes.text.top + 4);
      expect(boxes.frame.right).toBeGreaterThanOrEqual(boxes.text.right - 4);
      expect(boxes.frame.bottom).toBeGreaterThanOrEqual(boxes.text.bottom - 4);
    }
    expect(anchors.size).toBeGreaterThanOrEqual(2);
  });

  test("FB-10: 爆発でヒットストップが記録され、テキストは hold を持つ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);

    const before = (await h.dopaDebug(page)).effects.hitStopCount;
    await h.triggerDopaEffect(page, "b01-explosion");
    const during = (await h.dopaDebug(page)).effects;
    expect(during.hitStopCount).toBeGreaterThan(before);
    expect(during.lastHitStopMs).toBeGreaterThanOrEqual(80);
    expect(during.lastHitStopMs).toBeLessThanOrEqual(300);
    expect(during.hitStopActive).toBe(true);
    await page.waitForFunction(() => window.__testApi.dopaDebug().activeEffects === 0, undefined, {
      timeout: 12000,
    });
    expect((await h.dopaDebug(page)).effects.hitStopActive).toBe(false);

    await h.triggerDopaEffect(page, "d05-onomatopeia");
    const timeline = (await h.dopaDebug(page)).effects.lastTextTimeline;
    expect(timeline).not.toBeNull();
    expect(timeline.hold).toBeGreaterThanOrEqual(120);
    expect(timeline.hold).toBeLessThanOrEqual(300);
  });
});

test.describe("ドパモード増強版 fix-04", () => {
  test("FB-11: 390px 幅でもテロップがラッパーとビューポートに収まる", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    const ids = ["d01-cutin", "d02-commentary", "d05-onomatopeia", "d07-ticker"];
    for (let i = 0; i < 12; i++) {
      await h.triggerDopaEffect(page, ids[i % ids.length]);
      // 入場アニメーションが終わり、hold に入ってから定常レイアウトを測る
      await page.waitForTimeout(220);
      const box = await page.evaluate(() => {
        const wraps = [...document.querySelectorAll(".dopa-text-wrap")];
        const wrap = wraps[wraps.length - 1];
        if (!wrap) {
          return null;
        }
        const text = wrap.querySelector(".dopa-telop");
        if (!text) {
          return null;
        }
        const w = wrap.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        return {
          styleLeft: wrap.style.left,
          transform: getComputedStyle(wrap).transform,
          fontSize: getComputedStyle(text).fontSize,
          wrap: { left: w.left, right: w.right, top: w.top, bottom: w.bottom },
          text: { left: t.left, right: t.right, top: t.top, bottom: t.bottom },
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(box).not.toBeNull();
      expect(box.text.left).toBeGreaterThanOrEqual(-1);
      expect(box.text.right).toBeLessThanOrEqual(box.innerWidth + 1);
      expect(box.wrap.left).toBeGreaterThanOrEqual(-1);
      expect(box.wrap.right).toBeLessThanOrEqual(box.innerWidth + 1);
      expect(box.scrollWidth).toBeLessThanOrEqual(box.innerWidth + 1);
    }
  });

  test("FB-12: e01 で魔法陣画像が screen 合成で大きく表示され、終了後に消える", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "e01-magic");
    const info = await page.evaluate(() => {
      const img = document.querySelector('img[src*="magic-circle"]');
      if (!img) {
        return null;
      }
      const r = img.getBoundingClientRect();
      const board = document.getElementById("game").getBoundingClientRect();
      return {
        width: r.width,
        boardWidth: board.width,
        blend: getComputedStyle(img).mixBlendMode,
        src: img.getAttribute("src"),
      };
    });
    expect(info).not.toBeNull();
    expect(info.src).toContain("magic-circle");
    expect(info.width).toBeGreaterThanOrEqual(info.boardWidth * 0.7);
    expect(info.blend).toBe("screen");
    await h.waitForDopaIdle(page, 8000);
    expect(await page.locator('img[src*="magic-circle"]').count()).toBe(0);
  });

  test("FB-13: e06 で星雲背景と宇宙猫が表示され、終了後に消える", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "e06-space");
    const info = await page.evaluate(() => {
      const cat = document.querySelector('img[src*="space-cat"]');
      const nebula = document.querySelector('img[src*="nebula-backdrop"]');
      if (!cat || !nebula) {
        return null;
      }
      const r = cat.getBoundingClientRect();
      const board = document.getElementById("game").getBoundingClientRect();
      return { catWidth: r.width, boardWidth: board.width };
    });
    expect(info).not.toBeNull();
    expect(info.catWidth).toBeGreaterThanOrEqual(info.boardWidth * 0.35);
    await h.waitForDopaIdle(page, 8000);
    expect(await page.locator('img[src*="space-cat"]').count()).toBe(0);
    expect(await page.locator('img[src*="nebula-backdrop"]').count()).toBe(0);
  });
});

test.describe("ドパモード増強版 fix-04R", () => {
  test("FB-12R: magic-circle.png の四隅 alpha が 16 未満", async ({ page }) => {
    await h.openGame(page, 1);
    const alphas = await page.evaluate(async () => {
      const img = new Image();
      img.src = "src/img/magic-circle.png";
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const points = [
        [0, 0],
        [img.width - 1, 0],
        [0, img.height - 1],
        [img.width - 1, img.height - 1],
      ];
      return points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
    });
    expect(alphas).toHaveLength(4);
    for (const alpha of alphas) {
      expect(alpha).toBeLessThan(16);
    }
  });

  test("FB-14: inferno はビューポートの 95% 以上を覆う", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setDopa(page, true);
    await h.triggerDopaEffect(page, "c10-felt", { variant: "fire" });
    const box = await page.evaluate(() => {
      const layer = document.querySelector(".dopa-inferno-layer");
      if (!layer) {
        return null;
      }
      const r = layer.getBoundingClientRect();
      return { width: r.width, height: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(box.vw * 0.95);
    expect(box.height).toBeGreaterThanOrEqual(box.vh * 0.95);
    await h.waitForDopaIdle(page, 8000);
    expect(await page.locator(".dopa-inferno-layer").count()).toBe(0);
  });
});
