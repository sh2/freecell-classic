/**
 * E2E テスト用ヘルパー: canvas のピクセル計測と待機。
 */

/** 指定した 1 枚の canvas 上の不透明ピクセル数 */
function canvasPixelCount(page, id) {
  return page.evaluate((canvasId) => {
    const canvas = document.getElementById(canvasId);
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
  }, id);
}

/** #stamp-canvas 上の不透明ピクセル数 */
export function stampPixelCount(page) {
  return canvasPixelCount(page, "stamp-canvas");
}

/** #trail-canvas 上の不透明ピクセル数 */
export function trailPixelCount(page) {
  return canvasPixelCount(page, "trail-canvas");
}

/** 小破裂用キャンバス群 (.landing-burst-canvas) 上の不透明ピクセル数 */
export function landingFxPixelCount(page) {
  return page.evaluate(() => {
    let total = 0;
    for (const canvas of document.querySelectorAll(".landing-burst-canvas")) {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        continue;
      }
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
          total++;
        }
      }
    }
    return total;
  });
}

/** 小破裂用キャンバス群に不透明ピクセルが現れるまで待つ */
export function waitForLandingFxPixels(page, timeout = 2000) {
  return page.waitForFunction(
    () => {
      for (const canvas of document.querySelectorAll(".landing-burst-canvas")) {
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          continue;
        }
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0) {
            return true;
          }
        }
      }
      return false;
    },
    undefined,
    { timeout }
  );
}

/* ---------------- パーティクル花火 (fx) ---------------- */

/** #fx-canvas 上の不透明ピクセル数 */
export function fxPixelCount(page) {
  return canvasPixelCount(page, "fx-canvas");
}

/** スクリーンショットの矩形内の平均色と平均輝度 (Rec.709) */
export async function averagePixels(page, box) {
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
