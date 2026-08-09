/**
 * E2E テスト用ヘルパー。
 *
 * Phase 1 では game.js がクラシックスクリプトのため、`page.evaluate` 内から
 * トップレベルの識別子(`cascades`、`startGame`、`attemptMove` など)を直接参照できる。
 * このファイルに内部状態へのアクセスを集約しておき、ESM 移行後は公開テスト API へ
 * 差し替えるだけでテスト本体の書き換えを最小にする。
 */

/**
 * ページを開き、ヘルパーを注入して指定ゲーム番号で開始する。
 */
export async function openGame(page, gameNumber) {
  await page.goto("/");
  await injectPageHelpers(page);
  await page.evaluate((n) => startGame(n), gameNumber);
}

/**
 * クリック/ドラッグ用の座標探索ヘルパーをページへ注入する。
 * (既存スキルで検証済みの elementFromPoint 走査をそのまま利用)
 */
export async function injectPageHelpers(page) {
  await page.evaluate(() => {
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
  });
}

/* ---------------- 状態の取得 ---------------- */

/**
 * 内部状態のスナップショット。カードは id(0〜51)の配列で返す。
 * - id % 4 がスート(0=♣, 1=♦, 2=♥, 3=♠)、Math.floor(id / 4) + 1 がランク。
 */
export function state(page) {
  return page.evaluate(() => ({
    gameNumber,
    cascades: cascades.map((p) => p.map((c) => c.id)),
    freeCells: freeCells.map((c) => (c ? c.id : null)),
    foundations: foundations.map((p) => p.map((c) => c.id)),
    moveCount,
    historyLength: historyStack.length,
    selected: selected
      ? { zone: selected.zone, index: selected.index, cardIndex: selected.cardIndex ?? null }
      : null,
    won,
  }));
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
  return page.evaluate(() => timerStart !== null && timerHandle !== null && !won);
}

/* ---------------- 内部関数・状態の直接利用 ---------------- */

/** 移動可能枚数の計算(内部の maxMovable をそのまま呼ぶ) */
export function maxMovable(page, destCascadeIndex) {
  return page.evaluate((i) => maxMovable(i), destCascadeIndex);
}

/**
 * 盤面を直接書き換える。各ゾーンはカード id の配列(または null)で指定する。
 * 指定が不足したゾーンは空(null)で埋め、8 列・4 フリーセル・4 ホームの
 * 形式に正規化する。履歴・選択はクリアし、`won` を false にして render() まで行う。
 */
export function setBoard(page, board) {
  return page.evaluate((b) => {
    const card = (id) => ({ suit: id % 4, rank: Math.floor(id / 4) + 1, id });
    cascades = Array.from({ length: NUM_CASCADES }, (_, i) => (b.cascades[i] ?? []).map(card));
    freeCells = Array.from({ length: NUM_FREE }, (_, i) => {
      const id = b.freeCells?.[i] ?? null;
      return id === null ? null : card(id);
    });
    foundations = Array.from({ length: NUM_HOME }, (_, i) => (b.foundations[i] ?? []).map(card));
    moveCount = b.moveCount ?? 0;
    historyStack = [];
    selected = null;
    won = false;
    render();
  }, board);
}

/** 全カードをホームに揃えた勝利盤面にして checkWin() まで実行する */
export function setWinBoard(page, moveCount = 52) {
  return page.evaluate((moves) => {
    const card = (id) => ({ suit: id % 4, rank: Math.floor(id / 4) + 1, id });
    cascades = Array.from({ length: NUM_CASCADES }, () => []);
    freeCells = Array(NUM_FREE).fill(null);
    foundations = [];
    for (let s = 0; s < 4; s++) {
      const pile = [];
      for (let r = 1; r <= 13; r++) {
        pile.push(card((r - 1) * 4 + s));
      }
      foundations.push(pile);
    }
    moveCount = moves;
    historyStack = [];
    selected = null;
    won = false;
    render();
    checkWin();
  }, moveCount);
}

/* ---------------- 操作の再現 ---------------- */

/** カードにヒットする座標を返す(完全に隠れていれば例外) */
export async function clickPoint(page, cardId) {
  const point = await page.evaluate((id) => window.__clickPoint(id), cardId);
  if (!point) {
    throw new Error(`カード #${cardId} のクリック可能な座標が見つかりません`);
  }
  return point;
}

/** スロット中心の座標を返す。zone は "free" | "home" | "cascade" */
export async function slotPoint(page, zone, index) {
  const selector =
    zone === "free"
      ? "#free-cells .slot"
      : zone === "home"
        ? "#home-cells .slot"
        : "#game .cascade .slot";
  const point = await page.evaluate(([sel, i]) => window.__slotPoint(sel, i), [selector, index]);
  if (!point) {
    throw new Error(`スロット ${zone}[${index}] が見つかりません`);
  }
  return point;
}

/** カードをクリックする(選択・移動先指定に使う) */
export async function clickCard(page, cardId) {
  const point = await clickPoint(page, cardId);
  await page.mouse.click(point.x, point.y);
}

/** スロットをクリックする */
export async function clickSlot(page, zone, index) {
  const point = await slotPoint(page, zone, index);
  await page.mouse.click(point.x, point.y);
}

/** 同じカードを 400ms 以内に 2 回クリックする(ダブルクリック自動移動) */
export async function dblClickCard(page, cardId) {
  const point = await clickPoint(page, cardId);
  await page.mouse.dblclick(point.x, point.y);
}

/**
 * カードをドラッグ&ドロップする。起点はグループの最上位(見えている)カードを指定する。
 * 6px 閾値を確実に超えるため、まず水平方向へ 40px 移動してから目的地へ運ぶ。
 */
export async function dragCard(page, fromCardId, toPoint) {
  const from = await clickPoint(page, fromCardId);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y, { steps: 5 });
  await page.mouse.move(toPoint.x, toPoint.y, { steps: 10 });
  await page.mouse.up();
}

/** カードをスロットへドラッグ&ドロップする */
export async function dragCardToSlot(page, fromCardId, zone, index) {
  const to = await slotPoint(page, zone, index);
  await dragCard(page, fromCardId, to);
}
