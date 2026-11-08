import { test, expect } from "@playwright/test";
import * as state from "./helpers/state.js";
import * as effects from "./helpers/effects.js";
import * as canvas from "./helpers/canvas.js";
import * as input from "./helpers/input.js";

const h = { ...state, ...effects, ...canvas, ...input };

test.describe("ソルバー", () => {
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

  /** ソルバー Worker を応答させず、計算中の UI 状態を保つモック */
  async function installHangingWorker(page) {
    await page.addInitScript(() => {
      window.Worker = class HangingWorker {
        constructor() {
          this.onmessage = null;
          this.onerror = null;
        }
        postMessage() {
          // テストが終了するまで結果を返さない
        }
        terminate() {
          // 何もしない
        }
      };
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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
    await h.setBoard(page, h.nearWinBoard());
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

    const flight = await h.averagePixels(page, boxes.flight);
    const still = await h.averagePixels(page, boxes.static);
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

  test("自動解答: 計算中は新規ゲーム系の操作が無効になる", async ({ page }) => {
    await installHangingWorker(page);
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#game.auto-solving")).toBeVisible({ timeout: 2000 });

    await expect(page.locator("#new-game-btn")).toBeDisabled();
    await expect(page.locator("#restart-btn")).toBeDisabled();
    await expect(page.locator("#seed-input")).toBeDisabled();
    await expect(page.locator("#start-game-btn")).toBeDisabled();

    // トグルOFFによる中断はできる
    await page.locator("#auto-solve-toggle").uncheck();
    await expect(page.locator("#game")).not.toHaveClass(/auto-solving/);
  });

  test("自動解答: 計算中は「自動で送る」トグルが無効になる", async ({ page }) => {
    await installHangingWorker(page);
    await h.openGame(page, 1);
    await h.setBoard(page, h.nearWinBoard());
    await expect(page.locator("#auto-move-toggle")).toBeEnabled();

    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#game.auto-solving")).toBeVisible({ timeout: 2000 });

    await expect(page.locator("#auto-move-toggle")).toBeDisabled();
    // 自動解答トグルは OFF でキャンセルできるよう有効のまま
    await expect(page.locator("#auto-solve-toggle")).toBeEnabled();

    await page.locator("#auto-solve-toggle").uncheck();
    await expect(page.locator("#auto-move-toggle")).toBeEnabled();
  });

  test("自動解答: 終了後に「自動で送る」の設定が復元される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, false);
    await h.setBoard(page, h.nearWinBoard());

    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });

    // 開始時に false だった設定が、勝利で終了した後も false のまま
    await expect(page.locator("#auto-move-toggle")).not.toBeChecked();
    await expect(page.locator("#auto-solve-toggle")).not.toBeChecked();
  });

  test("自動解答: 終了後に「自動で送る」がONのまま復元される", async ({ page }) => {
    await h.openGame(page, 1);
    await h.setAutoMove(page, true);
    await h.setBoard(page, h.nearWinBoard());

    await page.locator("#auto-solve-toggle").check();
    await expect(page.locator("#overlay")).toBeVisible({ timeout: 10000 });

    // 開始時に true だった設定が、勝利で終了した後も true のまま
    await expect(page.locator("#auto-move-toggle")).toBeChecked();
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
