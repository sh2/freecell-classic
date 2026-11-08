import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

test.describe("移動アニメーション", () => {
  test("クリック移動で飛行クローンが現れ、完了後に実カードへ置き換わる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.setBoard(page, {
      cascades: [[23], [6], [], [], [], [], [], []],
    });
    await h.setAutoMove(page, false);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    // 飛行中: クローンが現れ、実カードは隠れている
    await expect(page.locator("#anim-layer .card")).toHaveCount(1);
    await expect(page.locator("#game .card.anim-hidden")).toHaveCount(1);
    await h.waitForAnimationsDone(page);
    await expect(page.locator("#anim-layer .card")).toHaveCount(0);
    // 実カードがフリーセルに表示されている
    const d = await h.domState(page);
    expect(d.free[0]).toBe(23);
  });

  test("クリック移動直後、実カードは目的地で隠れ、クローンは移動元に置かれる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.setAutoMove(page, false);
    await h.setBoard(page, { cascades: [[23], [], [], [], [], [], [], []] });
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    // 操作直後(飛行完了前)の DOM を同期的に検証する
    const snap = await page.evaluate(() => {
      const real = document.querySelector('#game .card[data-card-id="23"]');
      const clone = document.querySelector('#anim-layer .card[data-card-id="23"]');
      const cr = clone ? clone.getBoundingClientRect() : null;
      const freeSlot = document.querySelectorAll("#free-cells .slot")[0].getBoundingClientRect();
      const cascadeSlot = document.querySelectorAll("#game .cascade")[0].querySelector(".slot").getBoundingClientRect();
      return {
        realHidden: real ? real.classList.contains("anim-hidden") : false,
        realInFree: real ? !!real.closest("#free-cells") : false,
        hasClone: !!clone,
        cloneTop: cr ? cr.top : null,
        freeTop: freeSlot.top,
        cascadeTop: cascadeSlot.top,
      };
    });
    expect(snap.realHidden).toBe(true); // 実カードは隠れている(目的地に露出しない)
    expect(snap.realInFree).toBe(true); // 実カードは目的地(フリーセル)に置かれている
    expect(snap.hasClone).toBe(true); // クローンが存在する
    // クローンは移動元(カスケード)にあり、目的地(フリーセル)には無い
    expect(Math.abs(snap.cloneTop - snap.cascadeTop)).toBeLessThan(12);
    expect(Math.abs(snap.cloneTop - snap.freeTop)).toBeGreaterThan(40);
    await h.waitForAnimationsDone(page);
    expect((await h.domState(page)).free[0]).toBe(23);
  });

  test("フリーセル経由の 2 段階移動は正しい順序・移動元で飛ぶ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    // ♠1(id 3) の上に ♠2(id 7) が積まれた列のみ
    await h.setBoard(page, { cascades: [[3, 7]] });
    await h.startFlightTimeline(page);
    await h.dblClickCard(page, 7); // ♠2 をダブルクリック
    await h.waitForAnimationsDone(page);
    const events = await h.stopFlightTimeline(page);

    // クローンの出現順: ♠2(山札→フリーセル) → ♠1(山札→ホーム) → ♠2(フリーセル→ホーム)
    const clones = events.filter((e) => e.kind === "clone").map((e) => e.card);
    expect(clones).toEqual([7, 3, 7]);

    // 3 枚目のクローン(♠2)はフリーセルから飛ぶ(山札の位置ではない)
    const third = events.filter((e) => e.kind === "clone")[2];
    const pos = await page.evaluate(() => {
      const f = document.querySelectorAll("#free-cells .slot")[0].getBoundingClientRect();
      const c = document.querySelectorAll("#game .cascade")[0].querySelector(".slot").getBoundingClientRect();
      return { freeTop: f.top, cascadeTop: c.top };
    });
    expect(Math.abs(third.top - pos.freeTop)).toBeLessThan(12);
    expect(Math.abs(third.top - pos.cascadeTop)).toBeGreaterThan(40);

    // 最終状態: ホームに ♠1 と ♠2、フリーセルは空
    const s = await h.state(page);
    expect(s.moveCount).toBe(3);
    expect(s.foundations[0]).toEqual([3, 7]);
    expect(s.freeCells.every((c) => c === null)).toBe(true);
  });

  test("ドラッグドロップ成功後は指を離した位置から目的地へ飛ぶ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.setAutoMove(page, false);
    await h.dragCardToSlot(page, 23, "free", 0);
    await expect(page.locator("#anim-layer .card")).toHaveCount(1);
    await h.waitForAnimationsDone(page);
    expect((await h.state(page)).freeCells[0]).toBe(23);
    const d = await h.domState(page);
    expect(d.free[0]).toBe(23);
  });

  test("ダブルクリック + 毎手自動移動は 1 枚ずつ順に飛ぶ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    // 3H-2H の列。2H をダブルクリック → ホームへ。露出した 3H が自動でホームへ
    // (黒スートが 2 まで進んでいるため canAutoHome の安全条件を満たす)
    await h.setBoard(page, {
      cascades: [[10, 6], [], [], [], [], [], [], []],
      foundations: [[4], [], [2], [7]],
    });
    await h.dblClickCard(page, 6);
    // 2H が先に飛び、完了後に 3H が飛ぶ(1 枚ずつ順番に)
    await expect(page.locator("#anim-layer .card")).toHaveCount(1);
    await h.waitForAnimationsDone(page);
    const s = await h.state(page);
    expect(s.moveCount).toBe(2);
    expect(s.foundations[2]).toEqual([2, 6, 10]); // A♥, 2H(ダブルクリック), 3H(自動)
  });

  test("不正ドロップではドラッグレイヤーが元の位置へ戻ってから消える", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    const to = await h.clickPoint(page, 6); // col2 トップ 2H の上へ
    await h.dragCard(page, 23, to);
    // 戻りアニメ中: ドラッグレイヤーは表示されたまま
    expect(await page.evaluate(() => document.getElementById("drag-layer").style.display)).toBe("block");
    await page.waitForFunction(() => document.getElementById("drag-layer").style.display === "none", undefined, {
      timeout: 3000,
    });
    expect((await h.state(page)).moveCount).toBe(0);
  });

  test("アニメーション無効時は飛行クローンが一切現れない", async ({ page }) => {
    await h.openGame(page, 1); // ヘルパー注入で無効化済み
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    await expect(page.locator("#anim-layer .card")).toHaveCount(0);
    expect((await h.domState(page)).free[0]).toBe(23);
  });

  test("prefers-reduced-motion ではカード移動の飛行が走らない", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    // ヘルパーによる強制無効化は行わず、OS 設定だけで無効になることを見る
    await h.openGame(page, 1, { disableAnimations: false });
    await h.setAutoMove(page, false);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches
      )
    ).toBe(true);

    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);

    await expect(page.locator("#anim-layer .card")).toHaveCount(0);
    expect((await h.domState(page)).free[0]).toBe(23);
  });
});

test.describe("セル着地エフェクト", () => {
  /** A♣ と A♦ が別々の列の先頭にある盤面(1 手では詰まない) */
  const aceBoard = {
    cascades: [[0], [1], [], [], [], [], [], []],
    freeCells: [],
    foundations: [],
  };
  /** A♠〜Q♠ がホームにあり、K♠ を 1 手で送れる盤面 */
  const kingBoard = {
    cascades: [[51], [0], [], [], [], [], [], []],
    freeCells: [],
    foundations: [Array.from({ length: 12 }, (_, i) => i * 4 + 3)],
  };
  /** A♣ を 2♦ の上へ移動できる盤面 */
  const cascadeBoard = {
    cascades: [[0], [5], [], [], [], [], [], []],
    freeCells: [],
    foundations: [],
  };

  /** 着地エフェクトのデバッグ値が更新されるまで待つ */
  function waitForLanding(page, predicate) {
    return page.waitForFunction(predicate, undefined, { timeout: 2000 });
  }

  test("フリーセル着地ではスナップだけが発火する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);
    const before = await h.landingFxDebug(page);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "free", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.snap > 0);

    const after = await h.landingFxDebug(page);
    expect(after.snap - before.snap).toBe(1);
    expect(after.burst - before.burst).toBe(0);
    expect(after.last).toEqual({ zone: "free", rank: 1, cardId: 0, suit: 0 });
    // 小破裂の canvas には何も描かれない
    expect(await h.landingFxPixelCount(page)).toBe(0);
  });

  test("着地の光は box-shadow ではなく opacity をアニメーションする", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "free", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.snap > 0);

    const glow = await page.evaluate(() => {
      const el = document.querySelector("#free-cells .slot .slot-glow");
      if (!el) {
        return null;
      }
      el.__probe = true;
      const animations = el.getAnimations();
      const props = animations.flatMap((anim) =>
        anim.effect.getKeyframes().flatMap((keyframe) => Object.keys(keyframe))
      );
      return {
        boxShadow: getComputedStyle(el).boxShadow,
        opacity: Number(getComputedStyle(el).opacity),
        props,
        pointerEvents: getComputedStyle(el).pointerEvents,
      };
    });
    expect(glow).not.toBeNull();
    // 影は静止したまま(opacity だけを動かす)
    expect(glow.boxShadow).not.toBe("none");
    expect(glow.props).toContain("opacity");
    expect(glow.props).not.toContain("boxShadow");
    expect(glow.pointerEvents).toBe("none");

    // 260ms 後も要素は残り(事前生成の使い回し)、opacity が 0 に戻る
    await page.waitForTimeout(320);
    const settled = await page.evaluate(() => {
      const el = document.querySelector("#free-cells .slot .slot-glow");
      return {
        exists: el !== null,
        same: el?.__probe === true,
        opacity: el ? Number(getComputedStyle(el).opacity) : null,
        countInSlot: document.querySelectorAll("#free-cells .slot")[0].querySelectorAll(".slot-glow").length,
      };
    });
    expect(settled.exists).toBe(true);
    expect(settled.same).toBe(true);
    expect(settled.opacity).toBe(0);
    expect(settled.countInSlot).toBe(1);
  });

  test("光の要素はスロットごとに事前生成され、2回目の着地でも同じ要素を使う", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, { cascades: [[0], [4]], freeCells: [], foundations: [] });

    const initial = await page.evaluate(() => ({
      free: document.querySelectorAll("#free-cells .slot-glow").length,
      home: document.querySelectorAll("#home-cells .slot-glow").length,
      cascade: document.querySelectorAll("#cascade-area .slot-glow").length,
      freeSlots: document.querySelectorAll("#free-cells .slot").length,
      homeSlots: document.querySelectorAll("#home-cells .slot").length,
    }));
    expect(initial.free).toBe(initial.freeSlots);
    expect(initial.home).toBe(initial.homeSlots);
    expect(initial.cascade).toBe(0);

    await page.evaluate(() => {
      window.__glowProbe = document.querySelectorAll("#home-cells .slot")[0].querySelector(".slot-glow");
    });

    // 1回目: A♣ をホーム 0 へ
    await h.clickCard(page, 0);
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.snap > 0);

    // 2回目: 2♣ を同じホーム 0 へ(光の要素は作り直さない)
    await h.clickCard(page, 4);
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await page.waitForFunction(() => window.__landingFxDebug.snap >= 2, undefined, { timeout: 2000 });

    const reused = await page.evaluate(() => {
      const slot = document.querySelectorAll("#home-cells .slot")[0];
      const glows = slot.querySelectorAll(".slot-glow");
      return {
        count: glows.length,
        same: glows[0] === window.__glowProbe,
      };
    });
    expect(reused.count).toBe(1);
    expect(reused.same).toBe(true);
  });

  test("飛行開始時に着地先カードへ will-change が付き、スナップ後に外れる", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "free", 0);

    // 飛行を一時停止して、着地先カードの will-change を確実に観測する
    await page.waitForFunction(() => {
      const clone = document.querySelector("#anim-layer .card");
      if (!clone) {
        return false;
      }
      const animations = clone.getAnimations();
      if (animations.length === 0) {
        return false;
      }
      for (const anim of animations) {
        anim.pause();
      }
      return true;
    });
    const during = await page.evaluate(() => {
      const el = document.querySelector('#free-cells .card[data-card-id="0"]');
      return {
        inline: el.style.willChange,
        computed: getComputedStyle(el).willChange,
      };
    });
    expect(during.inline).toBe("transform");
    expect(during.computed).toBe("transform");

    // 飛行を再開し、スナップ(170ms)が終わるまで待つ
    await page.evaluate(() => {
      for (const clone of document.querySelectorAll("#anim-layer .card")) {
        for (const anim of clone.getAnimations()) {
          anim.play();
        }
      }
    });
    await h.waitForAnimationsDone(page);
    await page.waitForTimeout(320);

    const after = await page.evaluate(() => {
      const el = document.querySelector('#free-cells .card[data-card-id="0"]');
      return {
        inline: el.style.willChange,
        computed: getComputedStyle(el).willChange,
      };
    });
    expect(after.inline).toBe("");
    expect(after.computed).not.toBe("transform");
  });

  test("飛行が中断されたら着地先カードの will-change が外れる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "free", 0);
    await page.waitForFunction(() => document.querySelector("#anim-layer .card") !== null);

    // 飛行中に再描画して中断させる
    await h.setBoard(page, aceBoard);

    const lingering = await page.evaluate(
      () => [...document.querySelectorAll("#game .card")].filter((el) => el.style.willChange === "transform").length
    );
    expect(lingering).toBe(0);
    expect(await page.locator("#anim-layer .card").count()).toBe(0);
  });

  test("小破裂の最初のフレームは発火と同時に描かれる(rAF を待たない)", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await page.evaluate(() => {
      window.__rafCalls = 0;
      window.requestAnimationFrame = () => {
        window.__rafCalls++;
        return -1; // コールバックは実行しない(次のフレームを止める)
      };
    });

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await page.waitForFunction(() => window.__landingFxDebug.burst > 0, undefined, {
      polling: 100,
      timeout: 3000,
    });

    const info = await page.evaluate(() => {
      let pixels = 0;
      for (const canvas of document.querySelectorAll(".landing-burst-canvas")) {
        if (getComputedStyle(canvas).visibility !== "visible") {
          continue;
        }
        const ctx = canvas.getContext("2d");
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) {
            pixels++;
          }
        }
      }
      return {
        rafCalls: window.__rafCalls,
        pixels,
        active: window.__landingFxDebug.activeShardBursts,
      };
    });
    // rAF は予約されたがコールバックは一度も走っていない
    expect(info.rafCalls).toBeGreaterThan(0);
    expect(info.active).toBe(1);
    // それでも最初のフレームがすでに描かれている
    expect(info.pixels).toBeGreaterThan(0);
  });

  test("小破裂の破片はキャンバスの縁で切れない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await waitForLanding(page, () => window.__landingFxDebug.burst > 0);

    const result = await page.evaluate(async () => {
      const sample = () => {
        let edge = 0;
        let any = 0;
        for (const canvas of document.querySelectorAll(".landing-burst-canvas")) {
          if (getComputedStyle(canvas).visibility !== "visible") {
            continue;
          }
          const ctx = canvas.getContext("2d");
          const { width, height } = canvas;
          const { data } = ctx.getImageData(0, 0, width, height);
          const pad = 2; // 内部解像度の 2px を縁とみなす
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const alpha = data[(y * width + x) * 4 + 3];
              if (alpha === 0) {
                continue;
              }
              any++;
              if (x < pad || y < pad || x >= width - pad || y >= height - pad) {
                edge++;
              }
            }
          }
        }
        return { edge, any };
      };
      const start = performance.now();
      let edge = 0;
      let any = 0;
      while (performance.now() - start < 340) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const sampleResult = sample();
        edge += sampleResult.edge;
        any += sampleResult.any;
      }
      return { edge, any };
    });
    expect(result.any).toBeGreaterThan(0);
    expect(result.edge).toBe(0);
  });

  test("小破裂用キャンバスは盤面初期化時に生成・サイズ決定される", async ({ page }) => {
    await h.openGame(page, 1);
    const info = await page.evaluate(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvases = [...document.querySelectorAll(".landing-burst-canvas")];
      return {
        count: canvases.length,
        canvases: canvases.map((canvas) => {
          const rect = canvas.getBoundingClientRect();
          return {
            width: canvas.width,
            height: canvas.height,
            cssWidth: rect.width,
            cssHeight: rect.height,
            expectedWidth: Math.round(rect.width * dpr),
            expectedHeight: Math.round(rect.height * dpr),
          };
        }),
        bursts: window.__landingFxDebug.burst,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    // 同時上限 3 と同じ数だけ用意される
    expect(info.count).toBe(3);
    // まだ一度も小破裂していない
    expect(info.bursts).toBe(0);
    for (const canvas of info.canvases) {
      expect(canvas.width).toBe(canvas.expectedWidth);
      expect(canvas.height).toBe(canvas.expectedHeight);
      // 全画面ではなく破裂の範囲程度
      expect(canvas.cssWidth).toBeLessThan(info.viewportWidth);
      expect(canvas.cssHeight).toBeLessThan(info.viewportHeight);
    }
  });

  test("小破裂の描画は破裂の範囲のキャンバス内で完結する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);

    await page.evaluate(() => {
      window.__landingClears = [];
      const original = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function clearRect(x, y, width, height) {
        if (this.canvas && this.canvas.classList.contains("landing-burst-canvas")) {
          window.__landingClears.push({
            x,
            y,
            width,
            height,
            size: Number(this.canvas.dataset.burstSize),
          });
        }
        return original.call(this, x, y, width, height);
      };
    });

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.burst > 0);

    // 表示中の小さいキャンバスがカード中心に置かれている
    const during = await page.evaluate(() => {
      const canvases = [...document.querySelectorAll(".landing-burst-canvas")];
      const visible = canvases.filter((canvas) => getComputedStyle(canvas).visibility === "visible");
      const canvas = visible[0];
      const card = document.querySelector(
        `#home-cells .card[data-card-id="${window.__landingFxDebug.last.cardId}"]`
      );
      const canvasRect = canvas.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        visibleCount: visible.length,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        centerDiffX: Math.abs(canvasRect.left + canvasRect.width / 2 - (cardRect.left + cardRect.width / 2)),
        centerDiffY: Math.abs(canvasRect.top + canvasRect.height / 2 - (cardRect.top + cardRect.height / 2)),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(during.visibleCount).toBe(1);
    expect(during.canvasWidth).toBeLessThan(during.viewportWidth);
    expect(during.canvasHeight).toBeLessThan(during.viewportHeight);
    expect(during.centerDiffX).toBeLessThanOrEqual(1);
    expect(during.centerDiffY).toBeLessThanOrEqual(1);

    await page.waitForFunction(() => window.__landingFxDebug.activeShardBursts === 0, undefined, {
      timeout: 3000,
    });

    const clears = await page.evaluate(() => window.__landingClears);
    expect(clears.length).toBeGreaterThan(0);
    for (const call of clears) {
      // 小さいキャンバスの外を消していない
      expect(call.width).toBeLessThanOrEqual(call.size + 0.01);
      expect(call.height).toBeLessThanOrEqual(call.size + 0.01);
      expect(call.x).toBeGreaterThanOrEqual(-0.01);
      expect(call.y).toBeGreaterThanOrEqual(-0.01);
    }
    // 破片が消えたらキャンバスも透明に戻っている
    expect(await h.landingFxPixelCount(page)).toBe(0);
  });

  test("ホーム着地(K以外)ではスナップと小破裂が発火し、花火は出ない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, aceBoard);
    const before = await h.landingFxDebug(page);
    const fireworksBefore = await h.fxBursts(page);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.burst > 0);

    const after = await h.landingFxDebug(page);
    expect(after.snap - before.snap).toBe(1);
    expect(after.burst - before.burst).toBe(1);
    expect(after.last).toEqual({ zone: "home", rank: 1, cardId: 0, suit: 0 });

    // ホーム着地の花火は廃止済み (#fx-canvas は増えない)
    expect(await h.fxBursts(page)).toBe(fireworksBefore);
    expect(await h.fxPixelCount(page)).toBe(0);

    // 小破裂はカードより上の専用 canvas に描かれる
    await h.waitForLandingFxPixels(page);
    expect(await h.landingFxPixelCount(page)).toBeGreaterThan(0);
  });

  test("ホーム着地(K)でもスナップと小破裂が発火し、花火は出ない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, kingBoard);
    const before = await h.landingFxDebug(page);
    const fireworksBefore = await h.fxBursts(page);

    await h.clickCard(page, 51); // K♠
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await waitForLanding(page, () => window.__landingFxDebug.burst > 0);

    const after = await h.landingFxDebug(page);
    expect(after.snap - before.snap).toBe(1);
    expect(after.burst - before.burst).toBe(1);
    expect(after.last).toEqual({ zone: "home", rank: 13, cardId: 51, suit: 3 });

    // ホーム着地の花火は廃止済み (#fx-canvas は増えない)
    expect(await h.fxBursts(page)).toBe(fireworksBefore);
    expect(await h.fxPixelCount(page)).toBe(0);

    // K も他のランクと同じく小破裂がカードより上の専用 canvas に描かれる
    await h.waitForLandingFxPixels(page);
    expect(await h.landingFxPixelCount(page)).toBeGreaterThan(0);
  });

  test("列への着地では何も発火しない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, cascadeBoard);
    const before = await h.landingFxDebug(page);
    const fireworksBefore = await h.fxBursts(page);

    await h.dragCardToSlot(page, 0, "cascade", 1); // A♣ を 2♦ の上へ
    await h.waitForAnimationsDone(page);
    await page.waitForTimeout(300);

    const after = await h.landingFxDebug(page);
    expect((await h.state(page)).cascades[1]).toEqual([5, 0]);
    expect(after.snap).toBe(before.snap);
    expect(after.burst).toBe(before.burst);
    expect(after.last).toEqual(before.last);
    expect(await h.fxBursts(page)).toBe(fireworksBefore);
    expect(await h.landingFxPixelCount(page)).toBe(0);
  });

  test("移動アニメーション無効時は発火しない", async ({ page }) => {
    await h.openGame(page, 1); // ヘルパーが animationsEnabled=false にしている
    await h.setAutoMove(page, false);
    await h.setBoard(page, aceBoard);
    const before = await h.landingFxDebug(page);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await page.waitForTimeout(300);

    expect((await h.state(page)).foundations[0]).toEqual([0]);
    const after = await h.landingFxDebug(page);
    expect(after.snap).toBe(before.snap);
    expect(after.burst).toBe(before.burst);
    expect(after.last).toEqual(before.last);
    expect(await h.fxBursts(page)).toBe(0);
  });

  test("prefers-reduced-motion では発火しない", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true); // ゲーム側のフラグを有効にしても OS 設定が優先される
    await h.setBoard(page, aceBoard);
    const before = await h.landingFxDebug(page);

    await h.clickCard(page, 0); // A♣
    await h.clickSlot(page, "home", 0);
    await h.waitForAnimationsDone(page);
    await page.waitForTimeout(100);

    expect((await h.state(page)).foundations[0]).toEqual([0]);
    const after = await h.landingFxDebug(page);
    expect(after.snap).toBe(before.snap);
    expect(after.burst).toBe(before.burst);
    expect(after.last).toEqual(before.last);
    expect(await h.fxBursts(page)).toBe(0);
    expect(await h.landingFxPixelCount(page)).toBe(0);
  });
});

test.describe("キャンバス解像度", () => {
  test("devicePixelRatio が 2 を超えても内部解像度は 2 倍まで", async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      mobile: false,
    });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);

    // 着地用 canvas は盤面初期化時に 3 枚用意されている
    const landingBefore = await page.evaluate(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      return [...document.querySelectorAll(".landing-burst-canvas")].map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          width: canvas.width,
          height: canvas.height,
          expectedWidth: Math.round(rect.width * dpr),
          expectedHeight: Math.round(rect.height * dpr),
        };
      });
    });

    // スタンプ用 canvas: 勝利時カスケード開始時に初期化される
    await h.setWinBoard(page);
    await h.waitForVictoryStart(page);

    // 花火用 canvas: 実際の burst で生成・初期化する
    await page.evaluate(async () => {
      const fx = await import("./src/js/fx.js");
      fx.burst(100, 100, 88, 1);
    });

    const metrics = await page.evaluate(() => {
      const rect = (id) => {
        const canvas = document.getElementById(id);
        return canvas ? { width: canvas.width, height: canvas.height } : null;
      };
      return {
        dpr: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        stamp: rect("stamp-canvas"),
        trail: rect("trail-canvas"),
        fx: rect("fx-canvas"),
      };
    });

    expect(metrics.dpr).toBe(2.625);
    expect(landingBefore).toHaveLength(3);
    for (const canvas of landingBefore) {
      expect(canvas.width).toBe(canvas.expectedWidth);
      expect(canvas.height).toBe(canvas.expectedHeight);
    }
    const expectedWidth = Math.round(metrics.innerWidth * 2);
    const expectedHeight = Math.round(metrics.innerHeight * 2);
    for (const name of ["stamp", "trail", "fx"]) {
      expect(metrics[name], name).not.toBeNull();
      expect(metrics[name].width, name).toBe(expectedWidth);
      expect(metrics[name].height, name).toBe(expectedHeight);
    }
  });
});

test.describe("描画の差分化", () => {
  test("1手の移動で動いていないカードの DOM 要素は同一ノードのまま", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await page.evaluate(() => {
      window.__renderProbe = new Map(
        [...document.querySelectorAll("#game .card")].map((el) => [Number(el.dataset.cardId), el])
      );
    });

    // col0 の 6S(#23)をフリーセルへ移動する
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);

    const probe = await page.evaluate(() => {
      const after = new Map(
        [...document.querySelectorAll("#game .card")].map((el) => [Number(el.dataset.cardId), el])
      );
      const recreated = [];
      for (const [id, el] of window.__renderProbe) {
        if (after.get(id) !== el) {
          recreated.push(id);
        }
      }
      const moved = document.querySelector('#free-cells .card[data-card-id="23"]');
      return {
        recreated,
        totalBefore: window.__renderProbe.size,
        totalAfter: after.size,
        movedInFreeCell: moved !== null,
      };
    });

    expect(probe.totalBefore).toBe(52);
    expect(probe.totalAfter).toBe(52);
    // 動いた 6S を含め、全カードの要素が作り直されていない
    expect(probe.recreated).toEqual([]);
    expect(probe.movedInFreeCell).toBe(true);
  });

  test("列内の重なり順と z-index は状態の順序と一致する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    // 列 0 の最上位を ♦2(#5)にし、列 1 の ♠A(#3)をその上へ移す
    await h.setBoard(page, { cascades: [[9, 10, 5], [3]] });

    await h.clickCard(page, 3);
    await h.clickSlot(page, "cascade", 0);

    const order = await page.evaluate(() => {
      const wrap = document.querySelectorAll("#game .cascade")[0];
      return [...wrap.querySelectorAll(".card")].map((el) => ({
        id: Number(el.dataset.cardId),
        top: parseFloat(el.style.top),
        z: Number(el.style.zIndex),
      }));
    });
    expect(order.map((c) => c.id)).toEqual([9, 10, 5, 3]);
    expect(order.map((c) => c.z)).toEqual([1, 2, 3, 4]);
    // 重なり位置は上から下へ単調に増える
    for (let i = 1; i < order.length; i++) {
      expect(order[i].top).toBeGreaterThan(order[i - 1].top);
    }
  });
});

test.describe("ジオメトリキャッシュとスタイル局所化", () => {
  test("render の経路で盤面寸法を実測しない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await page.evaluate(() => {
      window.__geometryMeasures = [];
      const originalRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
        if (
          this.matches?.(".slot.free, .slot.home, .cascade, .site-footer, #game")
        ) {
          window.__geometryMeasures.push(`rect:${this.id || this.className}`);
        }
        return originalRect.call(this);
      };
      const originalStyle = window.getComputedStyle;
      window.getComputedStyle = function getComputedStyle(el, ...rest) {
        if (el?.id === "game") {
          window.__geometryMeasures.push("style:#game");
        }
        return originalStyle.call(this, el, ...rest);
      };
    });

    await h.setBoard(page, {
      cascades: [[0, 5, 10], [1, 6], [2], [3], [4], [7], [8], [9]],
      freeCells: [11, null, null, null],
      foundations: [[12]],
    });

    expect(await page.evaluate(() => window.__geometryMeasures)).toEqual([]);
  });

  test("リサイズ後にカードサイズと列の重なりが追随する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, {
      cascades: [[0, 5, 10, 15, 20, 25, 30]],
      freeCells: [],
      foundations: [],
    });

    const read = () =>
      page.evaluate(() => {
        const card = document.querySelector("#game .cascade .card");
        const wrap = document.querySelector("#game .cascade");
        const cards = [...wrap.querySelectorAll(".card")];
        const rect = card.getBoundingClientRect();
        return {
          cardWidth: rect.width,
          cardHeight: rect.height,
          wrapHeight: parseFloat(wrap.style.height),
          lastTop: parseFloat(cards[cards.length - 1].style.top),
          viewportWidth: window.innerWidth,
        };
      });

    const before = await read();
    const contain = await page.evaluate(
      () => getComputedStyle(document.querySelector("#game .cascade")).contain
    );
    expect(contain).toContain("layout");
    expect(contain).toContain("style");
    expect(contain).not.toContain("paint");

    await page.setViewportSize({ width: 600, height: 800 });
    // アプリ側の debounce(100ms) + 描画を待つ
    await page.waitForTimeout(300);
    const after = await read();

    // 800px 以下では --card-w: 10.5vw / --card-h: 14.7vw
    expect(after.cardWidth).toBeLessThan(before.cardWidth);
    expect(Math.abs(after.cardWidth - after.viewportWidth * 0.105)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(after.cardHeight - after.viewportWidth * 0.147)).toBeLessThanOrEqual(1.5);
    // wrap の高さは最終カードの top + カード高さに一致する
    expect(Math.abs(after.wrapHeight - (after.lastTop + after.cardHeight))).toBeLessThanOrEqual(0.6);
  });

  test("同期描画中の選択トランジションは対象カードだけ止まり、直後に戻る", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await page.evaluate(() => {
      window.__transitionProbe = [];
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const el = mutation.target;
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "class" &&
            el.classList.contains("selected")
          ) {
            window.__transitionProbe.push({
              computed: getComputedStyle(el).transitionProperty,
              inline: el.style.transition,
            });
          }
        }
      });
      observer.observe(document.getElementById("game"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
      window.__transitionObserver = observer;
    });

    await h.clickCard(page, 23); // 6S を選択
    await page.waitForTimeout(150);

    const probe = await page.evaluate(() => ({
      events: window.__transitionProbe,
      inline: document.querySelector("#game .card.selected").style.transition,
      computed: getComputedStyle(document.querySelector("#game .card.selected"))
        .transitionProperty,
    }));
    expect(probe.events.length).toBeGreaterThan(0);
    // 選択クラスが付いた同期描画中は transition: none
    expect(probe.events.some((event) => event.computed === "none")).toBe(true);
    // 2フレーム後に通常の transition へ戻る
    expect(probe.inline).toBe("");
    expect(probe.computed).toContain("box-shadow");
  });
});
