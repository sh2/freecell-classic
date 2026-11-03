import { describe, it, expect } from "vitest";
import {
  MAX_TILT_DEG,
  TILT_FULL_SPEED,
  SPRING_STIFFNESS,
  SPRING_DEPTH_FALLOFF,
  MAX_LAG_BASE_PX,
  MAX_LAG_STEP_PX,
  MAX_LAG_CAP_PX,
  SETTLED_EPSILON_PX,
  tiltFromVelocity,
  stiffnessForDepth,
  dampingForDepth,
  maxLagForDepth,
  stepSpring,
  createDragPhysics,
} from "../../src/js/drag-physics.js";

describe("drag-physics 調整用定数", () => {
  it("最大傾きは 5 度、最大傾きになる速度は 1500px/s", () => {
    expect(MAX_TILT_DEG).toBe(5);
    expect(TILT_FULL_SPEED).toBe(1500);
  });

  it("バネは深いほど柔らかく、オフセット上限は深いほど大きい", () => {
    expect(stiffnessForDepth(1)).toBe(SPRING_STIFFNESS);
    expect(stiffnessForDepth(2)).toBeLessThan(stiffnessForDepth(1));
    expect(stiffnessForDepth(8)).toBeLessThan(stiffnessForDepth(2));
    expect(maxLagForDepth(1)).toBe(MAX_LAG_BASE_PX);
    expect(maxLagForDepth(2)).toBeGreaterThan(maxLagForDepth(1));
    expect(maxLagForDepth(99)).toBe(MAX_LAG_CAP_PX);
  });
});

describe("傾きの写像", () => {
  it("速度 0 では 0 度", () => {
    expect(tiltFromVelocity(0)).toBe(0);
  });

  it("右向きは正、左向きは負", () => {
    expect(tiltFromVelocity(300)).toBeGreaterThan(0);
    expect(tiltFromVelocity(-300)).toBeLessThan(0);
  });

  it("速度に比例し、±MAX_TILT_DEG でクランプされる", () => {
    expect(tiltFromVelocity(TILT_FULL_SPEED / 2)).toBeCloseTo(MAX_TILT_DEG / 2, 5);
    expect(tiltFromVelocity(TILT_FULL_SPEED)).toBeCloseTo(MAX_TILT_DEG, 5);
    expect(tiltFromVelocity(TILT_FULL_SPEED * 10)).toBe(MAX_TILT_DEG);
    expect(tiltFromVelocity(-TILT_FULL_SPEED * 10)).toBe(-MAX_TILT_DEG);
  });

  it("非有限値は 0 度", () => {
    expect(tiltFromVelocity(NaN)).toBe(0);
    expect(tiltFromVelocity(Infinity)).toBe(0);
  });
});

describe("バネ追随", () => {
  it("減衰係数は深さに応じて下がる", () => {
    expect(dampingForDepth(2)).toBeLessThan(dampingForDepth(1));
  });

  it("stepSpring は引数を変更しない", () => {
    const state = { x: 3, y: -2, vx: 0, vy: 0 };
    const next = stepSpring(state, 1, 1 / 240);
    expect(state).toEqual({ x: 3, y: -2, vx: 0, vy: 0 });
    expect(next).not.toBe(state);
    expect(Math.abs(next.x)).toBeLessThan(Math.abs(state.x));
  });

  it("十分な時間で遅れが 0 に収束する", () => {
    const physics = createDragPhysics(5);
    physics.moveBy(40, 24, 100, 1000);
    physics.tick(1 / 60, 1016);
    const moved = physics.getState();
    expect(Math.abs(moved.offsets[1].x)).toBeGreaterThan(0);

    for (let i = 0; i < 240; i++) {
      physics.tick(1 / 60, 1032 + i * (1000 / 60));
    }
    const settled = physics.getState();
    for (const offset of settled.offsets) {
      expect(Math.abs(offset.x)).toBeLessThan(SETTLED_EPSILON_PX);
      expect(Math.abs(offset.y)).toBeLessThan(SETTLED_EPSILON_PX);
    }
    expect(Math.abs(settled.tilt)).toBeLessThan(0.001);
    expect(physics.isSettled()).toBe(true);
  });

  it("同じ移動では深いカードほど遅れが大きい", () => {
    const physics = createDragPhysics(6);
    physics.moveBy(40, 0, 100, 1000);
    physics.tick(1 / 60, 1016);
    const offsets = physics.getState().offsets;
    for (let i = 2; i < offsets.length; i++) {
      expect(Math.abs(offsets[i].x)).toBeGreaterThanOrEqual(
        Math.abs(offsets[i - 1].x) - 1e-9
      );
    }
  });

  it("先頭カードの遅れは常に 0", () => {
    const physics = createDragPhysics(4);
    physics.moveBy(80, 30, 200, 1000);
    physics.tick(1 / 60, 1016);
    expect(physics.getState().offsets[0]).toEqual({ x: 0, y: 0 });
  });

  it("release で傾きが即座に 0 になり、遅れは収束する", () => {
    const physics = createDragPhysics(4);
    physics.moveBy(30, 0, 100, 1000);
    physics.moveBy(30, 0, 130, 1016);
    physics.tick(1 / 60, 1032);
    expect(Math.abs(physics.getState().tilt)).toBeGreaterThan(0);
    physics.release();
    expect(physics.getState().tilt).toBe(0);
    for (let i = 0; i < 120; i++) {
      physics.tick(1 / 60, 1048 + i * (1000 / 60));
    }
    expect(physics.isSettled()).toBe(true);
  });

  it("傾きは速度が止まれば滑らかに 0 へ戻る", () => {
    const physics = createDragPhysics(3);
    physics.moveBy(20, 0, 100, 1000);
    physics.moveBy(20, 0, 120, 1016);
    physics.tick(1 / 60, 1032);
    expect(Math.abs(physics.getState().tilt)).toBeGreaterThan(0);

    let previous = Math.abs(physics.getState().tilt);
    for (let i = 0; i < 30; i++) {
      physics.tick(1 / 60, 1130 + i * (1000 / 60));
      const current = Math.abs(physics.getState().tilt);
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
    expect(previous).toBeLessThan(0.001);
  });
});
