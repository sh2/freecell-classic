/* =========================================================
 * ドパモード 表示文言プール (fix-02 FB-4 / FB-6)
 * 演出として画面に出る文字列はすべて英語で持つ。
 * コメントは日本語でよいが、表示文言に日本語を入れない。
 * ========================================================= */

/** カットインのフレーズ */
export const CUTIN_PHRASES = Object.freeze([
  "PERFECT MOVE!",
  "CRITICAL!",
  "FINISHING BLOW!",
  "UNSTOPPABLE!",
  "A MIRACLE CARD!",
  "HISTORY IN THE MAKING!",
  "NO WAY!",
  "GAME CHANGER!",
  "MASTER STROKE!",
  "ABSOLUTE CINEMA!",
]);

/** 実況テロップ */
export const COMMENTARY_LINES = Object.freeze([
  "WHAT A MOVE!",
  "THE CROWD GOES WILD!",
  "HISTORY IN THE MAKING!",
  "THAT WAS INCREDIBLE!",
  "ARE YOU KIDDING ME?!",
  "A PERFECT READ!",
  "MOMENTUM IS BUILDING!",
  "NOTHING CAN STOP THIS!",
  "THE TABLE IS ON FIRE!",
  "WHAT A TURNAROUND!",
]);

/** 観客の歓声 */
export const CROWD_LINES = Object.freeze([
  "WAAAAH!",
  "YEAHHH!",
  "LET'S GOOO!",
  "UNBELIEVABLE!",
  "MVP! MVP!",
  "ENCORE! ENCORE!",
  "GO GO GO!",
  "OH MY GOD!",
  "LEGENDARY!",
  "STANDING OVATION!",
]);

/** スローモーションのオーバーレイ */
export const SLOWMO_LINES = Object.freeze([
  "SLOW MOTION!",
  "TIME FREEZE!",
  "HOLD THE MOMENT!",
  "IN SLOW MOTION!",
  "FROZEN IN TIME!",
  "DRAMATIC PAUSE!",
  "THE WORLD STOPS!",
  "ONE MORE LOOK!",
  "CINEMATIC!",
  "MAXIMUM TENSION!",
]);

/** 宇宙空間のオーバーレイ */
export const SPACE_LINES = Object.freeze([
  "DEEP SPACE!",
  "BEYOND THE STARS!",
  "GALAXY BRAIN!",
  "COSMIC POWER!",
  "INFINITE VOID!",
  "LIGHT YEARS AHEAD!",
  "ORBIT ACHIEVED!",
  "STELLAR!",
  "OUT OF THIS WORLD!",
  "THE FINAL FRONTIER!",
]);

/** 水中のオーバーレイ */
export const UNDERWATER_LINES = Object.freeze([
  "UNDERWATER!",
  "DEEP BLUE!",
  "DIVE! DIVE!",
  "SUBMERGED!",
  "OCEAN FLOOR!",
  "BUBBLE POWER!",
  "AQUATIC!",
  "INTO THE DEEP!",
  "WAVE CRASH!",
  "BLUE ZONE!",
]);

/** オノマトペ(英語のみ) */
export const ONOMATOPE_LINES = Object.freeze([
  "BOOM!",
  "BANG!",
  "WHAM!",
  "POW!",
  "CRASH!",
  "SLASH!",
  "ZOOM!",
  "KABOOM!",
  "SMASH!",
  "RATATATA!",
]);

/** 単発ラベル(カード付近・画面中央など) */
export const DOPA_LABELS = Object.freeze({
  crack: "CRACK!",
  thud: "THUD!",
  kaboom: "KABOOM!",
  ratatata: "RATATATA!",
  slash: "SLASH!",
  meteor: "METEOR!",
  lightning: "LIGHTNING!",
  beam: "BEAM!",
  dododo: "DODODO!",
  drill: "DRILL!",
  zoom: "ZOOM!",
  focus: "FOCUS!",
  invert: "INVERT!",
  glitch: "GLITCH!",
  split: "SPLIT!",
  kaleido: "KALEIDO!",
  spotlight: "SPOTLIGHT!",
  inferno: "INFERNO!",
  freeze: "FREEZE!",
  goldRush: "GOLD RUSH!",
  magicCircle: "MAGIC CIRCLE!",
  ssr: "SSR",
  slot: "777",
  fireworks: "FIREWORKS!",
  sakura: "SAKURA STORM!",
  jackpot: "JACKPOT!",
  suitComplete: "SUIT COMPLETE!",
  crown: "KING'S CROWN!",
  curtainCall: "CURTAIN CALL!",
  youWin: "YOU WIN!",
  niceTry: "NICE TRY!",
  stuck: "STUCK!",
  timesUp: "TIME'S UP!",
  gameOver: "GAME OVER!",
  breaking: "BREAKING NEWS: 56 EFFECTS UNLEASHED! THE CROWD IS GOING WILD! WHAT WILL HAPPEN NEXT!?",
  newsLabel: "NEWS",
  crowdCheer: "WAAAAH!",
  countdownSuffix: " CARDS LEFT!",
  staff: "STAFF",
  director: "DIRECTOR: DOPA",
  cards: "CARDS: 52",
  effects: "EFFECTS: 56",
  thanks: "THANKS FOR PLAYING",
});

/** 文言プールをまとめたもの(単体テストの日本語混入チェック対象) */
export const DOPA_TEXT_POOLS = Object.freeze({
  cutin: CUTIN_PHRASES,
  commentary: COMMENTARY_LINES,
  crowd: CROWD_LINES,
  slowmo: SLOWMO_LINES,
  space: SPACE_LINES,
  underwater: UNDERWATER_LINES,
  onomatope: ONOMATOPE_LINES,
  labels: Object.freeze(Object.values(DOPA_LABELS)),
});

/** テロップのアンカー候補(上中下 × 左中右)。安全マージン内に置く */
export const TEXT_ANCHORS = Object.freeze([
  { name: "upper-left", x: 0.18, y: 0.26 },
  { name: "upper-center", x: 0.5, y: 0.26 },
  { name: "upper-right", x: 0.82, y: 0.26 },
  { name: "middle-left", x: 0.18, y: 0.5 },
  { name: "middle-center", x: 0.5, y: 0.5 },
  { name: "middle-right", x: 0.82, y: 0.5 },
  { name: "lower-left", x: 0.18, y: 0.72 },
  { name: "lower-center", x: 0.5, y: 0.72 },
  { name: "lower-right", x: 0.82, y: 0.72 },
]);

/** テキストの登場アニメーション */
export const TEXT_MOTIONS = Object.freeze(["cutin", "letters", "punch"]);

/** 直前と同じアンカーを避けて 1 つ選ぶ */
export function chooseTextAnchor(rng, previous) {
  const candidates = TEXT_ANCHORS.filter((anchor) => anchor.name !== previous);
  const pool = candidates.length > 0 ? candidates : TEXT_ANCHORS;
  return pool[Math.floor(rng() * pool.length)] ?? TEXT_ANCHORS[0];
}

/** テキストの登場アニメーションを選ぶ */
export function chooseTextMotion(rng) {
  return TEXT_MOTIONS[Math.floor(rng() * TEXT_MOTIONS.length)] ?? TEXT_MOTIONS[0];
}

/**
 * テキスト演出の 3 相タイムライン(enter / hold / exit)を ms で返す。
 * hold は 120〜250ms(epic は最大 300ms)に収める。
 */
export function buildTextTimeline(durationMs, options = {}) {
  const total = Math.max(120, Number(durationMs) || 900);
  const maxHold = options.epic ? 300 : 250;
  const hold = Math.min(maxHold, Math.max(120, total * 0.18));
  const enter = Math.min(200, Math.max(80, total * 0.15));
  const exit = Math.max(80, total - enter - hold);
  return { enter, hold, exit };
}
