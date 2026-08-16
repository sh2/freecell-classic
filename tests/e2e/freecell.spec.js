import { test, expect } from "@playwright/test";
import * as h from "./helpers.js";

/**
 * Phase 1: 現行挙動の E2E テスト(責務分離の基準となる回帰テスト)。
 * 内部状態への参照は helpers.js に集約している。
 */

test.describe("ディール", () => {
  test("Game #1 が Microsoft FreeCell 互換の配置になる", async ({ page }) => {
    await h.openGame(page, 1);
    const s = await h.state(page);
    expect(s.cascades).toEqual([
      [41, 49, 7, 12, 11, 21, 23], // JD KD 2S 4C 3S 6D 6S
      [5, 48, 51, 16, 37, 31, 32], // 2D KC KS 5C 10D 8S 9C
      [34, 35, 33, 39, 15, 29, 6], // 9H 9S 9D 10S 4S 8D 2H
      [40, 19, 45, 46, 38, 47, 22], // JC 5S QD QH 10H QS 6H
      [17, 1, 43, 14, 30, 20], // 5D AD JS 4H 8H 6C
      [26, 44, 3, 0, 4, 9], // 7H QC AS AC 2C 3D
      [24, 50, 2, 13, 42, 28], // 7C KH AH 4D JH 8C
      [18, 10, 8, 27, 25, 36], // 5H 3H 3C 7S 7D 10C
    ]);
    // 52 枚すべてが一意
    const all = s.cascades.flat();
    expect(new Set(all).size).toBe(52);
    // フリーセル・ホームは空、手数 0、勝利していない
    expect(s.freeCells.every((c) => c === null)).toBe(true);
    expect(s.foundations.every((p) => p.length === 0)).toBe(true);
    expect(s.moveCount).toBe(0);
    expect(s.won).toBe(false);
  });

  test("Game #1 の配置が DOM に描画される", async ({ page }) => {
    await h.openGame(page, 1);
    await expect(page.locator("#game .card")).toHaveCount(52);
    const d = await h.domState(page);
    expect(d.cascadeLengths).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(d.movesText).toBe("手数: 0");
    // 列 0 の最上位カードは 6S(#23)
    const top = await page.evaluate(() => {
      const wrap = document.querySelectorAll("#game .cascade")[0];
      const els = [...wrap.querySelectorAll(".card")];
      return Number(els[els.length - 1].dataset.cardId);
    });
    expect(top).toBe(23);
  });
});

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

  test("不正なドロップ先では手数が変わらず元の位置に戻る", async ({ page }) => {
    await h.openGame(page, 1);
    const to = await h.clickPoint(page, 6); // col2 トップ 2H の上へ
    await h.dragCard(page, 23, to);
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[0]).toEqual([41, 49, 7, 12, 11, 21, 23]);
    expect(await page.evaluate(() => document.getElementById("drag-layer").style.display)).toBe("none");
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

  test("移動できるカードがなければトーストが表示される", async ({ page }) => {
    await h.openGame(page, 1);
    await page.click("#auto-move-btn");
    expect((await h.state(page)).moveCount).toBe(0);
    await expect(page.locator("#toast")).toHaveText("ホームへ移動できるカードはありません");
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

test.describe("勝利", () => {
  test("全カードがホームに揃うとオーバーレイが表示される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    const s = await h.state(page);
    expect(s.won).toBe(true);
    await expect(page.locator("#overlay")).not.toHaveClass(/hidden/);
    await expect(page.locator("#overlay-title")).toHaveText("🎉 クリア！");
    await expect(page.locator("#overlay-message")).toContainText("クリアしました");
  });

  test("オーバーレイの背景クリックで閉じられる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    await page.click("#overlay", { position: { x: 10, y: 10 } });
    await expect(page.locator("#overlay")).toHaveClass(/hidden/);
  });

  test("勝利後の新規ゲームでオーバーレイが閉じる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    await page.click("#overlay-new-game");
    const s = await h.state(page);
    expect(s.won).toBe(false);
    expect(s.moveCount).toBe(0);
    await expect(page.locator("#overlay")).toHaveClass(/hidden/);
  });
});

test.describe("詰み", () => {
  test("合法手が尽きるとオーバーレイが表示され、1手戻すで解除できる", async ({ page }) => {
    await h.openGame(page, 1);
    // A♣ をホームへ動かすと詰む 1 手前の盤面(全カード黒・非エース)
    await h.setBoard(page, {
      cascades: [[11], [12], [19], [20], [27], [28], [35], [7, 0]], // col7 の先頭が A♣
      freeCells: [36, 43, 44, 51],
      foundations: [],
    });
    await h.clickCard(page, 0); // A♣ を選択
    await h.clickSlot(page, "home", 0); // ホームへ移動 → 詰み
    let s = await h.state(page);
    expect(s.stuck).toBe(true);
    await expect(page.locator("#overlay")).not.toHaveClass(/hidden/);
    await expect(page.locator("#overlay-title")).toHaveText("詰みました");

    // 1手戻すで解除
    await page.click("#overlay-undo");
    s = await h.state(page);
    expect(s.stuck).toBe(false);
    expect(s.moveCount).toBe(0);
    expect(s.cascades[7]).toEqual([7, 0]);
    await expect(page.locator("#overlay")).toHaveClass(/hidden/);
  });

  test("通常の手では詰みオーバーレイは表示されない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23); // 6S を選択
    await h.clickSlot(page, "free", 0); // フリーセルへ移動
    const s = await h.state(page);
    expect(s.stuck).toBe(false);
    await expect(page.locator("#overlay")).toHaveClass(/hidden/);
  });
});

test.describe("指定ホームの誘導", () => {
  test("指定ホームが受け入れ不可でも別のホームへ移動する", async ({ page }) => {
    await h.openGame(page, 1);
    // ♣ ホームに AC, 2C があり、AD が col0 トップの盤面
    await h.setBoard(page, {
      cascades: [[1], [], [], [], [], [], [], []],
      freeCells: [],
      foundations: [[0, 4], [], [], []],
    });
    await h.clickCard(page, 1); // AD を選択
    await h.clickSlot(page, "home", 0); // ♣ ホームをクリック → 受け入れ不可 → ♦ ホームへ
    const s = await h.state(page);
    expect(s.moveCount).toBe(1);
    expect(s.foundations[0]).toEqual([0, 4]); // ♣ は変わらない
    expect(s.foundations[1]).toEqual([1]); // AD は ♦ ホームへ
    expect(s.cascades[0]).toEqual([]);
  });
});

test.describe("ゲーム番号入力", () => {
  test("有効な整数でそのゲーム番号が開始される", async ({ page }) => {
    await h.openGame(page, 1);
    await page.fill("#seed-input", "5");
    await page.press("#seed-input", "Enter");
    const s = await h.state(page);
    expect(s.gameNumber).toBe(5);
    expect(await page.inputValue("#seed-input")).toBe("5");
  });

  test("小数は切り捨てられる", async ({ page }) => {
    await h.openGame(page, 1);
    await page.fill("#seed-input", "12.9");
    await page.press("#seed-input", "Enter");
    const s = await h.state(page);
    expect(s.gameNumber).toBe(12);
    expect(await page.inputValue("#seed-input")).toBe("12");
  });

  test("空値はランダムなゲーム番号になる", async ({ page }) => {
    await h.openGame(page, 1);
    await page.fill("#seed-input", "");
    await page.press("#seed-input", "Enter");
    const n = (await h.state(page)).gameNumber;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(32000);
  });

  test("範囲外(0 と 32001)はランダムなゲーム番号になる", async ({ page }) => {
    await h.openGame(page, 1);
    await page.fill("#seed-input", "0");
    await page.press("#seed-input", "Enter");
    let n = (await h.state(page)).gameNumber;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(32000);

    await page.fill("#seed-input", "32001");
    await page.press("#seed-input", "Enter");
    n = (await h.state(page)).gameNumber;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(32000);
  });
});

test.describe("タイマー", () => {
  test("最初は 0:00 でタイマーは動いていない", async ({ page }) => {
    await h.openGame(page, 1);
    expect(await page.textContent("#timer")).toBe("0:00");
    expect(await h.timerRunning(page)).toBe(false);
  });

  test("最初の成功手でタイマーが開始する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    expect(await h.timerRunning(page)).toBe(true);
    await expect.poll(async () => page.textContent("#timer")).not.toBe("0:00");
  });

  test("新規ゲームでタイマーがリセットされる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    expect(await h.timerRunning(page)).toBe(true);
    await page.click("#new-game-btn");
    expect(await h.timerRunning(page)).toBe(false);
    expect(await page.textContent("#timer")).toBe("0:00");
  });

  test("やり直しでタイマーがリセットされる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    expect(await h.timerRunning(page)).toBe(true);
    await page.click("#restart-btn");
    expect(await h.timerRunning(page)).toBe(false);
    expect(await page.textContent("#timer")).toBe("0:00");
  });

  test("勝利でタイマーが停止する", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    expect(await h.timerRunning(page)).toBe(true);
    await h.setWinBoard(page);
    expect(await h.state(page)).toMatchObject({ won: true });
    expect(await h.timerRunning(page)).toBe(false);
    // ラベルが変化しない(interval が停止している)
    const label = await page.textContent("#timer");
    await page.waitForTimeout(1200);
    expect(await page.textContent("#timer")).toBe(label);
  });
});

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
});
