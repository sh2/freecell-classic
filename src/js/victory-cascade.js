/* =========================================================
 * 勝利時カスケード (tasteful-effects 最終弾)
 * ホームセル 4 山から K→A の順にカードを 1 枚ずつ放り、
 * 床で跳ねさせながらスタンプを蓄積し、仕上げ花火で締める。
 * このモジュールは調整用定数と純粋ヘルパーだけを持ち、
 * DOM の読み書きは view.js 側で行う。
 * ========================================================= */

/* ---------------- 調整用定数 ---------------- */

/** カードを放出する間隔 (ミリ秒) */
export const RELEASE_INTERVAL_MS = 70;

/** 放出するカード枚数 (ホーム 4 山 × 13 ランク) */
export const RELEASE_CARD_COUNT = 52;

/** 放出時の水平初速の絶対値の範囲 (px/s)。符号はランダム */
export const INITIAL_VX_MIN = 80;
export const INITIAL_VX_MAX = 380;

/** 放出時の垂直初速の範囲 (px/s)。上向きが負 */
export const INITIAL_VY_MIN = -780;
export const INITIAL_VY_MAX = -560;

/** 重力 (px/s^2) */
export const GRAVITY = 1500;

/** 床の反発係数 */
export const FLOOR_RESTITUTION = 0.6;

/** 床接触時の水平速度の減衰率 */
export const FLOOR_FRICTION = 0.88;

/** 壁に当たったときの水平速度の反発係数 */
export const WALL_RESTITUTION = 0.8;

/** 床接触時にこの速度 (px/s) 未満なら静止する */
export const REST_SPEED = 70;

/** 飛行中のカード面をスタンプする間隔 (ミリ秒) */
export const STAMP_INTERVAL_MS = 16;

/** 仕上げ花火の数 */
export const FIREWORK_COUNT = 20;

/** 仕上げ花火を打ち上げる間隔 (ミリ秒) */
export const FIREWORK_INTERVAL_MS = 190;

/** 全カードが床に触れてから仕上げ花火を始めるまでの待ち (ミリ秒) */
export const FIREWORK_DELAY_MS = 1000;

/** 花火を打ち上げる盤面内の余白 (px) */
export const FIREWORK_MARGIN = 40;

/** 仕上げ花火の大きさ倍率。1 発目から 20 発目の順に固定 */
export const FIREWORK_SIZE_MULTIPLIERS = [
  1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0, 1.0, 1.4, 1.0,
  1.4, 2.0,
];

/** 最終発の直前だけ空ける「ため」 (ミリ秒) */
export const FIREWORK_FINAL_HOLD_MS = 1000;

/** 最終発の打ち上げ位置。盤面の左端・上端からの比率 */
export const FIREWORK_FINAL_X_RATIO = 0.5;
export const FIREWORK_FINAL_Y_RATIO = 0.35;

/** 仕上げ花火 1 発あたりの同時バースト上限 (既存 fx の上限を回避する) */
export const FIREWORK_BURST_LIMIT = FIREWORK_COUNT;

/** 全カード静止・全花火発射後にオーバーレイを出すまでの余韻 (ミリ秒) */
export const GRACE_MS = 1000;

/* ---------------- カード面スプライトの見た目 ---------------- */

/** カード面の背景グラデーション */
export const CARD_BG_TOP = "#ffffff";
export const CARD_BG_BOTTOM = "#f2efe6";

/** カード面の枠線 */
export const CARD_BORDER = "#b9b4a4";

/** スート色 */
export const CARD_RED = "#c8322b";
export const CARD_BLACK = "#1d1d28";

/** 角のランク・スートの文字サイズ (カード幅に対する比率) */
export const CORNER_RANK_FONT_RATIO = 17.6 / 88;
export const CORNER_SUIT_FONT_RATIO = 16.8 / 88;

/** 中央のランク・スートの文字サイズ (カード幅に対する比率) */
export const CENTER_RANK_FONT_RATIO = 33.6 / 88;
export const CENTER_SUIT_FONT_RATIO = 21.6 / 88;

/** 角の余白 (カード幅・高さに対する比率) */
export const CORNER_PAD_X_RATIO = 7 / 88;
export const CORNER_PAD_Y_RATIO = 6 / 124;

/** 角のランクとスートの間隔 (カード幅に対する比率) */
export const CORNER_GAP_RATIO = 3 / 88;

/** カード面の角丸 (カード幅に対する比率) */
export const CARD_RADIUS_RATIO = 10 / 88;

/** 中央マークを描く最小カード幅 (px)。CSS の 600px 以下で非表示に合わせる */
export const CENTER_MARK_MIN_WIDTH = 64;

/* ---------------- 純粋ヘルパー ---------------- */

const HIGHEST_RANK = 13;
const LOWEST_RANK = 1;

/**
 * ホーム 4 山から放出する順序を作る。
 * ランク K→A を外側、ホーム 0〜3 を内側にしたラウンドロビンで、
 * 各山の該当ランクのカードを 1 枚ずつ並べる。
 * @param {{suit:number, rank:number, id:number}[][]} foundations
 * @returns {{cardId:number, homeIndex:number, rank:number}[]}
 */
export function buildReleaseSchedule(foundations) {
  const byRank = [];
  for (let home = 0; home < foundations.length; home++) {
    const map = new Map();
    for (const card of foundations[home]) {
      map.set(card.rank, card);
    }
    byRank.push(map);
  }
  const schedule = [];
  for (let rank = HIGHEST_RANK; rank >= LOWEST_RANK; rank--) {
    for (let home = 0; home < byRank.length; home++) {
      const card = byRank[home].get(rank);
      if (card) {
        schedule.push({ cardId: card.id, homeIndex: home, rank });
      }
    }
  }
  return schedule;
}

/**
 * 放出時の初速を決める。水平は左右ランダム、垂直は常に上向き。
 * random はテスト用に差し替え可能。
 */
export function initialVelocity(random = Math.random) {
  const sign = random() < 0.5 ? -1 : 1;
  const vx = sign * (INITIAL_VX_MIN + random() * (INITIAL_VX_MAX - INITIAL_VX_MIN));
  const vy = INITIAL_VY_MIN + random() * (INITIAL_VY_MAX - INITIAL_VY_MIN);
  return { vx, vy };
}

/**
 * 飛行状態の初期値を作る。
 */
export function createFlightState({ x, y, width, height, vx, vy }) {
  return {
    x,
    y,
    width,
    height,
    vx,
    vy,
    resting: false,
    touchedFloor: false,
  };
}

/**
 * 飛行状態を dt 秒進める。状態はその場で更新する。
 * 戻り値の landed は「このステップで初めて床に触れた」ときだけ true。
 * bounds は { left, right, floor } (ビューポート座標)。
 */
export function stepFlight(flight, dt, bounds) {
  if (flight.resting) {
    return { landed: false };
  }
  flight.vy += GRAVITY * dt;
  flight.x += flight.vx * dt;
  flight.y += flight.vy * dt;

  if (flight.x < bounds.left) {
    flight.x = bounds.left;
    flight.vx = Math.abs(flight.vx) * WALL_RESTITUTION;
  } else if (flight.x + flight.width > bounds.right) {
    flight.x = bounds.right - flight.width;
    flight.vx = -Math.abs(flight.vx) * WALL_RESTITUTION;
  }

  let landed = false;
  if (flight.y + flight.height >= bounds.floor) {
    flight.y = bounds.floor - flight.height;
    if (!flight.touchedFloor) {
      flight.touchedFloor = true;
      landed = true;
    }
    if (Math.abs(flight.vy) < REST_SPEED) {
      flight.vy = 0;
      flight.vx = 0;
      flight.resting = true;
    } else {
      flight.vy = -Math.abs(flight.vy) * FLOOR_RESTITUTION;
      flight.vx *= FLOOR_FRICTION;
    }
  }
  return { landed };
}

/**
 * カードが静止する床のビューポート Y 座標を決める。
 * フッターの上端が取得できればそこを地面にし、取得できなければ
 * ゲーム盤面の下端へフォールバックする。どちらの場合もビューポートの
 * 下端を超えないように丸める。
 */
export function resolveFloorY(footerTop, gameBottom, viewportBottom) {
  const base = Number.isFinite(footerTop) ? footerTop : gameBottom;
  return Math.min(base, viewportBottom);
}

/**
 * 盤面矩形の中のランダムな花火位置を返す。
 */
export function fireworkPoint(random, rect, margin = FIREWORK_MARGIN) {
  const width = Math.max(1, rect.width - margin * 2);
  const height = Math.max(1, rect.height - margin * 2);
  return {
    x: rect.left + margin + random() * width,
    y: rect.top + margin + random() * height,
  };
}

/**
 * 発番号 (1 始まり) に対応する大きさ倍率を返す。
 * 範囲外は等倍へフォールバックする。
 */
export function fireworkSizeMultiplier(fireNumber) {
  const value = FIREWORK_SIZE_MULTIPLIERS[Math.round(fireNumber) - 1];
  return Number.isFinite(value) ? value : 1;
}

/**
 * 発番号 (1 始まり) に対応する粒数倍率を返す。
 * 輪の面積に合わせて密度を保つため、大きさ倍率の二乗にする。
 */
export function fireworkParticleMultiplier(fireNumber) {
  const sizeMultiplier = fireworkSizeMultiplier(fireNumber);
  return sizeMultiplier * sizeMultiplier;
}

/**
 * 最終発の打ち上げ位置を盤面矩形から返す。
 * 左右中央・上端から高さの 35%。
 */
export function finalFireworkPoint(rect) {
  return {
    x: rect.left + rect.width * FIREWORK_FINAL_X_RATIO,
    y: rect.top + rect.height * FIREWORK_FINAL_Y_RATIO,
  };
}

/**
 * 発番号 (1 始まり) の直前の間隔を返す。
 * 最終発の直前だけ「ため」、それ以外は通常の間隔。
 */
export function fireworkGapBefore(fireNumber) {
  return fireNumber >= FIREWORK_COUNT ? FIREWORK_FINAL_HOLD_MS : FIREWORK_INTERVAL_MS;
}
