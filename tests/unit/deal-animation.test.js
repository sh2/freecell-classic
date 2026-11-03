import { describe, it, expect } from "vitest";
import {
  DEAL_STAGGER_MS,
  DEAL_FLIGHT_MS,
  MAX_DEAL_TOTAL_MS,
  buildDealOrder,
  dealTotalDurationMs,
  dealDelayMs,
  computeDealOrigin,
  dealDebug,
} from "../../src/js/deal-animation.js";

/** 実際のディールと同じ形（列 0〜3 が 7 枚、列 4〜7 が 6 枚）の盤面を作る */
function dealtCascades() {
  return Array.from({ length: 8 }, (_, col) =>
    Array.from({ length: col < 4 ? 7 : 6 }, (_, row) => ({
      id: row * 8 + col,
      suit: col % 4,
      rank: row + 1,
    }))
  );
}

describe("deal-animation 調整用定数", () => {
  it("スタガーは 10〜20ms、飛行は 150〜220ms", () => {
    expect(DEAL_STAGGER_MS).toBeGreaterThanOrEqual(10);
    expect(DEAL_STAGGER_MS).toBeLessThanOrEqual(20);
    expect(DEAL_FLIGHT_MS).toBeGreaterThanOrEqual(150);
    expect(DEAL_FLIGHT_MS).toBeLessThanOrEqual(220);
  });

  it("52 枚の総時間は上限 950ms 以下", () => {
    expect(dealTotalDurationMs(52)).toBeLessThanOrEqual(MAX_DEAL_TOTAL_MS);
    expect(dealTotalDurationMs(52)).toBe(904);
  });
});

describe("配布順（行優先）", () => {
  it("第 1 段は列 0→7、第 2 段も列 0→7 の順に並ぶ", () => {
    const order = buildDealOrder(dealtCascades());
    expect(order).toHaveLength(52);
    expect(order.slice(0, 8).map((item) => item.cardId)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(order.slice(8, 16).map((item) => item.cardId)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(order.slice(48).map((item) => item.cardId)).toEqual([48, 49, 50, 51]);
  });

  it("全 52 枚が一意で、列番号と段（row）が対象カードと一致する", () => {
    const order = buildDealOrder(dealtCascades());
    const ids = order.map((item) => item.cardId);
    expect(new Set(ids).size).toBe(52);
    for (const item of order) {
      expect(item.cardIndex).toBe(item.row);
      expect(item.cardId).toBe(item.row * 8 + item.cascadeIndex);
    }
  });

  it("カード id の配列でも同じ順を作る", () => {
    const byObjects = buildDealOrder(dealtCascades()).map((item) => item.cardId);
    const byIds = buildDealOrder(dealtCascades().map((pile) => pile.map((card) => card.id))).map(
      (item) => item.cardId
    );
    expect(byIds).toEqual(byObjects);
  });

  it("空の列や欠損があっても存在するカードだけを返す", () => {
    const order = buildDealOrder([[{ id: 0 }], [], null, [{ id: 1 }]]);
    expect(order.map((item) => item.cardId)).toEqual([0, 1]);
    expect(buildDealOrder(null)).toEqual([]);
    expect(buildDealOrder([])).toEqual([]);
  });

  it("遅延はインデックス × スタガーで、総時間と整合する", () => {
    for (const index of [0, 1, 10, 51]) {
      expect(dealDelayMs(index)).toBe(index * DEAL_STAGGER_MS);
    }
    expect(dealDelayMs(51) + DEAL_FLIGHT_MS).toBe(dealTotalDurationMs(52));
    expect(dealTotalDurationMs(0)).toBe(0);
  });
});

describe("配布カードの起点位置", () => {
  it("縦はトップ行の上端、横はフリーセル群とホームセル群の隙間の中央", () => {
    const rect = computeDealOrigin({
      topArea: { top: 50, left: 100, width: 800, height: 124 },
      cascadeArea: { top: 196, left: 100, width: 800 },
      game: { top: 20, left: 100, width: 800 },
      freeArea: { left: 100, right: 360, top: 50, height: 124 },
      homeArea: { left: 620, right: 900, top: 50, height: 124 },
      cardWidth: 88,
      cardHeight: 124,
    });
    // 隙間 360〜620 の中心 490 にカード幅 88 の中心を合わせる
    expect(rect).toEqual({ left: 446, top: 50, width: 88, height: 124 });
  });

  it("隙間がカード幅より狭くても隙間の中心に置く", () => {
    const rect = computeDealOrigin({
      topArea: { top: 50, left: 100, width: 800, height: 124 },
      cascadeArea: { top: 196, left: 100, width: 800 },
      game: { top: 20, left: 100, width: 800 },
      freeArea: { left: 100, right: 490, top: 50, height: 124 },
      homeArea: { left: 510, right: 900, top: 50, height: 124 },
      cardWidth: 88,
      cardHeight: 124,
    });
    expect(rect.left).toBe(456); // 中心 500 - 44
    expect(rect.top).toBe(50);
  });

  it("カスケード先頭カードに重なる場合は上へ逃がす", () => {
    const rect = computeDealOrigin({
      topArea: { top: 50, left: 100, width: 800, height: 124 },
      cascadeArea: { top: 150, left: 100, width: 800 },
      game: { top: 20, left: 100, width: 800 },
      freeArea: { left: 100, right: 360, top: 50, height: 124 },
      homeArea: { left: 620, right: 900, top: 50, height: 124 },
      cardWidth: 88,
      cardHeight: 124,
    });
    expect(rect.top + rect.height).toBeLessThanOrEqual(150);
  });

  it("レイアウトが欠けていれば null を返す", () => {
    expect(computeDealOrigin(null)).toBeNull();
    expect(
      computeDealOrigin({
        topArea: null,
        game: { left: 0, width: 800 },
        cardWidth: 88,
        cardHeight: 124,
      })
    ).toBeNull();
    expect(
      computeDealOrigin({
        topArea: { top: 0, height: 124 },
        game: { left: 0, width: 800 },
        cardWidth: 0,
        cardHeight: 124,
      })
    ).toBeNull();
  });
});

describe("デバッグ情報", () => {
  it("E2E が参照するフィールドを持つ", () => {
    for (const key of ["plays", "active", "dealtCount", "skipped", "cardCount", "durationMs"]) {
      expect(dealDebug).toHaveProperty(key);
    }
  });
});
