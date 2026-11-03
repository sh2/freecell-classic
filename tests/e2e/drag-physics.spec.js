import { test, expect } from "@playwright/test";
import * as h from "./helpers.js";

/**
 * ドラッグの物理 (tasteful-effects 第2弾)。
 * 4 枚の合法な列 (9S-8H-7C-6D) を列 0 に置き、列 1 の 10H の上へ運ぶ。
 * 速く動かしている途中で window.__dragDebug をサンプルする。
 */

const dragBoard = {
  cascades: [
    [35, 30, 24, 21], // 9S 8H 7C 6D
    [38], // 10H
    [],
    [],
    [],
    [],
    [],
    [],
  ],
};

/** 4 枚の列を右へ速くドラッグし、途中経過と最終ポインタ位置を返す */
async function dragFastToTheRight(page) {
  const from = await h.clickPoint(page, 35);
  const rect = await page.evaluate(() => {
    const el = document.querySelector('#game .card[data-card-id="35"]');
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // 6px 閾値を超えてドラッグを開始する
  await page.mouse.move(from.x + 50, from.y, { steps: 5 });
  await page.waitForTimeout(30);

  const samples = [];
  let pointer = { x: from.x + 50, y: from.y };
  for (let i = 0; i < 6; i++) {
    pointer = { x: from.x + 50 + (i + 1) * 45, y: from.y + (i + 1) * 2 };
    await page.mouse.move(pointer.x, pointer.y);
    await page.waitForTimeout(20);
    samples.push(await h.dragDebug(page));
  }
  return { from, rect, pointer, samples };
}

/** 列の先頭から末尾までの相対位置 (先頭基準)。selector はカードのスコープ */
async function relativeOffsets(page, ids, inDragLayer = false) {
  return page.evaluate(
    ([cardIds, drag]) => {
      const scope = drag ? "#drag-layer" : "#game";
      const rects = cardIds.map((id) => {
        const el = document.querySelector(`${scope} .card[data-card-id="${id}"]`);
        if (!el) {
          return null;
        }
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      if (rects.some((r) => r === null)) {
        return null;
      }
      const base = rects[0];
      return rects.map((r) => ({ x: r.left - base.left, y: r.top - base.top }));
    },
    [ids, inDragLayer]
  );
}

/** total 枚の列の末尾に、合法な tail を置いた盤面を作る (他は空) */
function columnBoard(total, tail) {
  const used = new Set(tail);
  const filler = [];
  for (let id = 0; filler.length < total - tail.length; id++) {
    if (!used.has(id)) {
      filler.push(id);
      used.add(id);
    }
  }
  return {
    cascades: [[...filler, ...tail], [], [], [], [], [], [], []],
  };
}

/** 先頭カードを掴み、ドラッグ開始に必要な 8px だけ動かす */
async function grabAndStartDrag(page, headId) {
  const from = await h.clickPoint(page, headId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y);
  return from;
}

function expectSameOffsets(actual, expected, tolerance = 2) {
  expect(actual).not.toBeNull();
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i].x - expected[i].x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(actual[i].y - expected[i].y)).toBeLessThanOrEqual(tolerance);
  }
}

test.describe("ドラッグの物理", () => {  test("速いドラッグで傾きと後続の遅れが出て、先頭はポインタに正確に追随する", async ({
    page,
  }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, dragBoard);

    const { from, rect, pointer, samples } = await dragFastToTheRight(page);
    const peak = samples[samples.length - 1];

    expect(peak.enabled).toBe(true);
    expect(peak.active).toBe(true);
    // 右向きの移動なので傾きは正、上限 ±5 度を超えない
    expect(peak.tilt).toBeGreaterThan(0.5);
    expect(Math.abs(peak.tilt)).toBeLessThanOrEqual(5 + 0.01);

    // 先頭の遅れは 0、後続は負方向 (右へ動くレイヤーに置いていかれる)
    expect(Math.abs(peak.offsets[0].x)).toBeLessThan(0.001);
    expect(Math.abs(peak.offsets[0].y)).toBeLessThan(0.001);
    expect(peak.offsets[1].x).toBeLessThan(0);
    // 深いカードほど遅れが大きい
    for (let i = 2; i < peak.offsets.length; i++) {
      expect(Math.abs(peak.offsets[i].x)).toBeGreaterThan(
        Math.abs(peak.offsets[i - 1].x) + 0.01
      );
    }

    // 先頭カードの位置 (= レイヤーの left/top) はポインタ移動量に一致する
    const layerPos = await page.evaluate(() => {
      const layer = document.getElementById("drag-layer");
      return { left: parseFloat(layer.style.left), top: parseFloat(layer.style.top) };
    });
    const offsetX = from.x - rect.left;
    const offsetY = from.y - rect.top;
    expect(layerPos.left).toBeCloseTo(pointer.x - offsetX, 1);
    expect(layerPos.top).toBeCloseTo(pointer.y - offsetY, 1);

    // ドロップして手が正しく完了する
    const to = await h.clickPoint(page, 38);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await h.waitForAnimationsDone(page);

    const state = await h.state(page);
    expect(state.moveCount).toBe(1);
    expect(state.cascades[0]).toEqual([]);
    expect(state.cascades[1]).toEqual([38, 35, 30, 24, 21]);
    expect(await page.evaluate(() => document.getElementById("drag-layer").style.display)).toBe(
      "none"
    );
    const after = await h.dragDebug(page);
    expect(after.active).toBe(false);
    expect(after.tilt).toBe(0);
    expect(after.offsets).toEqual([]);
  });

  test("reduced-motion では傾きも遅れも出ない", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    // アニメーション設定を有効にしても reduced-motion が優先される
    await h.setAnimations(page, true);
    await h.setBoard(page, dragBoard);

    const { samples } = await dragFastToTheRight(page);
    const peak = samples[samples.length - 1];
    expect(peak.enabled).toBe(false);
    expect(peak.active).toBe(false);
    expect(Math.abs(peak.tilt)).toBeLessThan(0.001);
    for (const offset of peak.offsets) {
      expect(Math.abs(offset.x)).toBeLessThan(0.001);
      expect(Math.abs(offset.y)).toBeLessThan(0.001);
    }

    const to = await h.clickPoint(page, 38);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await h.waitForAnimationsDone(page);
    const state = await h.state(page);
    expect(state.moveCount).toBe(1);
    expect(state.cascades[1]).toEqual([38, 35, 30, 24, 21]);
  });

  test("アニメーション無効時は従来の剛体ドラッグと同じ", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, false);
    await h.setBoard(page, dragBoard);

    const { from, rect, pointer, samples } = await dragFastToTheRight(page);
    const peak = samples[samples.length - 1];
    expect(peak.enabled).toBe(false);
    expect(peak.active).toBe(false);
    expect(Math.abs(peak.tilt)).toBeLessThan(0.001);
    for (const offset of peak.offsets) {
      expect(Math.abs(offset.x)).toBeLessThan(0.001);
      expect(Math.abs(offset.y)).toBeLessThan(0.001);
    }
    // 剛体ドラッグなので先頭はポインタに完全一致
    const layerPos = await page.evaluate(() => {
      const layer = document.getElementById("drag-layer");
      return { left: parseFloat(layer.style.left), top: parseFloat(layer.style.top) };
    });
    expect(layerPos.left).toBeCloseTo(pointer.x - (from.x - rect.left), 1);
    expect(layerPos.top).toBeCloseTo(pointer.y - (from.y - rect.top), 1);
  });

  test("無効な場所へ落とすと従来どおり戻り、傾き・遅れも残らない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, dragBoard);

    await dragFastToTheRight(page);
    // 盤面の下の何もない場所へ落とす
    await page.mouse.move(640, 680, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(
      () => document.getElementById("drag-layer").style.display === "none",
      undefined,
      { timeout: 3000 }
    );

    const state = await h.state(page);
    expect(state.moveCount).toBe(0);
    expect(state.cascades[0]).toEqual([35, 30, 24, 21]);
    expect(state.cascades[1]).toEqual([38]);
    const after = await h.dragDebug(page);
    expect(after.active).toBe(false);
    expect(after.tilt).toBe(0);
    expect(after.offsets).toEqual([]);
  });
});

test.describe("ドラッグ開始時のカード間隔 (DP-9)", () => {
  const tail = [35, 30, 24]; // 9S 8H 7C (合法な 3 枚の列)

  test("圧縮された長い列 (<30px) でも掴んだ瞬間の間隔が変わらない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, false); // 物理の遅れを除いてレイアウトだけを比較
    await h.setBoard(page, columnBoard(24, tail));

    const original = await relativeOffsets(page, tail);
    expect(original).not.toBeNull();
    // 30px を下回る圧縮列であることを確認
    expect(original[1].y - original[0].y).toBeLessThan(30);

    await grabAndStartDrag(page, tail[0]);
    const dragged = await relativeOffsets(page, tail, true);
    expectSameOffsets(dragged, original);
    await page.mouse.up();
  });

  test("広い列 (34px) でも掴んだ瞬間の間隔が変わらない", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, false);
    await h.setBoard(page, columnBoard(8, tail));

    const original = await relativeOffsets(page, tail);
    expect(original).not.toBeNull();
    // 上限の 34px まで広がった列であることを確認
    expect(Math.abs(original[1].y - original[0].y - 34)).toBeLessThanOrEqual(0.5);

    await grabAndStartDrag(page, tail[0]);
    const dragged = await relativeOffsets(page, tail, true);
    expectSameOffsets(dragged, original);
    await page.mouse.up();
  });

  test("物理有効時もバネの自然位置は掴んだ列の実間隔になる", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, columnBoard(24, tail));

    const original = await relativeOffsets(page, tail);
    await grabAndStartDrag(page, tail[0]);
    // ポインタを止めたままバネを収束させ、自然位置を比較する
    await page.waitForTimeout(400);
    const dragged = await relativeOffsets(page, tail, true);
    expectSameOffsets(dragged, original);

    const debug = await h.dragDebug(page);
    expect(debug.enabled).toBe(true);
    expect(debug.offsets.length).toBe(3);
    for (const offset of debug.offsets) {
      expect(Math.abs(offset.x)).toBeLessThan(0.5);
      expect(Math.abs(offset.y)).toBeLessThan(0.5);
    }
    await page.mouse.up();
  });
});
