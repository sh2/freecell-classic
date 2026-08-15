import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/js/app.js";
import { MAX_GAME_NUMBER } from "../../src/js/constants.js";

/**
 * アプリケーション層 (app.js) の単体テスト。
 * view はモックを使い、時刻・interval・乱数は deps で固定して
 * タイマー開始/停止・乱数フォールバック・勝利メッセージを決定的に検証する。
 */

/** テスト用のモック View。呼び出しを calls に記録する */
function createMockView() {
  const calls = [];
  const view = {
    calls,
    animStepsHistory: [],
    timerText: "0:00",
    render() {
      calls.push("render");
    },
    setTimerLabel(text) {
      view.timerText = text;
      calls.push(`timer:${text}`);
    },
    showToast() {
      calls.push("toast");
    },
    showWin(gameNumber, moveCount, time) {
      calls.push(`win:${gameNumber}:${moveCount}:${time}`);
    },
    hideOverlay() {
      calls.push("hideOverlay");
    },
    seedInput() {
      return null; // startGame 内では null チェックでスキップされる
    },
    buildBoard() {
      calls.push("buildBoard");
    },
    failFeedback() {
      calls.push("failFeedback");
    },
    setNextRenderAnimation(steps) {
      calls.push(`anim:${steps.length}`);
      view.lastAnimSteps = steps;
      view.animStepsHistory.push(steps.map((s) => s.cardIds.slice()));
    },
    runAfterAnimations(fn) {
      calls.push("after");
      fn(); // モックは飛行を待たず即座に連鎖させる
    },
    getCardRects(cardIds) {
      calls.push(`rects:${cardIds.slice().sort((a, b) => a - b).join(",")}`);
      return Object.fromEntries(cardIds.map((id) => [id, { left: 0, top: 0 }]));
    },
    getDragCardRects() {
      calls.push("dragRects");
      return {};
    },
    setAnimationsEnabled() {
      calls.push("setAnimationsEnabled");
    },
  };
  return view;
}

/**
 * テスト用の fake 依存。now() は advance() で進められる。
 * setInterval は実際のタイマーを使わず、呼び出しと現在のハンドル数を記録する。
 */
function createFakeDeps() {
  let t = 1000;
  const active = new Set();
  const deps = {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    setInterval: vi.fn((fn, ms) => {
      const handle = { fn, ms };
      active.add(handle);
      return handle;
    }),
    clearInterval: vi.fn((handle) => {
      active.delete(handle);
    }),
    random: () => 0.25,
    activeIntervalCount: () => active.size,
  };
  return deps;
}

/** Game #1 の col0 トップ 6S をフリーセルへ動かす(1 手目の成功手) */
function firstMove(app) {
  return app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
}

describe("createApp: タイマー開始", () => {
  it("最初の成功手で interval が 1 回だけ開始される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);

    expect(deps.setInterval).not.toHaveBeenCalled();
    expect(deps.activeIntervalCount()).toBe(0);

    expect(firstMove(app).ok).toBe(true);
    expect(deps.setInterval).toHaveBeenCalledTimes(1);
    expect(deps.activeIntervalCount()).toBe(1);

    // 2 手目では再開始されない(二重起動しない)
    const res = app.attemptMove({ zone: "cascade", index: 3, cardIndex: 6 }, "free", 1);
    expect(res.ok).toBe(true);
    expect(deps.setInterval).toHaveBeenCalledTimes(1);
    expect(deps.activeIntervalCount()).toBe(1);
  });

  it("失敗手ではタイマーが開始されない", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);

    // 占領済みフリーセルへの移動(失敗)
    const res = app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    expect(res.ok).toBe(true);
    const res2 = app.attemptMove({ zone: "cascade", index: 3, cardIndex: 6 }, "free", 0); // 占有中
    expect(res2.ok).toBe(false);
    expect(deps.setInterval).toHaveBeenCalledTimes(1); // 成功手の 1 回のみ
    expect(deps.activeIntervalCount()).toBe(1);
  });
});

describe("createApp: タイマー停止", () => {
  it("新規ゲームで interval が停止・リセットされる", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    firstMove(app);
    expect(deps.activeIntervalCount()).toBe(1);

    app.startGame(2);
    expect(deps.clearInterval).toHaveBeenCalled();
    expect(deps.activeIntervalCount()).toBe(0);
    expect(view.timerText).toBe("0:00");
  });

  it("やり直し(同じゲーム番号)で interval が停止・リセットされる", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    firstMove(app);
    expect(deps.activeIntervalCount()).toBe(1);

    app.startGame(app.getState().gameNumber); // やり直し
    expect(deps.clearInterval).toHaveBeenCalled();
    expect(deps.activeIntervalCount()).toBe(0);
  });

  it("勝利で interval が停止する", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    firstMove(app);
    expect(deps.activeIntervalCount()).toBe(1);

    app.setWinBoard(52);
    expect(deps.clearInterval).toHaveBeenCalled();
    expect(deps.activeIntervalCount()).toBe(0);
  });
});

describe("createApp: タイマー表示", () => {
  it('interval のコールバックで経過時間が M:SS 形式で View に渡される', () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    firstMove(app);

    deps.advance(65000); // 65 秒経過 → "1:05"
    const intervalFn = deps.setInterval.mock.calls[0][0]; // 登録されたコールバック
    intervalFn();
    expect(view.timerText).toBe("1:05");

    deps.advance(55000); // 計 120 秒 → "2:00"
    intervalFn();
    expect(view.timerText).toBe("2:00");
  });
});

describe("createApp: 乱数フォールバック", () => {
  it("無効なゲーム番号では注入した乱数が使われる", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    deps.random = () => 0.5; // 1 + floor(0.5 * 32000) = 16001
    const app = createApp({ view, deps });
    app.startGame(1);

    view.seedInput = () => ({ value: "abc" });
    app.newGameFromInput();
    expect(app.getState().gameNumber).toBe(1 + Math.floor(0.5 * MAX_GAME_NUMBER));
  });

  it("有効なゲーム番号では乱数を使わない", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const randomSpy = vi.fn(() => 0.5);
    deps.random = randomSpy;
    const app = createApp({ view, deps });
    app.startGame(1);

    view.seedInput = () => ({ value: "7" });
    app.newGameFromInput();
    expect(app.getState().gameNumber).toBe(7);
    expect(randomSpy).not.toHaveBeenCalled();
  });
});

describe("createApp: 勝利メッセージ", () => {
  it("勝利メッセージへ経過時間が渡される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    firstMove(app);

    deps.advance(65000); // 65 秒経過 → "1:05"
    const intervalFn = deps.setInterval.mock.calls[0][0];
    intervalFn();

    app.setWinBoard(52);
    expect(view.calls.some((c) => c === `win:${app.getState().gameNumber}:52:1:05`)).toBe(true);
  });

  it("タイマー未開始で勝利した場合は 0:00 が渡される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);

    app.setWinBoard(52);
    expect(view.calls.some((c) => c === `win:${app.getState().gameNumber}:52:0:00`)).toBe(true);
  });
});

describe("createApp: 自動でホームへ送る(毎手)", () => {
  it("成功手の直後に自動移動が発動する(既定オン)", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    // 2 枚セット [9D, 8C] を 10S(col4)の上へ移動(手動 1 手)
    const res = app.attemptMove({ zone: "cascade", index: 0, cardIndex: 5 }, "cascade", 4);
    expect(res.ok).toBe(true);
    const s = app.getState();
    expect(s.moveCount).toBe(2); // 手動 1 手 + AC の自動移動
    expect(s.foundations[0].map((c) => c.id)).toEqual([0]);
  });

  it("setAutoMoveEnabled(false) で成功手の直後でも自動移動しない", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    app.setAutoMoveEnabled(false);
    app.attemptMove({ zone: "cascade", index: 0, cardIndex: 5 }, "cascade", 4);
    const s = app.getState();
    expect(s.moveCount).toBe(1);
    expect(s.foundations.every((p) => p.length === 0)).toBe(true);
  });

  it("自動発動で動かせるカードが無いときはトーストを出さない", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1); // 自動移動できるカードが無い
    app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0);
    expect(view.calls).not.toContain("toast");
  });

  it("手動ボタン(autoMoveHome)は動かせるカードが無いときトーストを出す", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    app.autoMoveHome();
    expect(view.calls).toContain("toast");
  });

  it("ダブルクリック自動移動の後も自動発動する", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    // 6S(col2 トップ)をダブルクリック → フリーセルへ。その後、露出した AH と AC が
    // 自動でホームへ送られる(手動 1 手 + 自動 2 手)
    const moved = app.dblClickAutoMove({ zone: "cascade", index: 2, cardIndex: 6 });
    expect(moved).toBe(true);
    const s = app.getState();
    expect(s.moveCount).toBe(3);
    expect(s.foundations[0].map((c) => c.id)).toEqual([2]); // AH
    expect(s.foundations[1].map((c) => c.id)).toEqual([0]); // AC
  });
});

describe("createApp: 移動アニメーションの予約", () => {
  it("成功移動で手動分のアニメーションが予約される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1); // Game #1 は自動移動対象カードなし
    firstMove(app);
    expect(view.calls).toContain("anim:1");
    // 移動元の矩形は移動対象カード(6S = id 23)で取得される
    expect(view.calls).toContain("rects:23");
  });

  it("fromDrag 指定時はドラッグレイヤーの矩形を移動元にする", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    app.attemptMove({ zone: "cascade", index: 0, cardIndex: 6 }, "free", 0, { fromDrag: true });
    expect(view.calls).toContain("dragRects");
    expect(view.calls).toContain("anim:1");
  });

  it("自動移動と手動移動のステップが連結される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    // 手動 1 手の描画 + AC の自動移動の描画で、anim:1 が 2 回予約される
    const res = app.attemptMove({ zone: "cascade", index: 0, cardIndex: 5 }, "cascade", 4);
    expect(res.ok).toBe(true);
    expect(view.calls.filter((c) => c === "anim:1").length).toBe(2);
  });

  it("自動移動が無効なら手動分のみ予約される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    app.setAutoMoveEnabled(false);
    app.attemptMove({ zone: "cascade", index: 0, cardIndex: 5 }, "cascade", 4);
    expect(view.calls).toContain("anim:1");
  });

  it("ダブルクリック自動移動では対象カード + 連鎖カードのステップが予約される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    app.dblClickAutoMove({ zone: "cascade", index: 2, cardIndex: 6 });
    // 6S のフリーセル行き + AH + AC のホーム行きで anim:1 が 3 回予約される
    expect(view.calls.filter((c) => c === "anim:1").length).toBe(3);
  });

  it("フリーセル経由の 2 段階移動は手動 → ♠1 → ♠2 の順でステップが組まれる", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1);
    // ♠1(id 3) の上に ♠2(id 7)。♠2 をダブルクリック(フリーセルへ) → ♠1 自動 → ♠2 自動
    app.setBoard({ cascades: [[3, 7]] });
    app.dblClickAutoMove({ zone: "cascade", index: 0, cardIndex: 1 });
    // 手動分(♠2) → 自動(♠1) → 自動(♠2) の順で、各ステップのカードが正しい
    expect(view.animStepsHistory.flat(2)).toEqual([7, 3, 7]);
  });

  it("自動移動ボタンでは送ったカード分だけのステップが予約される", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(12);
    expect(app.autoMoveHome()).toBe(true);
    expect(view.calls).toContain("anim:1");
  });

  it("送るカードがなければアニメーションは予約されない", () => {
    const view = createMockView();
    const deps = createFakeDeps();
    const app = createApp({ view, deps });
    app.startGame(1); // Game #1 は自動移動対象なし
    expect(app.autoMoveHome()).toBe(false);
    expect(view.calls.filter((c) => c.startsWith("anim:"))).toEqual([]);
  });
});
