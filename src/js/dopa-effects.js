/* =========================================================
 * ドパモード増強版 演出レジストリ / 割り当て表
 * 56 件の ID は固定。表示側は dopa-visuals.js、
 * 抽選・発火は dopa.js が担当する。
 * ========================================================= */

/** 演出 ID(56 件、順序も固定) */
export const DOPA_EFFECT_IDS = Object.freeze([
  // A カード系
  "a01-ghost",
  "a02-crack",
  "a03-giant",
  "a04-spin",
  "a05-boomerang",
  "a06-warp",
  "a07-tornado",
  "a08-rocket",
  "a09-bounce",
  "a10-split",
  // B 攻撃系
  "b01-explosion",
  "b02-machinegun",
  "b03-iaido",
  "b04-meteor",
  "b05-lightning",
  "b06-beam",
  "b07-rush",
  "b08-drill",
  "b09-groundcrack",
  "b10-blackhole",
  // C 画面系
  "c01-punchzoom",
  "c02-speedlines",
  "c03-slowmo",
  "c04-invert",
  "c05-glitch",
  "c06-split-screen",
  "c07-fisheye",
  "c08-kaleido",
  "c09-spotlight",
  "c10-felt",
  // D テロップ系
  "d01-cutin",
  "d02-commentary",
  "d03-damage",
  "d04-combo",
  "d05-onomatopeia",
  "d06-rank",
  "d07-ticker",
  "d08-crowd",
  // E 世界観系
  "e01-magic",
  "e02-ssr",
  "e03-slot",
  "e04-firework",
  "e05-sakura",
  "e06-space",
  "e07-underwater",
  "e08-casino",
  // F 節目系
  "f01-foundation-finale",
  "f02-crown",
  "f03-countdown",
  "f04-curtain",
  "f05-glassbreak",
  "f06-staffroll",
  // G 失敗系
  "g01-fail-cross",
  "g02-fail-sink",
  "g03-stuck-gray",
  "g04-stuck-skull",
]);

/** 各演出のメタ情報(duration は 2.5 秒以内) */
export const DOPA_EFFECT_META = Object.freeze({
  "a01-ghost": { category: "A", duration: 900, sound: "impact-soft" },
  "a02-crack": { category: "A", duration: 950, sound: "crack" },
  "a03-giant": { category: "A", duration: 850, sound: "thump" },
  "a04-spin": { category: "A", duration: 900, sound: "whoosh" },
  "a05-boomerang": { category: "A", duration: 1000, sound: "whoosh" },
  "a06-warp": { category: "A", duration: 800, sound: "warp" },
  "a07-tornado": { category: "A", duration: 1200, sound: "whoosh" },
  "a08-rocket": { category: "A", duration: 1000, sound: "rocket" },
  "a09-bounce": { category: "A", duration: 1100, sound: "thump" },
  "a10-split": { category: "A", duration: 1000, sound: "impact-soft" },
  "b01-explosion": { category: "B", duration: 1100, sound: "explosion" },
  "b02-machinegun": { category: "B", duration: 1150, sound: "heavy-gun" },
  "b03-iaido": { category: "B", duration: 900, sound: "saber" },
  "b04-meteor": { category: "B", duration: 1200, sound: "explosion" },
  "b05-lightning": { category: "B", duration: 1000, sound: "lightning" },
  "b06-beam": { category: "B", duration: 1100, sound: "beam" },
  "b07-rush": { category: "B", duration: 1000, sound: "rush" },
  "b08-drill": { category: "B", duration: 1100, sound: "drill" },
  "b09-groundcrack": { category: "B", duration: 1150, sound: "groundcrack" },
  "b10-blackhole": { category: "B", duration: 1500, sound: "blackhole" },
  "c01-punchzoom": { category: "C", duration: 650, sound: "thump" },
  "c02-speedlines": { category: "C", duration: 800, sound: "whoosh" },
  "c03-slowmo": { category: "C", duration: 1200, sound: "slowmo" },
  "c04-invert": { category: "C", duration: 500, sound: "glitch" },
  "c05-glitch": { category: "C", duration: 750, sound: "glitch" },
  "c06-split-screen": { category: "C", duration: 800, sound: "glitch" },
  "c07-fisheye": { category: "C", duration: 750, sound: "warp" },
  "c08-kaleido": { category: "C", duration: 1000, sound: "impact-soft" },
  "c09-spotlight": { category: "C", duration: 1200, sound: "spotlight" },
  "c10-felt": { category: "C", duration: 1400, sound: "magic" },
  "d01-cutin": { category: "D", duration: 1200, sound: "cutin" },
  "d02-commentary": { category: "D", duration: 1400, sound: "voice" },
  "d03-damage": { category: "D", duration: 1000, sound: "damage" },
  "d04-combo": { category: "D", duration: 1100, sound: "rumble" },
  "d05-onomatopeia": { category: "D", duration: 1100, sound: "don" },
  "d06-rank": { category: "D", duration: 1200, sound: "impact" },
  "d07-ticker": { category: "D", duration: 2000, sound: "voice" },
  "d08-crowd": { category: "D", duration: 1600, sound: "crowd" },
  "e01-magic": { category: "E", duration: 1300, sound: "magic-boon" },
  "e02-ssr": { category: "E", duration: 2000, sound: "magic-boon" },
  "e03-slot": { category: "E", duration: 1400, sound: "magic" },
  "e04-firework": { category: "E", duration: 1500, sound: "firework" },
  "e05-sakura": { category: "E", duration: 1800, sound: "sakura" },
  "e06-space": { category: "E", duration: 1600, sound: "space" },
  "e07-underwater": { category: "E", duration: 1600, sound: "underwater" },
  "e08-casino": { category: "E", duration: 1500, sound: "coin" },
  "f01-foundation-finale": { category: "F", duration: 1500, sound: "impact" },
  "f02-crown": { category: "F", duration: 1200, sound: "impact" },
  "f03-countdown": { category: "F", duration: 1000, sound: "thump" },
  "f04-curtain": { category: "F", duration: 1200, sound: "rumble" },
  "f05-glassbreak": { category: "F", duration: 1300, sound: "explosion" },
  "f06-staffroll": { category: "F", duration: 1900, sound: "rumble" },
  "g01-fail-cross": { category: "G", duration: 900, sound: "fail-cross" },
  "g02-fail-sink": { category: "G", duration: 1000, sound: "fail-sink" },
  "g03-stuck-gray": { category: "G", duration: 1200, sound: "stuck-gray" },
  "g04-stuck-skull": { category: "G", duration: 1200, sound: "stuck-skull" },
});

/**
 * 実プレイへの割り当て。すべての ID がどこか 1 か所には現れる。
 * pool は通常移動・ホーム移動でランダムに 1 件選ぶ候補。
 */
export const DOPA_ASSIGNMENTS = Object.freeze({
  normalMove: {
    pool: [
      "a01-ghost",
      "a02-crack",
      "a03-giant",
      "a04-spin",
      "a05-boomerang",
      "a06-warp",
      "a07-tornado",
      "a08-rocket",
      "a09-bounce",
      "a10-split",
      "b01-explosion",
      "b02-machinegun",
      "b03-iaido",
      "b04-meteor",
      "b05-lightning",
      "b06-beam",
      "b07-rush",
      "b08-drill",
      "b09-groundcrack",
      "b10-blackhole",
      "c01-punchzoom",
      "c02-speedlines",
      "c03-slowmo",
      "c04-invert",
      "c05-glitch",
      "c06-split-screen",
      "c07-fisheye",
      "c08-kaleido",
      "c09-spotlight",
      "c10-felt",
    ],
    overlayPool: [
      "d01-cutin",
      "d02-commentary",
      "d03-damage",
      "d04-combo",
      "d05-onomatopeia",
      "d06-rank",
      "d07-ticker",
      "d08-crowd",
    ],
    overlayChance: 0.5,
  },
  homeMove: {
    pool: [
      "b01-explosion",
      "b02-machinegun",
      "b03-iaido",
      "b04-meteor",
      "b05-lightning",
      "b06-beam",
      "b07-rush",
      "b08-drill",
      "b09-groundcrack",
      "b10-blackhole",
      "e01-magic",
      "e02-ssr",
      "e03-slot",
      "e04-firework",
      "e05-sakura",
      "e06-space",
      "e07-underwater",
      "e08-casino",
    ],
    overlayPool: [
      "d01-cutin",
      "d02-commentary",
      "d03-damage",
      "d04-combo",
      "d05-onomatopeia",
      "d06-rank",
      "d07-ticker",
      "d08-crowd",
    ],
    restricted: { "e02-ssr": "king-or-combo8" },
  },
  autoHome: {
    comboEffect: "d04-combo",
  },
  autoSolve: {
    pool: [
      "a01-ghost",
      "a02-crack",
      "a03-giant",
      "a04-spin",
      "a05-boomerang",
      "a06-warp",
      "a07-tornado",
      "a08-rocket",
      "a09-bounce",
      "a10-split",
      "b01-explosion",
      "b02-machinegun",
      "b03-iaido",
      "b04-meteor",
      "b05-lightning",
      "b06-beam",
      "b07-rush",
      "b08-drill",
      "b09-groundcrack",
      "b10-blackhole",
      "c01-punchzoom",
      "c02-speedlines",
      "c03-slowmo",
      "c04-invert",
      "c05-glitch",
      "c06-split-screen",
      "c07-fisheye",
      "c08-kaleido",
      "c09-spotlight",
      "c10-felt",
    ],
  },
  hint: ["e01-magic", "c09-spotlight"],
  undo: ["a06-warp", "c03-slowmo"],
  deal: ["e05-sakura", "a08-rocket"],
  foundationComplete: ["f01-foundation-finale", "e02-ssr"],
  firstKing: ["f02-crown"],
  lowCards: ["f03-countdown"],
  win: ["f04-curtain", "f05-glassbreak", "f06-staffroll"],
  fail: ["g01-fail-cross", "g02-fail-sink"],
  stuck: ["g03-stuck-gray", "g04-stuck-skull"],
});

/** 演出 ID ごとの想定カテゴリ(A〜G) */
export const DOPA_CATEGORIES = Object.freeze({
  A: DOPA_EFFECT_IDS.filter((id) => id.startsWith("a")),
  B: DOPA_EFFECT_IDS.filter((id) => id.startsWith("b")),
  C: DOPA_EFFECT_IDS.filter((id) => id.startsWith("c")),
  D: DOPA_EFFECT_IDS.filter((id) => id.startsWith("d")),
  E: DOPA_EFFECT_IDS.filter((id) => id.startsWith("e")),
  F: DOPA_EFFECT_IDS.filter((id) => id.startsWith("f")),
  G: DOPA_EFFECT_IDS.filter((id) => id.startsWith("g")),
});

/** カード ID からランク(1〜13)を返す */
export function rankOfCard(cardId) {
  return Number.isInteger(cardId) ? Math.floor(cardId / 4) + 1 : 0;
}

/** 演出 ID がレジストリに存在するか */
export function isDopaEffectId(id) {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(DOPA_EFFECT_META, id);
}

/** 大当たり(epic)の発生確率 */
export const EPIC_CHANCE = 0.12;

/** epic 時の倍率 */
export const EPIC_MULTIPLIER = 3;

/**
 * 実効時間を決める純粋関数。
 * 通常は base × 0.8〜1.3 の一様乱数、epic は base × 3(ジッターなし)。
 */
export function pickDuration(id, rng = Math.random, options = {}) {
  const base = DOPA_EFFECT_META[id]?.duration ?? 800;
  if (options.epic) {
    return base * EPIC_MULTIPLIER;
  }
  return base * (0.8 + rng() * 0.5);
}

/**
 * epic にするか決める。
 * e02-ssr / f01 / f02 / combo 8 以上は確定、C/D/E 群は約 12%。
 */
export function shouldEpic(id, rng = Math.random, context = {}) {
  const meta = DOPA_EFFECT_META[id];
  if (!meta) {
    return false;
  }
  if (id === "e02-ssr" || id === "f01-foundation-finale" || id === "f02-crown") {
    return true;
  }
  if (Number(context.combo) >= 8) {
    return true;
  }
  if (meta.category === "C" || meta.category === "D" || meta.category === "E") {
    return rng() < EPIC_CHANCE;
  }
  return false;
}

// 表示文言プールは専用モジュールに集約し、ここからも参照できるようにする
export { DOPA_TEXT_POOLS, DOPA_LABELS, TEXT_ANCHORS, TEXT_MOTIONS, chooseTextAnchor, chooseTextMotion } from "./dopa-text.js";
