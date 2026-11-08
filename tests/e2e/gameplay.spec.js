import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

test.describe("クリック操作", () => {
  test("つかめるカードをクリックすると選択される(手数は変わらない)", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23); // col0 トップ 6S
    const d = await h.domState(page);
    expect(d.selected).toEqual([23]);
    expect(d.movesText).toBe("手数: 0");
  });

  test("クリック→クリックでフリーセルへ移動できる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23); // 6S を選択
    await h.clickSlot(page, "free", 0);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.freeCells[0]).toBe(23);
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21]);
    expect(s.selected).toBeNull();
    // DOM にも反映される
    const d = await h.domState(page);
    expect(d.free[0]).toBe(23);
    expect(d.cascadeLengths[0]).toBe(6);
  });

  test("Game #3: クリックで 4♠ を 5♥ の上へ移動できる", async ({ page }) => {
    await h.openGame(page, 3);
    await h.setAutoMove(page, false); // 自動移動を無効化して手動移動のみを検証
    await h.clickCard(page, 15); // col1 トップ 4S
    await h.clickCard(page, 18); // col7 トップ 5H
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[1]).toEqual([5, 42, 46, 3, 37, 4]); // 4S が抜けた列
    expect(s.cascades[7]).toEqual([13, 45, 1, 50, 11, 18, 15]); // 5H の上に 4S
  });

  test("Game #20: クリックで 1♦ を 2♠ の上へ移動できる", async ({ page }) => {
    await h.openGame(page, 20);
    await h.setAutoMove(page, false); // 自動移動を無効化して手動移動のみを検証
    await h.clickCard(page, 1); // col1 トップ AD
    await h.clickCard(page, 7); // col0 トップ 2S
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[1]).toEqual([18, 21, 33, 24, 32, 43]);
    expect(s.cascades[0]).toEqual([51, 22, 44, 40, 38, 49, 7, 1]);
  });

  test("不正な移動先は拒否され、つかめるカードなら選択が切り替わる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23); // 6S を選択
    await h.clickCard(page, 6); // col2 トップ 2H へは置けない → 選択が切り替わる
    const d = await h.domState(page);
    expect(d.selected).toEqual([6]);
    expect((await h.state(page)).moveCount).toBe(0);
  });

  test("選択解除: 400ms 以上空けて同じカードを再クリック", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await page.waitForTimeout(500);
    await h.clickCard(page, 23);
    const s = await h.state(page);
    expect(s.selected).toBeNull();
    expect(s.moveCount).toBe(0);
  });

  test("Escape で選択が解除される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await page.keyboard.press("Escape");
    const s = await h.state(page);
    expect(s.selected).toBeNull();
    expect(s.moveCount).toBe(0);
  });
});

test.describe("複数枚移動", () => {
  test("Game #12: クリックで 2 枚セットを選択して移動できる", async ({ page }) => {
    await h.openGame(page, 12);
    await h.setAutoMove(page, false); // 自動移動を無効化して手動移動のみを検証
    await h.clickCard(page, 33); // 9D(帯が見えている)をクリック → 2 枚選択
    const d = await h.domState(page);
    expect(d.selected).toEqual([33, 28]); // 9D と 8C
    await h.clickCard(page, 39); // col4 トップ 10S の上へ
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[0]).toEqual([25, 13, 45, 29, 35]);
    expect(s.cascades[4]).toEqual([22, 51, 10, 17, 8, 39, 33, 28]);
  });

  test("Game #12: ドラッグで 2 枚セットを移動できる", async ({ page }) => {
    await h.openGame(page, 12);
    await h.setAutoMove(page, false); // 自動移動を無効化して手動移動のみを検証
    const to = await h.clickPoint(page, 39); // 10S の中心へ
    await h.dragCard(page, 33, to); // 起点は帯が見えている 9D
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[0]).toEqual([25, 13, 45, 29, 35]);
    expect(s.cascades[4]).toEqual([22, 51, 10, 17, 8, 39, 33, 28]);
  });

  test("2 枚セットをホームへは移動できない(フリーセル/カスケード限定)", async ({ page }) => {
    await h.openGame(page, 12);
    await h.setBoard(page, {
      cascades: [[35, 33, 28], [], [], [], [], [], [], []],
      freeCells: [],
      foundations: [],
    });
    await h.clickCard(page, 33); // 2 枚選択(9D の帯)
    await h.clickSlot(page, "home", 0); // ホームへドロップ → 拒否
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([35, 33, 28]);
  });
});

test.describe("移動枚数上限", () => {
  const fullFreeCascades = [
    [25, 13, 45, 29, 35, 33, 28],
    [18, 11, 47, 43, 41, 31],
    [32, 4, 9, 48, 49, 2],
    [44, 42, 46, 16, 38, 20],
    [22, 51, 10, 17, 8, 39],
    [50, 6, 5, 12, 7],
    [21, 37, 30, 26, 24, 0],
    [1, 27, 3, 34, 14, 36],
  ];

  test("ドラッグで枚数超過するとトーストが表示され手数は変わらない", async ({ page }) => {
    await h.openGame(page, 12);
    // フリーセル 4 つを埋めて最大移動枚数を 1 にする
    await h.setBoard(page, {
      cascades: fullFreeCascades,
      freeCells: [19, 23, 15, 40],
      foundations: [],
    });
    expect(await h.maxMovable(page, 4)).toBe(1);
    const to = await h.clickPoint(page, 39); // 10S の上へ 2 枚をドロップ
    await h.dragCard(page, 33, to); // 起点は 9D(帯)
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([25, 13, 45, 29, 35, 33, 28]); // 元のまま
    await expect(page.locator("#toast")).toHaveText(/一度に移動できるのは最大 1 枚です/);
  });

  test("クリックでも枚数超過は拒否されトーストが表示される", async ({ page }) => {
    await h.openGame(page, 12);
    await h.setBoard(page, {
      cascades: fullFreeCascades,
      freeCells: [19, 23, 15, 40],
      foundations: [],
    });
    await h.clickCard(page, 33); // 2 枚選択(9D の帯)
    await h.clickCard(page, 39); // 10S へ → 枚数超過
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([25, 13, 45, 29, 35, 33, 28]);
    await expect(page.locator("#toast")).toHaveText(/一度に移動できるのは最大 1 枚です/);
  });

  test("移動先自身が空き列の場合、その列は移動可能枚数の計算から除外される", async ({ page }) => {
    await h.openGame(page, 1);
    // 空き列 1 つ(col1)、フリーセル 4 つ
    await h.setBoard(page, {
      cascades: [[1], [], [2], [3], [4], [5], [6], [7]],
      freeCells: [],
      foundations: [],
    });
    expect(await h.maxMovable(page, null)).toBe(10); // (4+1) * 2^1
    expect(await h.maxMovable(page, 1)).toBe(5); // 移動先自身を除外 → (4+1) * 2^0
  });
});

test.describe("ドラッグ&ドロップ", () => {
  test("6px 未満の移動はドラッグではなくクリック扱いになる", async ({ page }) => {
    await h.openGame(page, 1);
    const p = await h.clickPoint(page, 23);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 4, p.y, { steps: 2 }); // 4px は閾値未満
    await page.mouse.up();
    const d = await h.domState(page);
    expect(d.selected).toEqual([23]); // クリック扱いで選択される
    expect((await h.state(page)).moveCount).toBe(0);
    await expect(page.locator("#drag-layer")).toHaveCount(0); // ドラッグは開始されない
  });

  test("1 枚をドラッグでフリーセルへ移動できる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.dragCardToSlot(page, 23, "free", 0);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.freeCells[0]).toBe(23);
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21]);
  });

  test("ドラッグ開始時、移動可能な先にドロップ候補ヒントが表示される", async ({ page }) => {
    await h.openGame(page, 1);
    // col0: 6S(黒6)、col1: 7♥(赤7)。6S は 7♥ の上と空きフリーセル/空き列へ動かせる
    await h.setBoard(page, {
      cascades: [[23], [26], [], [], [], [], [], []],
      freeCells: [],
      foundations: [],
    });
    const p = await h.clickPoint(page, 23);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y, { steps: 5 }); // 6px 閾値を超えてドラッグ開始
    // 空きフリーセル 4 つと空き列 6 本、7♥ の上に候補が出る
    await expect(page.locator("#free-cells .slot.drop-hint")).toHaveCount(4);
    await expect(page.locator("#game .cascade .slot.drop-hint")).toHaveCount(6);
    await expect(page.locator('#game .card.drop-hint[data-card-id="26"]')).toHaveCount(1);
    // ホーム(6S は置けない)には候補が出ない
    await expect(page.locator("#home-cells .slot.drop-hint")).toHaveCount(0);
    // ドラッグを終了する(ドロップ先の成否は他のテストで検証済み)
    await page.mouse.up();
  });

  test("ドラッグ中、重ねた先の候補だけが強調表示され、ドロップで移動する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, {
      cascades: [[23], [26], [], [], [], [], [], []],
      freeCells: [],
      foundations: [],
    });
    const from = await h.clickPoint(page, 23);
    const to = await h.clickPoint(page, 26); // 7♥ の上へ
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y, { steps: 5 });
    await page.mouse.move(to.x, to.y, { steps: 10 });
    // 重ねた先(7♥)が強調表示される
    await expect(page.locator('#game .card.drop-target[data-card-id="26"]')).toHaveCount(1);
    await page.mouse.up();
    // ドロップで移動が確定し、候補表示は消える
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[1]).toEqual([26, 23]);
    await expect(page.locator("#game .drop-hint")).toHaveCount(0);
    await expect(page.locator("#game .drop-target")).toHaveCount(0);
  });
});

test.describe("ダブルクリック自動移動", () => {
  test("ホームへ行けるカードはダブルクリックでホームへ移動する", async ({ page }) => {
    await h.openGame(page, 12);
    await h.dblClickCard(page, 0); // col6 トップ AC
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[6]).toEqual([21, 37, 30, 26, 24]);
    expect(s.foundations.flat()).toContain(0);
    expect(s.selected).toBeNull();
  });

  test("ホームへ行けないカードは空きフリーセルへ移動する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.dblClickCard(page, 23); // 6S
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.freeCells).toContain(23);
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21]);
  });

  test("ダブルクリック移動の直後に同じカードをクリックしても自動移動が連鎖しない", async ({ page }) => {
    await h.openGame(page, 12);
    await h.setAutoMove(page, false); // 毎手の自動移動は無効化し、ダブルクリック判定のみを検証
    await h.dblClickCard(page, 23); // 6S → フリーセルへ
    expect((await h.state(page)).moveCount).toBe(1);
    // 直後に同じカード(今はフリーセル)をクリック → 選択されるだけで自動移動しない
    await h.clickCard(page, 23);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.selected).toEqual({ zone: "free", index: s.freeCells.indexOf(23), cardIndex: 0 });
  });

  test("クリック移動の直後に同じカードをクリックしても自動移動が連鎖しない", async ({ page }) => {
    await h.openGame(page, 1);
    // クリックで 6S をフリーセルへ移動
    await h.clickCard(page, 23); // 6S を選択
    await h.clickSlot(page, "free", 0); // 空きフリーセルへ移動
    expect((await h.state(page)).moveCount).toBe(1);
    // 直後に同じカード(今はフリーセル)をクリック → 選択されるだけで自動移動しない
    await h.clickCard(page, 23);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.selected).toEqual({ zone: "free", index: 0, cardIndex: 0 });
  });

  test("ドラッグ移動の直後に同じカードをクリックしても自動移動が連鎖しない", async ({ page }) => {
    await h.openGame(page, 1);
    const to = await h.slotPoint(page, "free", 0);
    await h.dragCard(page, 23, to); // 6S をフリーセルへドラッグ
    expect((await h.state(page)).moveCount).toBe(1);
    // 直後に同じカード(今はフリーセル)をクリック → 選択されるだけで自動移動しない
    await h.clickCard(page, 23);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.selected).toEqual({ zone: "free", index: 0, cardIndex: 0 });
  });

  test("自動移動の直後に同じカードをクリックしても自動移動が連鎖しない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, {
      cascades: [[4, 0], [], [], [], [], [], [], []], // 2C-AC が ♣ ホームへ送れる
      freeCells: [23], // 6S
      foundations: [],
    });
    // 6S をクリックして連続クリック判定を立てる
    await h.clickCard(page, 23);
    expect((await h.state(page)).selected).toEqual({ zone: "free", index: 0, cardIndex: 0 });
    // 自動移動で 2C と AC をホームへ送る(成功手で判定がリセットされる)
    await page.click("#auto-move-btn");
    expect((await h.state(page)).moveCount).toBe(2);
    // 直後に同じ 6S をクリック → 選択されるだけで自動移動しない
    await h.clickCard(page, 23);
    const s = await h.state(page);
    expect(s.moveCount).toBe(2);
    expect(s.selected).toEqual({ zone: "free", index: 0, cardIndex: 0 });
  });
});

test.describe("自動移動", () => {
  test("自動移動ボタンで安全なカードがホームへ移動する", async ({ page }) => {
    await h.openGame(page, 12);
    await page.click("#auto-move-btn"); // AC(col6 トップ)をホームへ
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[6]).toEqual([21, 37, 30, 26, 24]);
    expect(s.foundations.flat()).toContain(0);
  });

  test("複数枚を自動移動しても Undo はカード 1 枚単位", async ({ page }) => {
    await h.openGame(page, 1);
    // col0 トップから AC → 2C → 3C と連続で送れる状態
    await h.setBoard(page, {
      cascades: [[8, 4, 0], [], [], [], [], [], [], []], // 3C, 2C, AC
      freeCells: [],
      foundations: [[], [1, 5], [2, 6], [3, 7]], // ♣ 空 / ♦2 / ♥2 / ♠2
    });
    await page.click("#auto-move-btn");
    let s = await h.state(page);
    expect(s.moveCount).toBe(3);
    expect(s.foundations[0]).toEqual([0, 4, 8]); // AC, 2C, 3C
    expect(s.cascades[0]).toEqual([]);
    // この fixture は全 52 枚を置いていないため、自動移動後は盤面に動かせる
    // カードが無く詰みオーバーレイが表示される。背景クリックで閉じてから
    // Undo を検証する(実ゲームでは 52 枚すべてが盤面にある)。
    await page.click("#overlay", { position: { x: 10, y: 10 } });
    // 1 枚ずつ戻せる
    await page.click("#undo-btn");
    s = await h.state(page);
    expect(s.moveCount).toBe(2);
    expect(s.foundations[0]).toEqual([0, 4]);
    expect(s.cascades[0]).toEqual([8]);
    await page.click("#undo-btn");
    s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.foundations[0]).toEqual([0]);
    expect(s.cascades[0]).toEqual([8, 4]);
    await page.click("#undo-btn");
    s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.foundations[0]).toEqual([]);
    expect(s.cascades[0]).toEqual([8, 4, 0]);
    expect(await page.locator("#undo-btn").isDisabled()).toBe(true);
  });

  test("反対色ホームの進捗が足りないカードは自動移動されない", async ({ page }) => {
    await h.openGame(page, 1);
    // ♦/♥ ホームが空のため 3C は自動移動されない(AC, 2C まで)
    await h.setBoard(page, {
      cascades: [[8, 4, 0], [], [], [], [], [], [], []], // 3C, 2C, AC
      freeCells: [],
      foundations: [[], [], [], []],
    });
    await page.click("#auto-move-btn");
    const s = await h.state(page);
    expect(s.moveCount).toBe(2);
    expect(s.foundations[0]).toEqual([0, 4]);
    expect(s.cascades[0]).toEqual([8]); // 3C は残る
  });

  test("移動できるカードがなければボタンは無効化される", async ({ page }) => {
    await h.openGame(page, 1);
    await expect(page.locator("#auto-move-btn")).toBeDisabled();
    expect((await h.state(page)).moveCount).toBe(0);
  });
});

test.describe("自動でホームへ送る(毎手)", () => {
  test("トグルは既定でオン", async ({ page }) => {
    await h.openGame(page, 1);
    expect(await page.locator("#auto-move-toggle").isChecked()).toBe(true);
  });

  test("成功手の直後に安全なカードが自動でホームへ移動する", async ({ page }) => {
    await h.openGame(page, 12);
    // 2 枚セット [9D, 8C] を 10S の上へ移動(手動 1 手)
    await h.clickCard(page, 33);
    await h.clickCard(page, 39);
    const s = await h.state(page);
    // 手動 1 手 + AC の自動移動で手数 2
    expect(s.moveCount).toBe(2);
    expect(s.foundations.flat()).toContain(0);
    expect(s.cascades[6]).toEqual([21, 37, 30, 26, 24]);
  });

  test("トグルをオフにすると成功手の直後でも自動移動しない", async ({ page }) => {
    await h.openGame(page, 12);
    await page.uncheck("#auto-move-toggle");
    await h.clickCard(page, 33);
    await h.clickCard(page, 39);
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.foundations.every((p) => p.length === 0)).toBe(true);
    expect(s.cascades[6]).toEqual([21, 37, 30, 26, 24, 0]); // AC は残る
  });

  test("成功手の直後に動かせるカードがなくてもトーストは表示されない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23); // 6S を選択
    await h.clickSlot(page, "free", 0); // フリーセルへ移動(自動移動できるカードは無い)
    expect((await h.state(page)).moveCount).toBe(1);
    await expect(page.locator("#toast")).toHaveCount(0);
  });

  test("自動でホームへ送った後も Undo は 1 手単位で戻る", async ({ page }) => {
    await h.openGame(page, 12);
    await h.clickCard(page, 33);
    await h.clickCard(page, 39);
    expect((await h.state(page)).moveCount).toBe(2);

    await page.click("#undo-btn");
    let s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.cascades[6]).toEqual([21, 37, 30, 26, 24, 0]); // AC が列へ戻る

    await page.click("#undo-btn");
    s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([25, 13, 45, 29, 35, 33, 28]);
  });
});

test.describe("Undo", () => {
  test("ボタンで直前の移動を取り消せる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    expect((await h.state(page)).moveCount).toBe(1);
    await page.click("#undo-btn");
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.freeCells[0]).toBeNull();
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21, 23]);
    expect(s.selected).toBeNull();
    expect(await page.locator("#undo-btn").isDisabled()).toBe(true);
  });

  test("Ctrl+Z で取り消せる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    await page.keyboard.press("Control+z");
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21, 23]);
  });

  test("初期状態では Undo ボタンが無効", async ({ page }) => {
    await h.openGame(page, 1);
    expect(await page.locator("#undo-btn").isDisabled()).toBe(true);
  });
});
