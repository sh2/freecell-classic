import { describe, it, expect } from "vitest";
import {
  RELEASE_INTERVAL_MS,
  RELEASE_CARD_COUNT,
  INITIAL_VX_MIN,
  INITIAL_VX_MAX,
  INITIAL_VY_MIN,
  INITIAL_VY_MAX,
  GRAVITY,
  FLOOR_RESTITUTION,
  FLOOR_FRICTION,
  WALL_RESTITUTION,
  REST_SPEED,
  STAMP_INTERVAL_MS,
  FIREWORK_COUNT,
  FIREWORK_INTERVAL_MS,
  FIREWORK_DELAY_MS,
  FIREWORK_MARGIN,
  FIREWORK_BURST_LIMIT,
  GRACE_MS,
  CENTER_MARK_MIN_WIDTH,
  buildReleaseSchedule,
  initialVelocity,
  createFlightState,
  stepFlight,
  resolveFloorY,
  fireworkPoint,
} from "../../src/js/victory-cascade.js";

/** スート s・ランク r のカード id */
function cardOf(suit, rank) {
  return { suit, rank, id: (rank - 1) * 4 + suit };
}

/** 1 スート 1 山の完成したホームを作る */
function completedFoundations() {
  const foundations = [];
  for (let suit = 0; suit < 4; suit++) {
    const pile = [];
    for (let rank = 1; rank <= 13; rank++) {
      pile.push(cardOf(suit, rank));
    }
    foundations.push(pile);
  }
  return foundations;
}

describe("victory-cascade 調整用定数", () => {
  it("放出は 70ms 間隔・52 枚", () => {
    expect(RELEASE_INTERVAL_MS).toBe(70);
    expect(RELEASE_CARD_COUNT).toBe(52);
  });

  it("初速・重力・反発・静止条件が仕様どおり", () => {
    expect(INITIAL_VX_MIN).toBe(80);
    expect(INITIAL_VX_MAX).toBe(380);
    expect(INITIAL_VY_MIN).toBe(-780);
    expect(INITIAL_VY_MAX).toBe(-560);
    expect(GRAVITY).toBe(1500);
    expect(FLOOR_RESTITUTION).toBe(0.6);
    expect(FLOOR_FRICTION).toBe(0.88);
    expect(WALL_RESTITUTION).toBe(0.8);
    expect(REST_SPEED).toBe(70);
  });

  it("スタンプ間隔と仕上げ花火の条件が仕様どおり", () => {
    expect(STAMP_INTERVAL_MS).toBe(16);
    expect(FIREWORK_COUNT).toBe(20);
    expect(FIREWORK_INTERVAL_MS).toBe(190);
    expect(FIREWORK_DELAY_MS).toBe(1000);
    expect(FIREWORK_BURST_LIMIT).toBeGreaterThanOrEqual(FIREWORK_COUNT);
    expect(GRACE_MS).toBeGreaterThan(0);
  });

  it("中央マークを描く最小幅はモバイルの非表示条件と一致する", () => {
    expect(CENTER_MARK_MIN_WIDTH).toBeGreaterThan(0);
    expect(CENTER_MARK_MIN_WIDTH).toBeLessThanOrEqual(88);
  });
});

describe("放出順序", () => {
  it("K→A の各ランクでホーム 0→3 をラウンドロビンする", () => {
    const schedule = buildReleaseSchedule(completedFoundations());
    expect(schedule).toHaveLength(52);
    expect(schedule[0]).toMatchObject({ homeIndex: 0, rank: 13, cardId: 48 });
    expect(schedule[1]).toMatchObject({ homeIndex: 1, rank: 13, cardId: 49 });
    expect(schedule[2]).toMatchObject({ homeIndex: 2, rank: 13, cardId: 50 });
    expect(schedule[3]).toMatchObject({ homeIndex: 3, rank: 13, cardId: 51 });
    expect(schedule[4]).toMatchObject({ homeIndex: 0, rank: 12, cardId: 44 });
    expect(schedule[48]).toMatchObject({ homeIndex: 0, rank: 1, cardId: 0 });
    expect(schedule[49]).toMatchObject({ homeIndex: 1, rank: 1, cardId: 1 });
    expect(schedule[50]).toMatchObject({ homeIndex: 2, rank: 1, cardId: 2 });
    expect(schedule[51]).toMatchObject({ homeIndex: 3, rank: 1, cardId: 3 });
    expect(new Set(schedule.map((item) => item.cardId)).size).toBe(52);
  });

  it("山の並び順が違ってもランクで一致するカードを放出する", () => {
    const foundations = completedFoundations().map((pile) => pile.slice().reverse());
    const schedule = buildReleaseSchedule(foundations);
    expect(schedule).toHaveLength(52);
    expect(schedule[0]).toMatchObject({ homeIndex: 0, rank: 13, cardId: 48 });
    expect(schedule[51]).toMatchObject({ homeIndex: 3, rank: 1, cardId: 3 });
  });

  it("空の山は無視する", () => {
    expect(buildReleaseSchedule([])).toHaveLength(0);
    expect(buildReleaseSchedule([[], [], [], []])).toHaveLength(0);
  });
});

describe("初速", () => {
  it("水平は左右ランダムで 80〜380 px/s、垂直は -780〜-560 px/s", () => {
    let sawLeft = false;
    let sawRight = false;
    for (let i = 0; i < 200; i++) {
      const { vx, vy } = initialVelocity();
      expect(Math.abs(vx)).toBeGreaterThanOrEqual(INITIAL_VX_MIN);
      expect(Math.abs(vx)).toBeLessThanOrEqual(INITIAL_VX_MAX);
      expect(vy).toBeGreaterThanOrEqual(INITIAL_VY_MIN);
      expect(vy).toBeLessThanOrEqual(INITIAL_VY_MAX);
      if (vx < 0) {
        sawLeft = true;
      } else {
        sawRight = true;
      }
    }
    expect(sawLeft).toBe(true);
    expect(sawRight).toBe(true);
  });

  it("random を差し替えると決定的になる", () => {
    const seq = [0.0, 0.0, 0.0];
    const values = initialVelocity(() => seq.shift() ?? 0);
    expect(values.vx).toBe(-INITIAL_VX_MIN);
    expect(values.vy).toBe(INITIAL_VY_MIN);
  });
});

describe("飛行の物理", () => {
  const bounds = { left: 0, right: 1000, floor: 1000 };

  function flight(overrides = {}) {
    return createFlightState({
      x: 100,
      y: 100,
      width: 88,
      height: 124,
      vx: 0,
      vy: 0,
      ...overrides,
    });
  }

  it("重力で下向きに加速する", () => {
    const f = flight();
    const result = stepFlight(f, 0.1, bounds);
    expect(result.landed).toBe(false);
    expect(f.vy).toBeCloseTo(GRAVITY * 0.1, 5);
    expect(f.y).toBeCloseTo(100 + f.vy * 0.1, 5);
  });

  it("床で反発し、水平速度を減衰させる", () => {
    const f = flight({ y: 900, vy: 200, vx: 100 });
    const result = stepFlight(f, 0.1, bounds);
    expect(result.landed).toBe(true);
    expect(f.touchedFloor).toBe(true);
    expect(f.y).toBe(bounds.floor - f.height);
    expect(f.vy).toBeCloseTo(-(200 + GRAVITY * 0.1) * FLOOR_RESTITUTION, 5);
    expect(f.vx).toBeCloseTo(100 * FLOOR_FRICTION, 5);
    expect(f.resting).toBe(false);
  });

  it("床接触時に |vy| < 70 なら静止する", () => {
    const f = flight({ y: 900, vy: REST_SPEED - 1, vx: 100 });
    const result = stepFlight(f, 0, bounds);
    expect(result.landed).toBe(true);
    expect(f.resting).toBe(true);
    expect(f.vx).toBe(0);
    expect(f.vy).toBe(0);
  });

  it("左壁・右壁で水平速度を反転して 0.8 倍にする", () => {
    const left = flight({ x: -5, vx: -100 });
    stepFlight(left, 0, bounds);
    expect(left.x).toBe(bounds.left);
    expect(left.vx).toBeCloseTo(100 * WALL_RESTITUTION, 5);

    const right = flight({ x: 995, vx: 100 });
    stepFlight(right, 0, bounds);
    expect(right.x).toBe(bounds.right - right.width);
    expect(right.vx).toBeCloseTo(-100 * WALL_RESTITUTION, 5);
  });

  it("初回の床接触だけ landed=true を返す", () => {
    const f = flight({ y: 900, vy: 200 });
    expect(stepFlight(f, 0, bounds).landed).toBe(true);
    f.y = 900;
    f.vy = 200;
    expect(stepFlight(f, 0, bounds).landed).toBe(false);
  });

  it("静止後は位置も速度も変えない", () => {
    const f = flight({ y: 800 });
    f.resting = true;
    const before = { x: f.x, y: f.y, vx: f.vx, vy: f.vy };
    const result = stepFlight(f, 1, bounds);
    expect(result.landed).toBe(false);
    expect(f.x).toBe(before.x);
    expect(f.y).toBe(before.y);
    expect(f.vx).toBe(before.vx);
    expect(f.vy).toBe(before.vy);
  });
});

describe("地面の位置", () => {
  it("フッター上端があればそこを床にする", () => {
    expect(resolveFloorY(720, 760, 900)).toBe(720);
  });

  it("フッターが取得できなければゲーム盤面の下端へフォールバックする", () => {
    expect(resolveFloorY(null, 760, 900)).toBe(760);
    expect(resolveFloorY(undefined, 760, 900)).toBe(760);
    expect(resolveFloorY(Number.NaN, 760, 900)).toBe(760);
  });

  it("床はビューポート下端を超えない", () => {
    expect(resolveFloorY(950, 980, 900)).toBe(900);
    expect(resolveFloorY(null, 980, 900)).toBe(900);
  });
});

describe("仕上げ花火の位置", () => {
  it("盤面の余白内に収まる", () => {
    const rect = { left: 100, top: 50, width: 600, height: 400 };
    for (let i = 0; i < 100; i++) {
      const point = fireworkPoint(Math.random, rect);
      expect(point.x).toBeGreaterThanOrEqual(rect.left + FIREWORK_MARGIN);
      expect(point.x).toBeLessThanOrEqual(rect.left + rect.width - FIREWORK_MARGIN);
      expect(point.y).toBeGreaterThanOrEqual(rect.top + FIREWORK_MARGIN);
      expect(point.y).toBeLessThanOrEqual(rect.top + rect.height - FIREWORK_MARGIN);
    }
  });

  it("極端に狭い盤面でも NaN にならない", () => {
    const point = fireworkPoint(() => 0.5, { left: 0, top: 0, width: 10, height: 10 });
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
