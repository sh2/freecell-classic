/**
 * E2E テスト用ヘルパー: 状態・公開テスト API・盤面 fixture。
 */

/**
 * ページを開き、ヘルパーを注入して指定ゲーム番号で開始する。
 * options.disableAnimations を false にすると、ヘルパーによる
 * アニメーション無効化を行わない(OS の reduced-motion を検証する用)。
 */
export async function openGame(page, gameNumber, options = {}) {
  await page.goto("/");
  await injectPageHelpers(page, options);
  await page.evaluate((n) => window.__testApi.startGame(n), gameNumber);
}

/**
 * 公開テスト API とクリック/ドラッグ用の座標探索ヘルパーをページへ注入する。
 * (座標探索は既存スキルで検証済みの elementFromPoint 走査をそのまま利用)
 */
export async function injectPageHelpers(
  page,
  { disableAnimations = true } = {}
) {
  await page.evaluate(async (shouldDisableAnimations) => {
    const main = await import("./src/js/main.js");
    window.__testApi = main.getTestApi();
    // E2E は「操作直後に DOM が完成している」前提の検証が多いので、
    // カード移動アニメーションは無効化しておく(必要なテストは個別に有効化する)
    if (shouldDisableAnimations) {
      window.__testApi.setAnimationsEnabled(false);
    }
    window.__clickPoint = function (cardId) {
      const el = document.querySelector(`#game .card[data-card-id="${cardId}"]`);
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      for (let fy = 0.04; fy <= 0.9; fy += 0.12) {
        for (let fx = 0.2; fx <= 0.8; fx += 0.3) {
          const x = r.left + r.width * fx;
          const y = r.top + r.height * fy;
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.closest && hit.closest(`.card[data-card-id="${cardId}"]`)) {
            return { x, y };
          }
        }
      }
      return null;
    };
    window.__slotPoint = function (selector, index) {
      const el = document.querySelectorAll(selector)[index];
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
  }, disableAnimations);
}

/* ---------------- 状態の取得 ---------------- */

/**
 * 内部状態のスナップショット(テスト API の読み取り専用スナップショット)。
 * カードは id(0〜51)の配列で返す。
 * - id % 4 がスート(0=♣, 1=♦, 2=♥, 3=♠)、Math.floor(id / 4) + 1 がランク。
 */

/**
 * 内部状態のスナップショット(テスト API の読み取り専用スナップショット)。
 * カードは id(0〜51)の配列で返す。
 * - id % 4 がスート(0=♣, 1=♦, 2=♥, 3=♠)、Math.floor(id / 4) + 1 がランク。
 */
export function state(page) {
  return page.evaluate(() => window.__testApi.snapshot());
}

/** DOM から見た盤面のスナップショット(描画と状態の一致確認用) */
export function domState(page) {
  return page.evaluate(() => ({
    movesText: document.getElementById("move-counter").textContent,
    selected: [...document.querySelectorAll("#game .card.selected")].map((e) => Number(e.dataset.cardId)),
    free: [...document.querySelectorAll("#free-cells .slot")].map((s) => {
      const c = s.querySelector(".card");
      return c ? Number(c.dataset.cardId) : null;
    }),
    home: [...document.querySelectorAll("#home-cells .slot")].map((s) => {
      const c = s.querySelector(".card");
      return c ? Number(c.dataset.cardId) : null;
    }),
    cascadeLengths: [...document.querySelectorAll("#game .cascade")].map((c) => c.querySelectorAll(".card").length),
  }));
}

/** タイマーが動いているか(最初の成功手以降・停止時は false) */
export function timerRunning(page) {
  return page.evaluate(() => window.__testApi.snapshot().timerRunning);
}

/* ---------------- 内部関数・状態の直接利用 ---------------- */

/** 移動可能枚数の計算(テスト API の maxMovable をそのまま呼ぶ) */

/** 移動可能枚数の計算(テスト API の maxMovable をそのまま呼ぶ) */
export function maxMovable(page, destCascadeIndex) {
  return page.evaluate((i) => window.__testApi.maxMovable(i), destCascadeIndex);
}

/**
 * 盤面を直接書き換える。各ゾーンはカード id の配列(または null)で指定する。
 * 指定が不足したゾーンは空(null)で埋め、8 列・4 フリーセル・4 ホームの
 * 形式に正規化する。カードの一意性と各ゾーンの形式はテスト API 側で検証され、
 * 不正な fixture はエラーになる。履歴・選択はクリアし、`won` を false にして
 * render() まで行う。
 */
export function setBoard(page, board) {
  return page.evaluate((b) => window.__testApi.setBoard(b), board);
}

/** 全カードをホームに揃えた勝利盤面にして checkWin() まで実行する */
export function setWinBoard(page, moveCount = 52) {
  return page.evaluate((moves) => window.__testApi.setWinBoard(moves), moveCount);
}

/** 毎手の自動移動をオン/オフする(トグル状態も同期される) */
export function setAutoMove(page, enabled) {
  return page.evaluate((v) => window.__testApi.setAutoMoveEnabled(v), enabled);
}

/** 解法キャッシュの状態({ active, remainingMoves })を取得する */
export function solverCacheInfo(page) {
  return page.evaluate(() => window.__testApi.solverCacheInfo());
}

/** カード移動アニメーションをオン/オフする(既定ではヘルパー注入時に無効化済み) */
export function setAnimations(page, enabled) {
  return page.evaluate((v) => window.__testApi.setAnimationsEnabled(v), enabled);
}

/** 移動アニメーションの完了を待つ(飛行クローン・隠しカードがなくなったら解決)。
 *  勝利時カスケードのクローンと、演出中に隠れるホームの実カードは対象外。 */
export function waitForAnimationsDone(page, timeout = 3000) {
  return page.waitForFunction(
    () =>
      document.querySelectorAll("#anim-layer .card:not(.victory-clone)").length === 0 &&
      [...document.querySelectorAll("#game .card.anim-hidden")].filter(
        (el) => !el.closest("#home-cells")
      ).length === 0,
    undefined,
    { timeout }
  );
}

/* ---------------- 配布アニメーション (deal animation) ---------------- */

/** 指定ゲーム番号で開始する(アニメーション設定は呼び出し側で決める) */

/** 指定ゲーム番号で開始する(アニメーション設定は呼び出し側で決める) */
export function startGame(page, gameNumber) {
  return page.evaluate((n) => window.__testApi.startGame(n), gameNumber);
}

/** あと 1 手で勝利する盤面(♠K がフリーセル、♠ は A〜Q までホーム) */
export function nearWinBoard() {
  const pile = (suit) => Array.from({ length: 13 }, (_, r) => r * 4 + suit);
  return {
    cascades: Array.from({ length: 8 }, () => []),
    freeCells: [null, null, null, 51],
    foundations: [pile(0), pile(1), pile(2), pile(3).slice(0, 12)],
  };
}
