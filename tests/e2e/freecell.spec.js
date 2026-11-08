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

  test("クリア済みゲームは元に戻せない(Undoボタンが無効)", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    // オーバーレイを閉じてもツールバーの Undo は無効のまま
    await page.click("#overlay", { position: { x: 10, y: 10 } });
    await expect(page.locator("#overlay")).toHaveClass(/hidden/);
    expect(await page.locator("#undo-btn").isDisabled()).toBe(true);
    // Ctrl+Z でも状態は変わらない
    await page.keyboard.press("Control+z");
    const s = await h.state(page);
    expect(s.won).toBe(true);
    expect(s.moveCount).toBe(52);
  });

  test("勝利後はソルバー・自動移動系のコントロールが無効になる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    // オーバーレイを閉じてツールバーを操作できるようにする
    await page.click("#overlay", { position: { x: 10, y: 10 } });
    // UI 状態表(docs/ui-state-matrix.md 4.1)の「勝利」行: 完了済みの操作は無効
    await expect(page.locator("#undo-btn")).toBeDisabled();
    await expect(page.locator("#auto-move-btn")).toBeDisabled();
    await expect(page.locator("#hint-btn")).toBeDisabled();
    await expect(page.locator("#auto-solve-toggle")).toBeDisabled();
    await expect(page.locator("#auto-move-toggle")).toBeDisabled();
    // 新規ゲーム系は有効のまま(勝利後に次のゲームへ進める)
    await expect(page.locator("#new-game-btn")).toBeEnabled();
    await expect(page.locator("#restart-btn")).toBeEnabled();
    await expect(page.locator("#seed-input")).toBeEnabled();
    await expect(page.locator("#start-game-btn")).toBeEnabled();
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

  test("「開始」ボタンでも入力した番号のゲームが開始される", async ({ page }) => {
    await h.openGame(page, 1);
    await page.fill("#seed-input", "5");
    await page.click("#start-game-btn");
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
    // 進行があるので確認ダイアログ経由で実行される
    await page.click("#restart-btn");
    await page.click("#confirm-ok-btn");
    expect(await h.timerRunning(page)).toBe(false);
    expect(await page.textContent("#timer")).toBe("0:00");
  });

  test("進行があるときのやり直しは確認ダイアログで中止できる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    const dialog = page.locator("#confirm-dialog");

    // キャンセルボタンで中止すると盤面も履歴も維持される
    await page.click("#restart-btn");
    await expect(dialog).toBeVisible();
    await page.click("#confirm-cancel-btn");
    await expect(dialog).toBeHidden();
    let snap = await h.state(page);
    expect(snap.historyLength).toBe(1);
    expect(snap.moveCount).toBe(1);

    // Esc でも中止できる
    await page.click("#restart-btn");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    snap = await h.state(page);
    expect(snap.historyLength).toBe(1);

    // 背景クリックでも中止できる
    await page.click("#restart-btn");
    await expect(dialog).toBeVisible();
    await dialog.click({ position: { x: 10, y: 10 } });
    await expect(dialog).toBeHidden();
    expect((await h.state(page)).historyLength).toBe(1);
  });

  test("進行があるときのやり直しは Enter でも実行できる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.clickCard(page, 23);
    await h.clickSlot(page, "free", 0);
    await page.click("#restart-btn");
    await expect(page.locator("#confirm-dialog")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#confirm-dialog")).toBeHidden();
    const snap = await h.state(page);
    expect(snap.historyLength).toBe(0);
    expect(snap.moveCount).toBe(0);
  });

  test("進行がないときのやり直しは確認なしで即座にリセットされる", async ({ page }) => {
    await h.openGame(page, 1);
    await page.click("#restart-btn");
    await expect(page.locator("#confirm-dialog")).toBeHidden();
    expect((await h.state(page)).historyLength).toBe(0);
  });

  test("勝利後のやり直しは確認なしでリセットされる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setWinBoard(page);
    expect((await h.state(page)).won).toBe(true);
    // 勝利オーバーレイが全画面を覆うため、先に背景クリックで閉じる
    await page.locator("#overlay").click({ position: { x: 10, y: 10 } });
    await page.click("#restart-btn");
    await expect(page.locator("#confirm-dialog")).toBeHidden();
    expect((await h.state(page)).won).toBe(false);
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

test.describe("ソルバー", () => {
  /** あと 1 手で勝利する盤面(♠K がフリーセル、♠ は A〜Q までホーム) */
  function nearWinBoard() {
    const pile = (suit) => Array.from({ length: 13 }, (_, r) => r * 4 + suit);
    return {
      cascades: Array.from({ length: 8 }, () => []),
      freeCells: [null, null, null, 51],
      foundations: [pile(0), pile(1), pile(2), pile(3).slice(0, 12)],
    };
  }

  /** 2 手で勝利する盤面(♠K・♠Q がフリーセル、♠ は A〜J までホーム)。
   *  自動解答の暗さ検証で、ホーム以外の手を先頭に挟むモック手順と組み合わせる */
  function twoMoveBoard() {
    const pile = (suit) => Array.from({ length: 13 }, (_, r) => r * 4 + suit);
    return {
      cascades: Array.from({ length: 8 }, () => []),
      freeCells: [51, 47, null, null], // ♠K, ♠Q
      foundations: [pile(0), pile(1), pile(2), pile(3).slice(0, 11)],
    };
  }

  /** 列の上を横切る飛行を作る盤面。c0 の 6♠ を c7 の 7♦ へ移す手をモックで返す。
   *  中央の列はすべて 6 枚以上にして、飛行カードがカード面の上を通るようにする */
  function flyoverBoard() {
    const used = new Set([23, 25]); // 6♠(移動元), 7♦(移動先)
    const rest = [];
    for (let id = 0; id < 52; id += 1) {
      if (!used.has(id)) {
        rest.push(id);
      }
    }
    const cascades = Array.from({ length: 8 }, () => []);
    cascades[0] = rest.splice(0, 6).concat(23);
    cascades[7] = rest.splice(0, 3).concat(25);
    for (let i = 1; i <= 6; i += 1) {
      cascades[i] = rest.splice(0, 7);
    }
    return { cascades, freeCells: [], foundations: [] };
  }

  /** 盤面と #anim-layer の不透明度/フィルタ、auto-solving クラスの有無 */
  function dimState(page) {
    return page.evaluate(() => {
      const game = document.getElementById("game");
      const layer = document.getElementById("anim-layer");
      const gameStyle = getComputedStyle(game);
      const layerStyle = layer ? getComputedStyle(layer) : null;
      return {
        gameOpacity: gameStyle.opacity,
        gameFilter: gameStyle.filter,
        layerOpacity: layerStyle ? layerStyle.opacity : "1",
        layerFilter: layerStyle ? layerStyle.filter : "none",
        gameClass: game.classList.contains("auto-solving"),
        layerClass: layer ? layer.classList.contains("auto-solving") : false,
      };
    });
  }

  /** スクリーンショットの矩形内の平均色と平均輝度(Rec.709 係数)。PNG は
   *  ブラウザーで canvas へ描いて画素を読む(テスト側に画像デコーダー依存を
   *  持たない) */
  async function averagePixels(page, box) {
    const png = await page.screenshot({ clip: box });
    return page.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
      }
      const n = data.length / 4;
      return {
        r: r / n,
        g: g / n,
        b: b / n,
        lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n,
      };
    }, png.toString("base64"));
  }

  /** Worker 生成時に必ず onerror を発火させるモックを注入する(エラー復帰の検証用) */
  async function installErrorWorker(page) {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class ErrorSolverWorker {
        constructor() {
          this.onmessage = null;
          this.onerror = null;
          this.terminated = false;
        }
        postMessage() {
          setTimeout(() => {
            if (!this.terminated && this.onerror) {
              this.onerror(new Error("mock solver error"));
            }
          }, 10);
        }
        terminate() {
          this.terminated = true;
        }
      };
      void NativeWorker;
    });
  }

  test("高速探索から安全探索への段階表示を行う", async ({ page }) => {
    await page.addInitScript(() => {
      window.__solverWorkerScenario = "fallback";
      const NativeWorker = window.Worker;
      window.Worker = class MockSolverWorker {
        constructor() {
          this.onmessage = null;
          this.onerror = null;
          this.terminated = false;
        }

        postMessage(message) {
          if (window.__solverWorkerScenario !== "fallback") {
            return;
          }
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({ data: { type: "stage", requestId: message.requestId, stage: "fast" } });
            }
          }, 0);
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({ data: { type: "stage", requestId: message.requestId, stage: "safe" } });
            }
          }, 10);
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({
                data: {
                  type: "result",
                  requestId: message.requestId,
                  result: {
                    solved: false,
                    status: "node-limit",
                    moves: [],
                    nodes: 20,
                    timeMs: 30,
                    totalNodes: 40,
                    totalTimeMs: 30,
                    finalMode: "safe",
                    strategy: "fast-safe",
                    fallbackUsed: true,
                    attempts: {},
                  },
                },
              });
            }
          }, 50);
        }

        terminate() {
          this.terminated = true;
        }
      };
      void NativeWorker;
    });
    await h.openGame(page, 1);
    // 段階表示は自動解答(トグル)でのみ行われる。ヒントではラベルは変わらない
    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#auto-solve-label")).toHaveText("安全探索中…");
    await expect(page.locator("#toast")).toContainText("探索上限内では解答を発見できませんでした", { timeout: 1000 });
    // 終了後はトグルがOFFに戻る
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked({ timeout: 2000 });
  });

  test("ヒント: 次の一手だけハイライトとトーストで表示され、盤面は変わらない", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント", { timeout: 10000 });
    await expect(page.locator("#solution-panel")).toHaveCount(0);
    // ヒント中は自動解答ラベルが変化しない(ボタン位置のチカチカ防止)
    await expect(page.locator("#auto-solve-label")).toHaveText("自動解答");
    // ヒントハイライトが付く(移動元カードと移動先(ホームは山の最上段カード))
    await expect(page.locator("#game .card.hint-source")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("#game .card.hint-target")).toBeVisible();
    // ヒントは手を進めない(♠K はフリーセルのまま)
    const s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.freeCells[3]).toBe(51);
    expect(s.won).toBe(false);
  });

  test("ヒント: 計算中はボタンにスピナーと段階表示を出し、自動解答ラベルは変えない", async ({ page }) => {
    await page.addInitScript(() => {
      window.__solverWorkerScenario = "hint-stages";
      const NativeWorker = window.Worker;
      window.Worker = class MockSolverWorker {
        constructor() {
          this.onmessage = null;
          this.onerror = null;
          this.terminated = false;
        }

        postMessage(message) {
          if (window.__solverWorkerScenario !== "hint-stages") {
            return;
          }
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({ data: { type: "stage", requestId: message.requestId, stage: "fast" } });
            }
          }, 0);
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({ data: { type: "stage", requestId: message.requestId, stage: "safe" } });
            }
          }, 800);
          setTimeout(() => {
            if (!this.terminated) {
              this.onmessage?.({
                data: {
                  type: "result",
                  requestId: message.requestId,
                  result: {
                    solved: true,
                    status: "solved",
                    moves: [{ cardId: 51, count: 1, destZone: "home", destIndex: 3 }],
                    nodes: 10,
                    timeMs: 20,
                    totalNodes: 50,
                    totalTimeMs: 800,
                    finalMode: "safe",
                    strategy: "fast-safe",
                    fallbackUsed: true,
                    attempts: {},
                  },
                },
              });
            }
          }, 1000);
        }

        terminate() {
          this.terminated = true;
        }
      };
      void NativeWorker;
    });
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.click("#hint-btn");
    // 押下直後はスピナー(busy クラス + aria-busy)。文字はまだ「ヒント」のまま
    await expect(page.locator("#hint-btn")).toHaveClass(/busy/);
    await expect(page.locator("#hint-btn")).toHaveAttribute("aria-busy", "true");
    // 遅延(300ms)確定後に段階表示へ切り替わる
    await expect(page.locator("#hint-btn")).toHaveText("高速探索中…", { timeout: 2000 });
    await expect(page.locator("#hint-btn")).toHaveText("安全探索中…", { timeout: 2000 });
    // ヒント中も自動解答ラベルは変化しない
    await expect(page.locator("#auto-solve-label")).toHaveText("自動解答");
    // 完了したらハイライト+トーストを表示し、ボタンは「ヒント」へ戻る
    await expect(page.locator("#toast")).toContainText("ヒント", { timeout: 2000 });
    await expect(page.locator("#game .card.hint-source")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("#hint-btn")).toHaveText("ヒント");
    await expect(page.locator("#hint-btn")).not.toHaveClass(/busy/);
    await expect(page.locator("#hint-btn")).not.toHaveAttribute("aria-busy");
    await expect(page.locator("#hint-btn")).toBeEnabled();
  });

  test("自動解答: トグルで1手ずつアニメーションし、通常の勝利フロー(オーバーレイ)で終わる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#overlay-title")).toHaveText("🎉 クリア！");
    // 手順パネルは廃止され、完了後はトグルがOFFに戻るだけ
    await expect(page.locator("#solution-panel")).toHaveCount(0);
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
    const s = await h.state(page);
    expect(s.won).toBe(true);
    expect(s.foundations[3]).toHaveLength(13);
  });

  test("自動解答: トグルON中は盤面操作がブロックされる", async ({ page }) => {
    await page.addInitScript(() => {
      window.__solverDelayMs = 3000;
      const NativeWorker = window.Worker;
      window.Worker = class DelayedWorker {
        constructor(url, opts) {
          this._inner = new NativeWorker(url, opts);
          this.onmessage = null;
          this.onerror = null;
          this._inner.onmessage = (e) => {
            const d = e.data;
            if (d && d.type === "result") {
              setTimeout(() => this.onmessage?.(e), window.__solverDelayMs);
            } else {
              this.onmessage?.(e);
            }
          };
          this._inner.onerror = (e) => this.onerror?.(e);
        }
        postMessage(m) {
          this._inner.postMessage(m);
        }
        terminate() {
          this._inner.terminate();
        }
      };
    });
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    // ブロック中は #game が pointer-events:none になり座標探索が使えないため、
    // ブロック前に操作座標を取得しておく
    const from = await h.clickPoint(page, 51); // フリーセルの ♠K
    const to = await h.slotPoint(page, "free", 0);
    await page.locator("#auto-solve-toggle").check();
    // 計算中は #game に auto-solving クラスが付く(操作ブロックの目印)
    await expect(page.locator("#game.auto-solving")).toBeVisible({ timeout: 2000 });
    // ブロック中のクリックは無視される(選択も移動も起こらない)
    await page.mouse.click(from.x, from.y);
    let s = await h.state(page);
    expect(s.selected).toBeNull();
    expect(s.moveCount).toBe(0);
    // ブロック中のドラッグも無視される
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
    s = await h.state(page);
    expect(s.moveCount).toBe(0);
    expect(s.freeCells[3]).toBe(51); // ♠K は動いていない
    // 計算完了後は通常どおりクリアまで進む
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked({ timeout: 2000 });
  });

  test("自動解答: 計算中にトグルOFFでキャンセルでき、盤面操作が復活する", async ({ page }) => {
    await page.addInitScript(() => {
      window.__solverDelayMs = 30000; // テスト中は結果を返さない
      window.__terminatedCount = 0;
      const NativeWorker = window.Worker;
      window.Worker = class DelayedWorker {
        constructor(url, opts) {
          this._inner = new NativeWorker(url, opts);
          this.onmessage = null;
          this.onerror = null;
          this._inner.onmessage = (e) => {
            const d = e.data;
            if (d && d.type === "result") {
              setTimeout(() => this.onmessage?.(e), window.__solverDelayMs);
            } else {
              this.onmessage?.(e);
            }
          };
          this._inner.onerror = (e) => this.onerror?.(e);
        }
        postMessage(m) {
          this._inner.postMessage(m);
        }
        terminate() {
          window.__terminatedCount += 1;
          this._inner.terminate();
        }
      };
      void NativeWorker;
    });
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#game.auto-solving")).toBeVisible({ timeout: 2000 });

    // トグルOFFでキャンセル: Worker が停止し、UI と盤面操作が復帰する
    await page.locator("#auto-solve-toggle").uncheck();
    await expect(page.locator("#game")).not.toHaveClass(/auto-solving/);
    await expect(page.locator("#auto-solve-label")).toHaveText("自動解答");
    expect(await page.evaluate(() => window.__terminatedCount)).toBeGreaterThanOrEqual(1);

    // 盤面操作が再度受け付けられる(フリーセルの ♠K を選択できる)
    await h.clickCard(page, 51);
    const s = await h.state(page);
    expect(s.selected).toEqual({ zone: "free", index: 3, cardIndex: 0 });
    expect(s.won).toBe(false);
  });

  test("ヒント: Worker エラー時にトーストを出してボタンを復帰させる", async ({ page }) => {
    await installErrorWorker(page);
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ソルバーでエラーが発生しました", {
      timeout: 2000,
    });
    // busy 表示が解除され、ボタンは「ヒント」へ戻る
    await expect(page.locator("#hint-btn")).toBeEnabled();
    await expect(page.locator("#hint-btn")).not.toHaveClass(/busy/);
    await expect(page.locator("#hint-btn")).toHaveText("ヒント");
  });

  test("自動解答: Worker エラー時にトーストを出して操作可能に戻る", async ({ page }) => {
    await installErrorWorker(page);
    await h.openGame(page, 1);
    await h.setBoard(page, nearWinBoard());
    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#toast")).toContainText("ソルバーでエラーが発生しました", {
      timeout: 2000,
    });
    // ブロックが解除され、トグルとラベルは初期状態へ戻る
    await expect(page.locator("#game")).not.toHaveClass(/auto-solving/);
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
    await expect(page.locator("#auto-solve-label")).toHaveText("自動解答");
    // 盤面操作も復帰する
    await h.clickCard(page, 51);
    expect((await h.state(page)).selected).toEqual({ zone: "free", index: 3, cardIndex: 0 });
  });

  test("自動解答完了後も #solution-panel は存在せず、手動クリアと同じ流れで終わる", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAnimations(page, true);
    await h.setBoard(page, nearWinBoard());
    await page.locator("#auto-solve-toggle").check();
    // 自動解答の最終手で勝利時カスケードが始まる(手動クリアと同じ checkWin 経路)
    await h.waitForVictoryStart(page, 10000);
    expect((await h.victoryDebug(page)).fires).toBe(1);
    // カスケード中の入力でスキップし、オーバーレイ表示まで進める
    await page.mouse.click(10, 10);
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#overlay-title")).toHaveText("🎉 クリア！");
    await expect(page.locator("#solution-panel")).toHaveCount(0);
    await expect(page.locator("#solution-close-btn")).toHaveCount(0);
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
  });

  test("自動解答の再生中だけ盤面と飛行クローンが同じ暗さ・色味になる", async ({ page }) => {
    // 解の先頭にホーム以外の手(♠K を空フリーセルへ)を挟み、暗さの観測中も
    // 飛行が続くようにする(モック Worker で手順を固定)
    await page.addInitScript(() => {
      const moves = [
        { cardId: 51, count: 1, destZone: "free", destIndex: 2 },
        { cardId: 47, count: 1, destZone: "home", destIndex: 3 },
        { cardId: 51, count: 1, destZone: "home", destIndex: 3 },
      ];
      window.Worker = class MockSolverWorker {
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
                  solved: true,
                  status: "solved",
                  moves,
                  nodes: 3,
                  timeMs: 1,
                  totalNodes: 3,
                  totalTimeMs: 1,
                  finalMode: "fast",
                  strategy: "fast-safe",
                  fallbackUsed: false,
                  attempts: {},
                },
              },
            });
          }, 0);
        }
        terminate() {
          this.terminated = true;
        }
      };
    });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, twoMoveBoard());

    // 通常プレイ(手動移動)の飛行中は #anim-layer に暗さが掛からない
    await h.clickCard(page, 51);
    await h.clickSlot(page, "free", 2);
    await expect(page.locator("#anim-layer .card")).toHaveCount(1);
    expect(await dimState(page)).toEqual({
      gameOpacity: "1",
      gameFilter: "none",
      layerOpacity: "1",
      layerFilter: "none",
      gameClass: false,
      layerClass: false,
    });
    await h.waitForAnimationsDone(page);

    // 盤面を戻して自動解答を再生する
    await h.setBoard(page, twoMoveBoard());
    await page.locator("#auto-solve-toggle").check();
    // ホーム以外の手(♠K → フリーセル)の飛行中を捉える
    await expect(page.locator("#anim-layer .card")).toHaveCount(1);
    await expect
      .poll(() => dimState(page))
      .toEqual({
        gameOpacity: "1", // 盤面も opacity ではなく静的な色で暗くする
        gameFilter: "none", // フィルタは使わない
        layerOpacity: "1", // 透けない
        layerFilter: "none", // 飛行クローンもフィルタを使わない
        gameClass: true,
        layerClass: true,
      });

    // 中断すると盤面・飛行クローンとも通常の明るさへ戻る
    await page.locator("#auto-solve-toggle").uncheck();
    await expect
      .poll(() => dimState(page))
      .toEqual({
        gameOpacity: "1",
        gameFilter: "none",
        layerOpacity: "1",
        layerFilter: "none",
        gameClass: false,
        layerClass: false,
      });
  });

  test("自動解答中の飛行カードの輝度と色味が盤面の静止カードと一致する", async ({ page }) => {
    // 列の上を横切る 1 手(6♠ → 7♦)をモックで返す。勝敗は問わず、飛行中を
    // 一時停止してピクセルを測る
    await page.addInitScript(() => {
      window.Worker = class MockSolverWorker {
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
                  solved: true,
                  status: "solved",
                  moves: [{ cardId: 23, count: 1, destZone: "cascade", destIndex: 7 }],
                  nodes: 1,
                  timeMs: 1,
                  totalNodes: 1,
                  totalTimeMs: 1,
                  finalMode: "fast",
                  strategy: "fast-safe",
                  fallbackUsed: false,
                  attempts: {},
                },
              },
            });
          }, 0);
        }
        terminate() {
          this.terminated = true;
        }
      };
    });
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setAnimations(page, true);
    await h.setBoard(page, flyoverBoard());
    await page.locator("#auto-solve-toggle").check();

    // クローンが現れたフレームで飛行を 70% 時点に固定する(イージングで
    // 実際の位置は終点近くになり、移動先 c7 のカード面の上に来る)
    await page.waitForFunction(() => {
      const clone = document.querySelector("#anim-layer .card");
      if (!clone) {
        return false;
      }
      const anims = clone.getAnimations();
      if (anims.length === 0) {
        return false;
      }
      for (const anim of anims) {
        anim.pause();
        anim.currentTime = (anim.effect.getTiming().duration ?? 0) * 0.7;
      }
      return true;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const boxes = await page.evaluate(() => {
      const patch = (rect) => ({
        x: Math.round(rect.left + rect.width * 0.62),
        y: Math.round(rect.top + rect.height * 0.1),
        width: Math.round(rect.width * 0.22),
        height: Math.round(rect.height * 0.11),
      });
      const clone = document.querySelector("#anim-layer .card");
      const cascade3 = document.querySelectorAll("#game .cascade")[3];
      const cards = cascade3.querySelectorAll(".card");
      const staticCard = cards[cards.length - 1];
      return {
        flight: patch(clone.getBoundingClientRect()),
        static: patch(staticCard.getBoundingClientRect()),
        cloneOpacity: getComputedStyle(clone).opacity,
        layerFilter: getComputedStyle(document.getElementById("anim-layer")).filter,
        cloneBackground: getComputedStyle(clone).backgroundImage,
        staticBackground: getComputedStyle(staticCard).backgroundImage,
        // 測色点が(隠れていない)盤面カードの上にあるか
        overCard: (() => {
          const r = clone.getBoundingClientRect();
          const cx = r.left + r.width * 0.73;
          const cy = r.top + r.height * 0.155;
          return [...document.querySelectorAll("#game .card:not(.anim-hidden)")].some((el) => {
            const b = el.getBoundingClientRect();
            return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
          });
        })(),
      };
    });

    // 飛行クローンは不透明(opacity 1)で、暗さは静的な色指定のみ
    expect(boxes.cloneOpacity).toBe("1");
    expect(boxes.layerFilter).toBe("none");
    // 盤面カードと飛行クローンは同じ暗色のカード面を使う
    expect(boxes.cloneBackground).toBe(boxes.staticBackground);
    // 測色しているのはフェルトではなく列カードの面の上
    expect(boxes.overCard).toBe(true);

    const flight = await averagePixels(page, boxes.flight);
    const still = await averagePixels(page, boxes.static);
    const diffLum = flight.lum - still.lum;
    const diffRG = flight.r - flight.g - (still.r - still.g);
    console.log(
      `[pixels] flight=(${flight.r.toFixed(1)},${flight.g.toFixed(1)},${flight.b.toFixed(1)}) ` +
        `lum=${flight.lum.toFixed(1)} static=(${still.r.toFixed(1)},${still.g.toFixed(1)},` +
        `${still.b.toFixed(1)}) lum=${still.lum.toFixed(1)} ` +
        `diffLum=${diffLum.toFixed(1)} diffRG=${diffRG.toFixed(1)}`
    );
    expect(Math.abs(diffLum)).toBeLessThanOrEqual(8);
    expect(Math.abs(diffRG)).toBeLessThanOrEqual(4);
  });
});

test.describe("解法キャッシュ", () => {
  /**
   * あと 2 手で勝利する盤面(♠Q・♠K がフリーセル、♠ は A〜J までホーム)。
   * 解は ♠Q → ホーム → ♠K → ホーム の 2 手で、簡単に解けるため E2E 向け。
   * swapped=true でフリーセルの並びだけが違う別盤面になる(解パス外)。
   */
  function twoAwayBoard(swapped = false) {
    const pile = (suit) => Array.from({ length: 13 }, (_, r) => r * 4 + suit);
    return {
      cascades: Array.from({ length: 8 }, () => []),
      freeCells: swapped ? [47, 51, null, null] : [51, 47, null, null], // ♠K, ♠Q
      foundations: [pile(0), pile(1), pile(2), pile(3).slice(0, 11)],
    };
  }

  /** Worker 起動数を数えるモックを注入する(再探索の有無の観測用) */
  async function installCountingWorker(page) {
    await page.addInitScript(() => {
      window.__workerCount = 0;
      const NativeWorker = window.Worker;
      window.Worker = class CountingSolverWorker {
        constructor(url, opts) {
          window.__workerCount += 1;
          this._inner = new NativeWorker(url, opts);
          this.onmessage = null;
          this.onerror = null;
          this._inner.onmessage = (e) => this.onmessage?.(e);
          this._inner.onerror = (e) => this.onerror?.(e);
        }
        postMessage(m) {
          this._inner.postMessage(m);
        }
        terminate() {
          this._inner.terminate();
        }
      };
    });
  }

  const workerCount = (page) => page.evaluate(() => window.__workerCount);

  /** ヒント要求の完了(キャッシュ再構築)を solverCacheInfo で待つ */
  async function waitForCacheActive(page) {
    await expect
      .poll(async () => {
        const info = await h.solverCacheInfo(page);
        return info.active ? `true:${info.remainingMoves}` : "false";
      })
      .toMatch(/^true:/);
  }

  test("ヒント→従う→ヒント: 2回目のヒントはキャッシュから即座に供給される(再探索なし)", async ({ page }) => {
    await installCountingWorker(page);
    await h.openGame(page, 1);
    await h.setAutoMove(page, false); // ♠K が自動ホーム送りされないようにする
    await h.setBoard(page, twoAwayBoard());

    // 1 回目のヒント: Worker で探索してキャッシュが作られる
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム", { timeout: 10000 });
    expect(await workerCount(page)).toBe(1);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 2 });

    // 解に従う: ♠Q をホームへ
    await h.clickCard(page, 47);
    await h.clickSlot(page, "home", 3);
    expect((await h.state(page)).foundations[3]).toHaveLength(12);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 1 });

    // 2 回目のヒント: Worker を起動せず同期で表示される
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠K → ホーム");
    expect(await workerCount(page)).toBe(1);
  });

  test("ヒント→解から外す→ヒント: キャッシュは破棄され再探索される", async ({ page }) => {
    await installCountingWorker(page);
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, twoAwayBoard());
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム", { timeout: 10000 });
    expect(await workerCount(page)).toBe(1);

    // 解から外す: ♠Q を別のフリーセルへ移す(パス上に存在しない盤面)
    await h.clickCard(page, 47);
    await h.clickSlot(page, "free", 2);
    expect(await h.solverCacheInfo(page)).toEqual({ active: false, remainingMoves: 0 });

    // 次のヒントはキャッシュなしで通常どおり再探索する
    await page.click("#hint-btn");
    await waitForCacheActive(page);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 2 });
    expect(await workerCount(page)).toBe(2);
  });

  test("ヒント→従う→アンドゥ→ヒント: キャッシュは維持され残り手数が元に戻る", async ({ page }) => {
    await installCountingWorker(page);
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, twoAwayBoard());
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム", { timeout: 10000 });
    await h.clickCard(page, 47);
    await h.clickSlot(page, "home", 3);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 1 });

    // パス上へのアンドゥでもキャッシュは維持される
    await page.click("#undo-btn");
    expect((await h.state(page)).foundations[3]).toHaveLength(11);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 2 });

    // アンドゥした盤面でのヒントも再探索なしで供給される
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム");
    expect(await workerCount(page)).toBe(1);
  });

  test("ヒント取得後にリスタート→ヒント: B0 一致で全手順が復活し即答する", async ({ page }) => {
    await installCountingWorker(page);
    // 実際のディールで最初のヒントを要求する(B0 = ゲーム #1 の初期配置)
    await h.openGame(page, 1);
    await page.click("#hint-btn");
    await waitForCacheActive(page);
    const before = await h.solverCacheInfo(page);
    expect(await workerCount(page)).toBe(1);

    // リスタート(同番号)では盤面が B0 に戻り、キャッシュは破棄されない
    await page.click("#restart-btn");
    expect(await h.solverCacheInfo(page)).toEqual(before);
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント", { timeout: 10000 });
    expect(await workerCount(page)).toBe(1); // 即答(再探索なし)
  });

  test("ヒント取得後に新規ゲーム→ヒント: キャッシュは無効化され再探索される", async ({ page }) => {
    await installCountingWorker(page);
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, twoAwayBoard());
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム", { timeout: 10000 });
    expect(await workerCount(page)).toBe(1);

    // 新規ゲームの盤面(52枚すべてカスケード)は解パス上のどの盤面とも一致しない
    await page.click("#new-game-btn");
    expect(await h.solverCacheInfo(page)).toEqual({ active: false, remainingMoves: 0 });

    // 別盤面でのヒントは通常どおり Worker で探索する
    await h.setBoard(page, twoAwayBoard(true));
    await page.click("#hint-btn");
    await waitForCacheActive(page);
    expect(await h.solverCacheInfo(page)).toEqual({ active: true, remainingMoves: 2 });
    expect(await workerCount(page)).toBe(2);
  });

  test("自動解答もキャッシュから再生される(再探索なし)", async ({ page }) => {
    await installCountingWorker(page);
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, twoAwayBoard());

    // 先にヒントで解を求めておく
    await page.click("#hint-btn");
    await expect(page.locator("#toast")).toContainText("ヒント: ♠Q → ホーム", { timeout: 10000 });
    expect(await workerCount(page)).toBe(1);

    // 自動解答トグル ON → キャッシュ命中で Worker を起こさず再生する。
    // この盤面の解はホーム行き2手のみで待ちが無く、アニメーション無効時は
    // クリック処理中に再生が完了してトグルがOFFへ戻るため check() ではなく
    // click() で開始し、完了後の状態を検証する
    await page.locator("#auto-solve-toggle").click();
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });
    expect(await workerCount(page)).toBe(1);
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
    const s = await h.state(page);
    expect(s.won).toBe(true);
    expect(s.foundations[3]).toHaveLength(13);
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
