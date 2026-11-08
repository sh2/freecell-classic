/**
 * E2E テスト用ヘルパー: 効果別のデバッグ情報・待機・オーバーレイ確認。
 */

/** 配布アニメーションのデバッグ情報 (window.__dealDebug) を複製して返す */
export function dealDebug(page) {
  return page.evaluate(() =>
    window.__dealDebug ? JSON.parse(JSON.stringify(window.__dealDebug)) : null
  );
}

/** 配布が始まる(active=true)まで待つ */
export function waitForDealStart(page, timeout = 2000) {
  return page.waitForFunction(
    () => window.__dealDebug && window.__dealDebug.active === true,
    undefined,
    { timeout }
  );
}

/** 配布が終わり、飛行クローン・隠しカードが片付くまで待つ */
export function waitForDealEnd(page, timeout = 4000) {
  return page.waitForFunction(
    () =>
      window.__dealDebug &&
      window.__dealDebug.active === false &&
      document.querySelectorAll("#anim-layer .card").length === 0 &&
      document.querySelectorAll("#game .card.anim-hidden").length === 0,
    undefined,
    { timeout }
  );
}

/* ---------------- 勝利時カスケード (victory cascade) ---------------- */

/** 勝利時カスケードのデバッグ情報 (window.__victoryDebug) を複製して返す */

/** 勝利時カスケードのデバッグ情報 (window.__victoryDebug) を複製して返す */
export function victoryDebug(page) {
  return page.evaluate(() =>
    window.__victoryDebug ? JSON.parse(JSON.stringify(window.__victoryDebug)) : null
  );
}

/** カスケードが始まる(active=true)まで待つ */
export function waitForVictoryStart(page, timeout = 2000) {
  return page.waitForFunction(
    () => window.__victoryDebug && window.__victoryDebug.active === true,
    undefined,
    { timeout }
  );
}

/** カスケードの進行が終わる(active=false)まで待つ。
 *  勝利オーバーレイ表示後も画像(クローン・スタンプ)は残る。 */
export function waitForVictoryEnd(page, timeout = 30000) {
  return page.waitForFunction(
    () =>
      window.__victoryDebug &&
      window.__victoryDebug.active === false &&
      window.__victoryDebug.fires > 0,
    undefined,
    { timeout }
  );
}

/** オーバーレイを閉じた後にカスケード画像が片付くまで待つ */
export function waitForVictoryVisualsCleared(page, timeout = 3000) {
  return page.waitForFunction(
    () => {
      const debug = window.__victoryDebug;
      return (
        debug &&
        debug.visualsRemaining === false &&
        debug.cleared === true &&
        document.querySelectorAll("#anim-layer .card").length === 0 &&
        document.querySelectorAll("#game .card.anim-hidden").length === 0
      );
    },
    undefined,
    { timeout }
  );
}

/** 仕上げ花火が 20 発打ち上がるまで待つ */
export function waitForVictoryFireworks(page, timeout = 25000) {
  return page.waitForFunction(
    () => window.__victoryDebug && window.__victoryDebug.fireworks >= 20,
    undefined,
    { timeout }
  );
}

/** 勝利オーバーレイが表示されているか */
export function overlayVisible(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("overlay");
    return overlay ? !overlay.classList.contains("hidden") : false;
  });
}

/* ---------------- ドラッグの物理 (drag physics) ---------------- */

/** ドラッグ物理のデバッグ情報 (window.__dragDebug) を複製して返す */

/** ドラッグ物理のデバッグ情報 (window.__dragDebug) を複製して返す */
export function dragDebug(page) {
  return page.evaluate(() =>
    window.__dragDebug ? JSON.parse(JSON.stringify(window.__dragDebug)) : null
  );
}

/* ---------------- ヒントの発光 (hint sheen) ---------------- */

/** ヒント発光のデバッグ情報 (window.__hintSheenDebug) を複製して返す */

/** ヒント発光のデバッグ情報 (window.__hintSheenDebug) を複製して返す */
export function hintSheenDebug(page) {
  return page.evaluate(() =>
    window.__hintSheenDebug ? JSON.parse(JSON.stringify(window.__hintSheenDebug)) : null
  );
}

/* ---------------- セル着地エフェクト (landing) ---------------- */

/** セル着地エフェクトのデバッグ情報 (window.__landingFxDebug) を複製して返す */

/** セル着地エフェクトのデバッグ情報 (window.__landingFxDebug) を複製して返す */
export function landingFxDebug(page) {
  return page.evaluate(() =>
    window.__landingFxDebug ? JSON.parse(JSON.stringify(window.__landingFxDebug)) : null
  );
}

/** パーティクル花火の発火回数 (window.__fxDebug.bursts) */
export function fxBursts(page) {
  return page.evaluate(() => (window.__fxDebug ? window.__fxDebug.bursts : -1));
}

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
