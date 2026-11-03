/**
 * E2E テスト用ヘルパー。
 *
 * 内部状態へのアクセスは `main.js` から公開されるテスト API へ集約している。
 * `main.js` はページ読み込み時に `<script type="module">` で既に実行済みのため、
 * 同じ URL を dynamic import するとモジュールキャッシュが働き、`init()` は
 * 二重実行されない。テスト本体はこのファイルの関数だけを使う。
 */

/**
 * ページを開き、ヘルパーを注入して指定ゲーム番号で開始する。
 */
export async function openGame(page, gameNumber) {
  await page.goto("/");
  await injectPageHelpers(page);
  await page.evaluate((n) => window.__testApi.startGame(n), gameNumber);
}

/**
 * 公開テスト API とクリック/ドラッグ用の座標探索ヘルパーをページへ注入する。
 * (座標探索は既存スキルで検証済みの elementFromPoint 走査をそのまま利用)
 */
export async function injectPageHelpers(page) {
  await page.evaluate(async () => {
    const main = await import("./src/js/main.js");
    window.__testApi = main.getTestApi();
    // E2E は「操作直後に DOM が完成している」前提の検証が多いので、
    // カード移動アニメーションは無効化しておく(必要なテストは個別に有効化する)
    window.__testApi.setAnimationsEnabled(false);
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

/** 移動アニメーションの完了を待つ(飛行クローン・隠しカードがなくなったら解決) */
export function waitForAnimationsDone(page, timeout = 3000) {
  return page.waitForFunction(
    () =>
      document.querySelectorAll("#anim-layer .card").length === 0 &&
      document.querySelectorAll("#game .card.anim-hidden").length === 0,
    undefined,
    { timeout }
  );
}

/* ---------------- ドラッグの物理 (drag physics) ---------------- */

/** ドラッグ物理のデバッグ情報 (window.__dragDebug) を複製して返す */
export function dragDebug(page) {
  return page.evaluate(() =>
    window.__dragDebug ? JSON.parse(JSON.stringify(window.__dragDebug)) : null
  );
}

/* ---------------- ヒントの発光 (hint sheen) ---------------- */

/** ヒント発光のデバッグ情報 (window.__hintSheenDebug) を複製して返す */
export function hintSheenDebug(page) {
  return page.evaluate(() =>
    window.__hintSheenDebug ? JSON.parse(JSON.stringify(window.__hintSheenDebug)) : null
  );
}

/* ---------------- パーティクル花火 (fx) ---------------- */

/** パーティクル花火の発火回数 (window.__fxDebug.bursts) */
export function fxBursts(page) {
  return page.evaluate(() => (window.__fxDebug ? window.__fxDebug.bursts : -1));
}

/** #fx-canvas 上の不透明ピクセル数 */
export function fxPixelCount(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("fx-canvas");
    if (!canvas) {
      return 0;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return 0;
    }
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        count++;
      }
    }
    return count;
  });
}

/** #fx-canvas に不透明ピクセルが現れるまで待つ */
export function waitForFxPixels(page, timeout = 2000) {
  return page.waitForFunction(
    () => {
      const canvas = document.getElementById("fx-canvas");
      if (!canvas) {
        return false;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return false;
      }
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          return true;
        }
      }
      return false;
    },
    undefined,
    { timeout }
  );
}

/**
 * 花火の彩色ピクセル（彩度 = max(R,G,B)-min(R,G,B)）をサンプリングし、
 * ピーク時の彩色ピクセル数と、最大のバウンディングボックスを記録する。
 * 白地・緑地のどちらとも区別できる色かどうかを彩度で判定する。
 */
export function startFxColorSampler(page, minAlpha = 16, minSaturation = 60, durationMs = 1400) {
  return page.evaluate(
    ([alphaMin, saturationMin, duration]) => {
      const canvas = document.getElementById("fx-canvas");
      window.__fxColorMetrics = {
        peakCount: 0,
        peakWidth: 0,
        peakHeight: 0,
        maxWidth: 0,
        maxHeight: 0,
        frames: 0,
      };
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      const started = performance.now();
      const sample = () => {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < alphaMin) {
            continue;
          }
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.max(r, g, b) - Math.min(r, g, b) < saturationMin) {
            continue;
          }
          count++;
          const p = i / 4;
          const x = p % canvas.width;
          const y = Math.floor(p / canvas.width);
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (y < minY) {
            minY = y;
          }
          if (y > maxY) {
            maxY = y;
          }
        }
        const width = count > 0 ? maxX - minX + 1 : 0;
        const height = count > 0 ? maxY - minY + 1 : 0;
        const m = window.__fxColorMetrics;
        m.frames++;
        if (count > m.peakCount) {
          m.peakCount = count;
          m.peakWidth = width;
          m.peakHeight = height;
        }
        if (width > m.maxWidth) {
          m.maxWidth = width;
        }
        if (height > m.maxHeight) {
          m.maxHeight = height;
        }
        if (performance.now() - started < duration) {
          window.requestAnimationFrame(sample);
        }
      };
      window.requestAnimationFrame(sample);
    },
    [minAlpha, minSaturation, durationMs]
  );
}

/** startFxColorSampler() が記録した彩色ピクセル数とバウンディングボックス */
export function fxColorMetrics(page) {
  return page.evaluate(() => window.__fxColorMetrics ?? null);
}

/** 可視ピクセル全体の bounding box から花火の直径を測るサンプラー */
export function startFxDiameterSampler(page, minAlpha = 1, durationMs = 1400) {
  return startFxColorSampler(page, minAlpha, 0, durationMs);
}

/** startFxDiameterSampler() が記録した直径メトリクス */
export function fxDiameterMetrics(page) {
  return fxColorMetrics(page);
}

/** 現在のフレームの彩色ピクセルの重心 (canvas 座標 = CSS px) */
export function fxColorCentroid(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("fx-canvas");
    if (!canvas) {
      return { count: 0, x: 0, y: 0 };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { count: 0, x: 0, y: 0 };
    }
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) {
        continue;
      }
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 60) {
        continue;
      }
      const p = i / 4;
      sumX += p % canvas.width;
      sumY += Math.floor(p / canvas.width);
      count++;
    }
    return count > 0 ? { count, x: sumX / count, y: sumY / count } : { count: 0, x: 0, y: 0 };
  });
}

/** 直近のバーストに適用された scale (狭い画面ほど 1 未満) */
export function fxLastScale(page) {
  return page.evaluate(() => (window.__fxDebug ? window.__fxDebug.lastScale : null));
}

/** 直近のバーストの色 */
export function fxLastColor(page) {
  return page.evaluate(() => (window.__fxDebug ? window.__fxDebug.lastColor : null));
}

/** 現在のゴースト（残像）数 */
export function fxTrailCount(page) {
  return page.evaluate(() => (window.__fxDebug ? window.__fxDebug.trails : 0));
}

/**
 * 花火中心からの半径分布をサンプリングする。ピーク時の彩色ピクセル数、
 * 中心から半径 30% 以内の彩色ピクセル比率、最大半径、bbox を記録する。
 */
export function startFxDistributionSampler(
  page,
  originX,
  originY,
  minAlpha = 16,
  minSaturation = 60,
  durationMs = 1400
) {
  return page.evaluate(
    ([ox, oy, alphaMin, saturationMin, duration]) => {
      const canvas = document.getElementById("fx-canvas");
      window.__fxDistributionMetrics = {
        peakCount: 0,
        peakCenterCount: 0,
        peakCenterRatio: 0,
        peakOuterCount: 0,
        peakOuterRatio: 0,
        peakRadius: 0,
        maxWidth: 0,
        maxHeight: 0,
        frames: 0,
      };
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      const started = performance.now();
      const sample = () => {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const xs = [];
        const ys = [];
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < alphaMin) {
            continue;
          }
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.max(r, g, b) - Math.min(r, g, b) < saturationMin) {
            continue;
          }
          const p = i / 4;
          const x = p % canvas.width;
          const y = Math.floor(p / canvas.width);
          xs.push(x);
          ys.push(y);
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (y < minY) {
            minY = y;
          }
          if (y > maxY) {
            maxY = y;
          }
        }
        const count = xs.length;
        let maxRadius = 0;
        for (let i = 0; i < count; i++) {
          const d = Math.hypot(xs[i] - ox, ys[i] - oy);
          if (d > maxRadius) {
            maxRadius = d;
          }
        }
        let centerCount = 0;
        let outerCount = 0;
        if (maxRadius > 0) {
          for (let i = 0; i < count; i++) {
            const d = Math.hypot(xs[i] - ox, ys[i] - oy);
            if (d <= maxRadius * 0.3) {
              centerCount++;
            }
            if (d >= maxRadius * 0.7 && d <= maxRadius * 1.05) {
              outerCount++;
            }
          }
        }
        const m = window.__fxDistributionMetrics;
        m.frames++;
        if (count > m.peakCount) {
          m.peakCount = count;
          m.peakCenterCount = centerCount;
          m.peakCenterRatio = count > 0 ? centerCount / count : 0;
          m.peakOuterCount = outerCount;
          m.peakOuterRatio = count > 0 ? outerCount / count : 0;
          m.peakRadius = maxRadius;
        }
        const width = count > 0 ? maxX - minX + 1 : 0;
        const height = count > 0 ? maxY - minY + 1 : 0;
        if (width > m.maxWidth) {
          m.maxWidth = width;
        }
        if (height > m.maxHeight) {
          m.maxHeight = height;
        }
        if (performance.now() - started < duration) {
          window.requestAnimationFrame(sample);
        }
      };
      window.requestAnimationFrame(sample);
    },
    [originX, originY, minAlpha, minSaturation, durationMs]
  );
}

/** startFxDistributionSampler() が記録した半径分布メトリクス */
export function fxDistributionMetrics(page) {
  return page.evaluate(() => window.__fxDistributionMetrics ?? null);
}

/**
 * 空気抵抗による広がりの減速と、燃え尽きによる輝度低下を計測する。
 * bbox 幅を 150ms / 400ms / 900ms 時点で記録し、彩色ピクセルの
 * alpha 加重平均輝度のピークと後半（800ms 以降）を記録する。
 */
export function startFxTimelineSampler(page, minAlpha = 16, minSaturation = 60, durationMs = 1400) {
  return page.evaluate(
    ([alphaMin, saturationMin, duration]) => {
      const canvas = document.getElementById("fx-canvas");
      window.__fxTimelineMetrics = {
        widthAt150: 0,
        widthAt400: 0,
        widthAt900: 0,
        peakMeanLuma: 0,
        peakMeanLumaAt: 0,
        lateMeanLuma: 0,
        lateMeanR: 0,
        lateMeanG: 0,
        lateMeanB: 0,
        frames: 0,
      };
      if (!canvas) {
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      const started = performance.now();
      const sample = () => {
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        let lumaSum = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < alphaMin) {
            continue;
          }
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.max(r, g, b) - Math.min(r, g, b) < saturationMin) {
            continue;
          }
          count++;
          const p = i / 4;
          const x = p % canvas.width;
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          const weight = alpha / 255;
          lumaSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * weight;
          rSum += r * weight;
          gSum += g * weight;
          bSum += b * weight;
        }
        const width = count > 0 ? maxX - minX + 1 : 0;
        const meanLuma = count > 0 ? lumaSum / count : 0;
        const m = window.__fxTimelineMetrics;
        const elapsed = performance.now() - started;
        m.frames++;
        if (count > 0 && elapsed >= 150 && m.widthAt150 === 0) {
          m.widthAt150 = width;
        }
        if (count > 0 && elapsed >= 400 && m.widthAt400 === 0) {
          m.widthAt400 = width;
        }
        if (count > 0 && elapsed >= 900 && m.widthAt900 === 0) {
          m.widthAt900 = width;
        }
        if (count > 0 && elapsed >= 800 && m.lateMeanLuma === 0) {
          m.lateMeanLuma = meanLuma;
          m.lateMeanR = rSum / count;
          m.lateMeanG = gSum / count;
          m.lateMeanB = bSum / count;
        }
        if (meanLuma > m.peakMeanLuma) {
          m.peakMeanLuma = meanLuma;
          m.peakMeanLumaAt = elapsed;
        }
        if (performance.now() - started < duration) {
          window.requestAnimationFrame(sample);
        }
      };
      window.requestAnimationFrame(sample);
    },
    [minAlpha, minSaturation, durationMs]
  );
}

/** startFxTimelineSampler() が記録した広がり・輝度のタイムライン */
export function fxTimelineMetrics(page) {
  return page.evaluate(() => window.__fxTimelineMetrics ?? null);
}

/* ---------------- 飛行タイムライン(アニメーション検証用) ---------------- */

/**
 * 移動アニメーションの飛行タイムライン記録を開始する。
 * - `#anim-layer` へのカード追加(クローンの出現)を座標つきで記録する
 * - 実カードの `.anim-hidden` 遷移(隠蔽/再表示)を記録する
 * 記録内容は stopFlightTimeline() で取得する。各イベントの形:
 *   { kind: "clone" | "hidden" | "shown", card: number, left?: number, top?: number }
 */
export async function startFlightTimeline(page) {
  await page.evaluate(() => {
    window.__flightEvents = [];
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            const isClone =
              n.nodeType === 1 &&
              n.classList &&
              n.classList.contains("card") &&
              n.parentElement &&
              n.parentElement.id === "anim-layer";
            if (isClone) {
              const r = n.getBoundingClientRect();
              window.__flightEvents.push({
                kind: "clone",
                card: Number(n.dataset.cardId),
                left: Math.round(r.left),
                top: Math.round(r.top),
              });
            }
          }
        }
        if (m.type === "attributes" && m.attributeName === "class") {
          const el = m.target;
          const isGameCard =
            el.nodeType === 1 &&
            el.classList &&
            el.classList.contains("card") &&
            el.closest &&
            el.closest("#game");
          if (isGameCard) {
            const wasHidden = String(m.oldValue || "").split(/\s+/).includes("anim-hidden");
            const isHidden = el.classList.contains("anim-hidden");
            if (wasHidden !== isHidden) {
              window.__flightEvents.push({
                kind: isHidden ? "hidden" : "shown",
                card: Number(el.dataset.cardId),
              });
            }
          }
        }
      }
    });
    mo.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
      subtree: true,
      childList: true,
    });
    window.__flightMo = mo;
  });
}

/** 飛行タイムラインの記録を停止し、イベント列を返す */
export function stopFlightTimeline(page) {
  return page.evaluate(() => {
    if (window.__flightMo) {
      window.__flightMo.disconnect();
      window.__flightMo = null;
    }
    return window.__flightEvents || [];
  });
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
