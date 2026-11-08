/**
 * E2E テスト用ヘルパー: クリック・ドラッグ操作の座標入力。
 */

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

/** 盤面中央の座標(配布・カスケードのクリック用) */
export async function gameCenter(page) {
  const box = await page.locator("#game").boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
