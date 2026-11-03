/* =========================================================
 * ドラッグの物理 (drag physics)
 * ドラッグ中のカードに最小限の手触りを足す。
 *  - 先頭カード: 水平方向の移動速度に応じて上部中央を軸に傾く (±MAX_TILT_DEG)
 *  - 後続カード: 深さに応じて柔らかくなるバネで相対オフセットが遅れて追随する
 *  - 先頭カードの位置は一切遅らせない (位置は view 側がポインタへ直接合わせる)
 * 下の「調整用定数」だけを変更すれば見た目を調整できる。
 * DOM には触れない純粋な状態機械で、transform の適用と rAF は view が担当する。
 * ========================================================= */

/* ---------------- 調整用定数 ---------------- */

/** 先頭カードの最大傾き角 (度) */
export const MAX_TILT_DEG = 5;

/** 傾きが最大になる水平速度 (px/s)。これ以上では MAX_TILT_DEG で頭打ち */
export const TILT_FULL_SPEED = 1500;

/** 水平速度の平滑化時定数 (秒)。小さいほどキビキビ、大きいほど滑らか */
export const VELOCITY_SMOOTHING_S = 0.045;

/** 最後のポインタ移動からこの時間 (ms) が過ぎたら速度を 0 とみなす */
export const VELOCITY_STALE_MS = 70;

/** 計測する瞬間速度の上限 (px/s)。異常値で傾きが跳ねないための保険 */
export const MAX_TRACKED_SPEED = 8000;

/** 後続カードのバネ定数 (1/s^2)。2 枚目 (深さ 1) の基準値 */
export const SPRING_STIFFNESS = 800;

/** 深さが 1 増えるごとにバネを柔らかくする係数。深いほど遅れる */
export const SPRING_DEPTH_FALLOFF = 0.5;

/** バネの減衰比。1 未満でわずかに揺れる */
export const SPRING_DAMPING_RATIO = 0.9;

/** 2 枚目 (深さ 1) の相対オフセット上限 (px) */
export const MAX_LAG_BASE_PX = 15;

/** 深さが 1 増えるごとに増える相対オフセット上限 (px) */
export const MAX_LAG_STEP_PX = 4;

/** 相対オフセット上限の全体キャップ (px) */
export const MAX_LAG_CAP_PX = 50;

/** バネ積分の固定ステップ (秒)。フレーム時間に関係なく安定させる */
export const FIXED_STEP_S = 1 / 240;

/** 1 フレームで扱う最大時間 (秒)。タブ復帰などの巨大 dt を丸める */
export const MAX_FRAME_DT_S = 0.05;

/** 収束判定: オフセット (px) と傾き (度) のしきい値 */
export const SETTLED_EPSILON_PX = 0.05;
export const SETTLED_EPSILON_DEG = 0.01;

/* ---------------- 純粋な計算 ---------------- */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 水平速度 (px/s) から傾き角 (度) を返す。
 * 右向き (正) は正の角度、左向き (負) は負の角度。±MAX_TILT_DEG でクランプ。
 * 速度 0 のときは 0 度。
 */
export function tiltFromVelocity(vx) {
  if (!Number.isFinite(vx)) {
    return 0;
  }
  const ratio = clamp(vx / TILT_FULL_SPEED, -1, 1);
  return ratio * MAX_TILT_DEG;
}

/** 深さ (2 枚目 = 1) に対するバネ定数。深いほど柔らかい */
export function stiffnessForDepth(depth) {
  const d = Math.max(1, depth);
  return SPRING_STIFFNESS / (1 + SPRING_DEPTH_FALLOFF * (d - 1));
}

/** 深さに対する減衰係数。減衰比を一定に保つ */
export function dampingForDepth(depth) {
  return 2 * SPRING_DAMPING_RATIO * Math.sqrt(stiffnessForDepth(depth));
}

/** 深さ (2 枚目 = 1) に対する相対オフセット上限 (px) */
export function maxLagForDepth(depth) {
  const d = Math.max(1, depth);
  const raw = MAX_LAG_BASE_PX + MAX_LAG_STEP_PX * (d - 1);
  return Math.min(MAX_LAG_CAP_PX, raw);
}

/**
 * バネの状態を 1 ステップ進める。state は { x, y, vx, vy }。
 * 返り値は新しい状態 (引数は変更しない)。
 */
export function stepSpring(state, depth, dt) {
  const k = stiffnessForDepth(depth);
  const c = dampingForDepth(depth);
  const ax = -k * state.x - c * state.vx;
  const ay = -k * state.y - c * state.vy;
  const vx = state.vx + ax * dt;
  const vy = state.vy + ay * dt;
  const cap = maxLagForDepth(depth);
  return {
    x: clamp(state.x + vx * dt, -cap, cap),
    y: clamp(state.y + vy * dt, -cap, cap),
    vx,
    vy,
  };
}

/* ---------------- ドラッグ 1 回分の状態機械 ---------------- */

/**
 * ドラッグ中の物理状態を作る。cardCount はドラッグするカード枚数 (先頭を含む)。
 * - moveBy(dx, dy, pointerX, nowMs): レイヤーが dx/dy 動いたことを伝える。
 *   後続カードはその場に残ろうとするため、相対オフセットが逆方向へ付く。
 * - tick(dt, nowMs): 速度の平滑化とバネの積分を進める。
 * - release(): 離した瞬間に傾きと速度を 0 にし、以降は遅れだけを収束させる。
 */
export function createDragPhysics(cardCount) {
  const count = Math.max(1, Math.floor(cardCount) || 1);
  let followers = [];
  for (let i = 1; i < count; i++) {
    followers.push({ depth: i, x: 0, y: 0, vx: 0, vy: 0 });
  }
  let tilt = 0;
  let velocity = 0;
  let targetVelocity = 0;
  let lastPointerX = null;
  let lastMoveAt = -Infinity;
  let released = false;

  /** レイヤーの移動を後続カードの相対オフセットへ反映する */
  function moveBy(dx, dy, pointerX, nowMs) {
    if (released) {
      return;
    }
    const moveX = Number.isFinite(dx) ? dx : 0;
    const moveY = Number.isFinite(dy) ? dy : 0;
    for (const follower of followers) {
      const cap = maxLagForDepth(follower.depth);
      follower.x = clamp(follower.x - moveX, -cap, cap);
      follower.y = clamp(follower.y - moveY, -cap, cap);
    }
    if (lastPointerX !== null && nowMs > lastMoveAt) {
      const dt = (nowMs - lastMoveAt) / 1000;
      targetVelocity = clamp(
        (pointerX - lastPointerX) / dt,
        -MAX_TRACKED_SPEED,
        MAX_TRACKED_SPEED
      );
    }
    lastPointerX = pointerX;
    lastMoveAt = nowMs;
  }

  /** 時間を進める */
  function tick(dt, nowMs) {
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_FRAME_DT_S);
    if (released || nowMs - lastMoveAt > VELOCITY_STALE_MS) {
      targetVelocity = 0;
    }
    const blend = 1 - Math.exp(-step / VELOCITY_SMOOTHING_S);
    velocity += (targetVelocity - velocity) * blend;
    tilt = released ? 0 : tiltFromVelocity(velocity);

    let remaining = step;
    while (remaining > 0) {
      const h = Math.min(FIXED_STEP_S, remaining);
      for (let i = 0; i < followers.length; i++) {
        const next = stepSpring(followers[i], followers[i].depth, h);
        next.depth = followers[i].depth;
        followers[i] = next;
      }
      remaining -= h;
    }
  }

  /** 離した瞬間に傾き・速度を 0 に固定する (遅れは tick で収束させる) */
  function release() {
    released = true;
    targetVelocity = 0;
    velocity = 0;
    tilt = 0;
  }

  /** 傾きも遅れも十分小さくなったか */
  function isSettled() {
    if (Math.abs(tilt) > SETTLED_EPSILON_DEG || Math.abs(velocity) > SETTLED_EPSILON_DEG) {
      return false;
    }
    for (const follower of followers) {
      if (
        Math.abs(follower.x) > SETTLED_EPSILON_PX ||
        Math.abs(follower.y) > SETTLED_EPSILON_PX
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * 現在の見た目。offsets はカード枚数ぶんの配列で、先頭は常に {x:0,y:0}。
   * (先頭カードの位置は遅れない)
   */
  function getState() {
    const offsets = [{ x: 0, y: 0 }];
    for (const follower of followers) {
      offsets.push({ x: follower.x, y: follower.y });
    }
    return { tilt, velocity, offsets };
  }

  return { moveBy, tick, release, isSettled, getState };
}
