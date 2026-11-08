import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

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
