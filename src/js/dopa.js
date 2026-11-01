/* =========================================================
 * ドパモード コントローラー
 * モード状態・イベント→演出レシピの対応・連続ホームの combo を所有する。
 * ゲーム状態 (game-state.js) には何も追加せず、設定も保存しない。
 * app / interactions / solver-client は handle(event) を呼ぶだけ。
 * ========================================================= */

import { createDopaAudio } from "./dopa-audio.js";
import { createDopaVisuals } from "./dopa-visuals.js";
import {
  DOPA_EFFECT_IDS,
  DOPA_EFFECT_META,
  DOPA_ASSIGNMENTS,
  isDopaEffectId,
  pickDuration,
  rankOfCard,
  shouldEpic,
} from "./dopa-effects.js";

/** 連続ホーム送りとみなす時間窓 */
export const COMBO_WINDOW_MS = 900;

/** 音程・発光の頭打ち(半音の上限) */
const MAX_COMBO_STEP = 12;

/** combo の内部上限(13 = +12 半音の頭打ち) */
const MAX_COMBO = MAX_COMBO_STEP + 1;

/** モバイル・低メモリ端末かどうかを判定する */
function detectMobile() {
  if (typeof matchMedia === "function" && matchMedia("(max-width: 600px)").matches) {
    return true;
  }
  if (typeof navigator !== "undefined" && Number(navigator.deviceMemory) <= 4) {
    return true;
  }
  return false;
}

/** ドパモードを生成する。view は必須、audio / visuals / env は差し替え用 */
export function createDopaMode({ view = null, audio = null, visuals = null, env = {} } = {}) {
  const mobile = env.mobile ?? detectMobile();
  const reducedMotion =
    env.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const clock = env.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));

  const audioFx = audio ?? createDopaAudio({ mobile });
  const visualFx =
    visuals ?? createDopaVisuals({ stage: view?.getDopaStage ? view.getDopaStage() : null, env: { mobile, reducedMotion } });
  if (view && typeof view.onBeforeRender === "function") {
    view.onBeforeRender(() => visualFx.cancelAnchored());
  }

  let enabled = false;
  let combo = 0;
  let lastHomeAt = -Infinity;
  let generation = 0;
  let lastEvent = null;
  let lastRecipe = null;
  let lastIntensity = null;
  let kingCrowned = false;
  let lastEffectId = null;
  let lastDuration = null;
  let lastEpic = false;

  const random = env.random ?? Math.random;
  const effectCounts = Object.fromEntries(DOPA_EFFECT_IDS.map((id) => [id, 0]));
  const effectHistory = [];
  const lastPicked = new Map();
  const sequenceTimers = new Set();

  function scheduleSequence(fn, ms) {
    const handle = setTimeout(() => {
      sequenceTimers.delete(handle);
      fn();
    }, ms);
    sequenceTimers.add(handle);
    return handle;
  }

  function clearSequenceTimers() {
    for (const handle of sequenceTimers) {
      clearTimeout(handle);
    }
    sequenceTimers.clear();
  }

  /** 演出 ID を 1 件発火し、回数と履歴を記録する */
  function triggerEffect(id, context = {}) {
    if (!isDopaEffectId(id)) {
      return false;
    }
    const meta = DOPA_EFFECT_META[id];
    const epic = shouldEpic(id, random, context);
    const duration = Number.isFinite(context.forceDuration)
      ? context.forceDuration
      : pickDuration(id, random, { epic });
    const nextContext = {
      ...context,
      epic,
      duration,
      timeScale: meta.duration > 0 ? duration / meta.duration : 1,
    };
    effectCounts[id] += 1;
    lastEffectId = id;
    lastDuration = duration;
    lastEpic = epic;
    effectHistory.push(id);
    if (effectHistory.length > 200) {
      effectHistory.shift();
    }
    if (visualFx && typeof visualFx.playEffect === "function") {
      visualFx.playEffect(id, nextContext);
    }
    if (meta.sound) {
      play(meta.sound, {
        volumeScale: context.volumeScale ?? (context.source === "solver" ? 0.55 : 1),
        mobile,
      });
    }
    return true;
  }

  /** プールから直前と同じ ID を避けて 1 件選ぶ */
  function pickEffect(bucket, pool, context = {}) {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }
    const previous = lastPicked.get(bucket);
    const candidates = pool.length > 1 ? pool.filter((id) => id !== previous) : pool.slice();
    const id = candidates[Math.floor(random() * candidates.length)] ?? pool[0];
    lastPicked.set(bucket, id);
    triggerEffect(id, context);
    return id;
  }

  function isEnabled() {
    return enabled;
  }

  /** 演出の強さ。combo が育つとホーム送りだけ最大へ上がる */
  function intensityFor(type, comboValue) {
    if (type === "win") {
      return "max";
    }
    if (type === "home") {
      return comboValue >= 8 ? "max" : "normal";
    }
    if (type === "select" || type === "select-cancel" || type === "drop-target") {
      return "calm";
    }
    if (type === "move-fail" || type === "stuck" || type === "hint" || type === "undo") {
      return "calm";
    }
    if (type === "auto-start" || type === "auto-end" || type === "win-dismiss") {
      return "calm";
    }
    return "normal";
  }

  function play(recipe, opts = {}) {
    const next = { ...opts, mobile };
    lastRecipe = recipe;
    return audioFx.play(recipe, next);
  }

  function resetCombo() {
    combo = 0;
    lastHomeAt = -Infinity;
  }

  /** すべての演出・音・combo を初期化する(新規ゲーム・OFF・やり直し) */
  function reset(reason = "reset") {
    generation += 1;
    clearSequenceTimers();
    visualFx.cancelAll();
    audioFx.stopAll({ fadeMs: 0 });
    resetCombo();
    kingCrowned = false;
    lastEvent = { type: "reset", reason };
  }

  function setEnabled(on) {
    const next = !!on;
    if (next === enabled) {
      return;
    }
    enabled = next;
    generation += 1;
    if (view && typeof view.setDopaMode === "function") {
      view.setDopaMode(next);
    }
    audioFx.setEnabled(next);
    lastEvent = { type: next ? "enable" : "disable" };
    if (next) {
      audioFx.unlock();
      if (typeof visualFx.preloadImages === "function") {
        visualFx.preloadImages();
      }
      play("toggle-on");
    } else {
      reset("disabled");
    }
  }

  /** ON 中の最初のユーザー操作で AudioContext を再開する */
  function unlock() {
    if (!enabled) {
      return;
    }
    audioFx.unlock();
  }

  /** 移動の軌跡・着地演出の共通部分 */
  function playMoveVisuals(event, destZone, comboValue) {
    if (destZone === "home") {
      visualFx.flightTrail({ cardIds: event.cardIds, origins: event.origins, duration: event.duration });
      visualFx.homeGlow({ index: event.dest?.index ?? 0, combo: comboValue });
      visualFx.landingBurst({
        cardId: event.cardId,
        zone: destZone,
        index: event.dest?.index ?? 0,
        combo: comboValue,
        scale: event.source === "solver" ? 0.5 : 1,
        mobile,
      });
      return;
    }
    visualFx.flightTrail({ cardIds: event.cardIds, origins: event.origins, duration: event.duration });
    visualFx.landingBurst({
      cardId: event.cardId,
      zone: destZone,
      index: event.dest?.index ?? 0,
      combo: 1,
      scale: event.source === "solver" ? 0.5 : 1,
      mobile,
    });
  }

  /** ホーム送り用プール。e02-ssr は K かコンボ 8 以上でのみ解禁する */
  function homePoolFor(event, comboValue) {
    const rank = rankOfCard(event.cardId);
    return DOPA_ASSIGNMENTS.homeMove.pool.filter((id) => {
      const rule = DOPA_ASSIGNMENTS.homeMove.restricted?.[id];
      if (rule === "king-or-combo8") {
        return rank === 13 || comboValue >= 8;
      }
      return true;
    });
  }

  /** 56 件の割り当てに沿って追加演出を発火する(A/B/C + D 重ね) */
  function applyBoostEffects(event, destZone, comboValue) {
    const context = {
      cardId: event.cardId,
      dest: event.dest,
      combo: comboValue,
      source: event.source,
      reason: event.reason,
      remaining: event.remainingCards,
    };
    if (destZone === "home") {
      pickEffect("home", homePoolFor(event, comboValue), context);
      pickEffect("home-overlay", DOPA_ASSIGNMENTS.homeMove.overlayPool ?? DOPA_ASSIGNMENTS.normalMove.overlayPool, context);
      triggerEffect(DOPA_ASSIGNMENTS.autoHome.comboEffect, { ...context, combo: Math.max(1, comboValue) });
    } else {
      pickEffect("normal", DOPA_ASSIGNMENTS.normalMove.pool, context);
      if (random() < DOPA_ASSIGNMENTS.normalMove.overlayChance) {
        pickEffect("normal-overlay", DOPA_ASSIGNMENTS.normalMove.overlayPool, context);
      }
    }

    if (Number.isInteger(event.remainingCards) && event.remainingCards <= 10) {
      triggerEffect("f03-countdown", { ...context, remaining: event.remainingCards });
    }
    if (event.foundationComplete) {
      triggerEffect("f01-foundation-finale", context);
      triggerEffect("e02-ssr", context);
    }
    const rank = rankOfCard(event.cardId);
    if (rank === 13 && destZone !== "home" && !kingCrowned) {
      kingCrowned = true;
      triggerEffect("f02-crown", context);
    }
  }

  function handleMove(event) {
    const destZone = event.dest?.zone ?? "cascade";
    const isSolver = event.source === "solver";
    if (isSolver) {
      resetCombo();
    } else if (destZone !== "home") {
      resetCombo();
    }
    playMoveVisuals(event, destZone, destZone === "home" ? 1 : combo);
    applyBoostEffects(event, destZone, destZone === "home" ? 1 : combo);
    if (isSolver) {
      play("landing", { volumeScale: 0.5 });
      play("solver-move");
      return;
    }
    if (destZone === "home") {
      play("landing");
      play("move-home", { semitone: 0 });
      return;
    }
    if (destZone === "free") {
      play("landing");
      play("move-free");
      return;
    }
    play("landing");
    play("move-cascade");
  }

  function handleHome(event) {
    if (event.source === "solver") {
      resetCombo();
      playMoveVisuals(event, "home", 1);
      applyBoostEffects(event, "home", 1);
      play("landing", { volumeScale: 0.5 });
      play("solver-move");
      return;
    }
    const t = clock();
    if (t - lastHomeAt <= COMBO_WINDOW_MS) {
      combo = Math.min(combo + 1, MAX_COMBO);
    } else {
      combo = 1;
    }
    lastHomeAt = t;
    const semitone = Math.min(combo - 1, MAX_COMBO_STEP);
    playMoveVisuals(event, "home", combo);
    applyBoostEffects(event, "home", combo);
    play("landing", { volumeScale: combo >= 8 ? 1.2 : 1 });
    play("move-home", { semitone, volumeScale: combo >= 8 ? 1.2 : 1 });
  }

  /** ゲームイベントを演出へ変換する。未知イベントは無視する */
  function handle(event) {
    if (!event || typeof event.type !== "string") {
      return;
    }
    if (event.type === "reset") {
      reset(event.reason ?? "reset");
      return;
    }
    if (!enabled) {
      return;
    }
    const type = event.type;
    const gen = generation;
    lastEvent = { ...event, type };
    lastIntensity = intensityFor(type, combo);

    switch (type) {
      case "select":
        play("select");
        visualFx.selectionPulse({ cardId: event.cardId });
        break;
      case "select-cancel":
        visualFx.cancelAnchored();
        break;
      case "drag-start":
        visualFx.dragLift({ on: true, cardIds: event.cardIds });
        play("drag-start");
        break;
      case "drop-target":
        play("drop-target");
        break;
      case "move":
        handleMove(event);
        break;
      case "home":
        handleHome(event);
        break;
      case "move-fail":
        resetCombo();
        visualFx.failFlash({ reason: event.reason });
        play(event.reason === "too-many" ? "fail-too-many" : "fail-invalid");
        pickEffect("fail", DOPA_ASSIGNMENTS.fail, { reason: event.reason });
        break;
      case "undo":
        resetCombo();
        visualFx.undoRipple({ cardIds: event.cardIds });
        play("undo");
        pickEffect("undo", DOPA_ASSIGNMENTS.undo, { cardIds: event.cardIds });
        break;
      case "deal":
        resetCombo();
        visualFx.dealSparkles({ cardIds: event.cardIds });
        play("deal");
        pickEffect("deal", DOPA_ASSIGNMENTS.deal, { cardIds: event.cardIds });
        break;
      case "hint":
        visualFx.hintRings({
          cardId: event.cardId,
          destZone: event.dest?.zone,
          destIndex: event.dest?.index,
        });
        play("hint");
        pickEffect("hint", DOPA_ASSIGNMENTS.hint, { cardId: event.cardId, dest: event.dest });
        break;
      case "auto-start":
        visualFx.dragLift({ on: false });
        play("auto-start");
        break;
      case "auto-end":
        play("auto-end");
        break;
      case "stuck":
        visualFx.stuckVignette();
        play("stuck");
        for (const id of DOPA_ASSIGNMENTS.stuck) {
          triggerEffect(id, {});
        }
        break;
      case "win":
        visualFx.winCelebrate({ mobile });
        play("win");
        // 既存 Canvas(4.5 秒)と共存させるため、勝利シーケンスは固定尺で 4.5 秒内に収める
        triggerEffect("f04-curtain", { source: "win", forceDuration: 1000 });
        scheduleSequence(
          () => triggerEffect("f05-glassbreak", { source: "win", forceDuration: 1000 }),
          1000
        );
        scheduleSequence(
          () => triggerEffect("f06-staffroll", { source: "win", forceDuration: 2100 }),
          2100
        );
        break;
      case "win-dismiss":
        clearSequenceTimers();
        visualFx.fadeWin();
        if (typeof visualFx.cancelEffects === "function") {
          visualFx.cancelEffects();
        }
        audioFx.stopAll({ fadeMs: 150 });
        break;
      default:
        break;
    }
    if (generation === gen) {
      lastEvent = { ...event, type, combo };
    }
  }

  function debugState() {
    const visualState = visualFx.getDebugState ? visualFx.getDebugState() : {};
    const audioState = audioFx.getDebugState ? audioFx.getDebugState() : {};
    return {
      enabled,
      combo,
      activeEffects: visualState.activeEffects ?? 0,
      activeVoices: audioState.activeVoices ?? 0,
      lastRecipe,
      lastIntensity,
      lastEventType: lastEvent ? lastEvent.type : null,
      reducedMotion,
      mobile,
      generation,
      effects: {
        registered: DOPA_EFFECT_IDS.slice(),
        counts: { ...effectCounts },
        active: visualState.activeEffects ?? 0,
        activeRegistry: visualState.activeRegistryEffects ?? 0,
        activeNodes: visualState.activeNodes ?? 0,
        activeClasses: visualState.activeClasses ?? 0,
        activeScreenEffects: visualState.activeScreenEffects ?? 0,
        history: effectHistory.slice(),
        last: lastEffectId,
        lastDuration,
        lastEpic,
        lastPlacement: visualState.lastPlacement ?? null,
        lastTextTimeline: visualState.lastTextTimeline ?? null,
        hitStopCount: visualState.hitStopCount ?? 0,
        lastHitStopMs: visualState.lastHitStopMs ?? 0,
        hitStopActive: !!visualState.hitStopActive,
      },
    };
  }

  return {
    isEnabled,
    setEnabled,
    unlock,
    handle,
    reset,
    debugState,
    triggerEffect,
  };
}
