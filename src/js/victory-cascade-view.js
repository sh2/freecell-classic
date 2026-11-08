/* =========================================================
 * 勝利時カスケード (victory cascade)
 * 勝利確定時にホーム 4 山からカードを放り、床で跳ねさせながら
 * #stamp-canvas にカード面を焼き付け、仕上げ花火で締める。
 * ゲーム状態には触れず、表示の層だけで完結する。
 * ========================================================= */

import { SUITS, RANKS } from "./constants.js";
import * as rules from "./rules.js";
import { burst, particleCountFor, canvasDpr } from "./fx.js";
import {
  RELEASE_INTERVAL_MS,
  FIREWORK_COUNT,
  FIREWORK_DELAY_MS,
  FIREWORK_BURST_LIMIT,
  GRACE_MS,
  STAMP_INTERVAL_MS,
  CARD_BG_TOP,
  CARD_BG_BOTTOM,
  CARD_BORDER,
  CARD_RED,
  CARD_BLACK,
  CORNER_RANK_FONT_RATIO,
  CORNER_SUIT_FONT_RATIO,
  CENTER_RANK_FONT_RATIO,
  CENTER_SUIT_FONT_RATIO,
  CORNER_PAD_X_RATIO,
  CORNER_PAD_Y_RATIO,
  CORNER_GAP_RATIO,
  CARD_RADIUS_RATIO,
  CENTER_MARK_MIN_WIDTH,
  buildReleaseSchedule,
  createFlightState,
  finalFireworkPoint,
  fireworkGapBefore,
  fireworkParticleMultiplier,
  fireworkPoint,
  fireworkSizeMultiplier,
  initialVelocity,
  resolveFloorY,
  stepFlight,
} from "./victory-cascade.js";

/** 勝利時カスケードの DOM 実行を生成する */
export function createVictoryCascadeView({
  cardElById,
  isAnimationsEnabled,
  prefersReducedMotion,
  getAnimLayer,
  cancelActiveFlight,
  boardGeometry,
}) {
  let victory = null; // 進行中の勝利時カスケード
  let victoryAftermath = null; // オーバーレイ表示後も残しているカスケード画像

  /** E2E 検証専用のデバッグ情報 */
  const victoryDebug = {
    fires: 0, // カスケードを開始した回数
    active: false, // カスケード進行中か
    released: 0, // 今回放出した枚数
    floorTouches: 0, // 今回床に触れたカード数
    fireworks: 0, // 今回打ち上げた仕上げ花火の数
    fireworksLog: [], // 発ごとの記録 { number, sizeMultiplier, particleMultiplier, particleCount, x, y, firedAt, intervalBeforeMs }
    stamps: 0, // 今回スタンプした回数
    resting: 0, // 今回静止してキャンバスへ移したカード数
    restingPositions: [], // 静止したカードの最終位置 { cardId, x, y, width, height }
    skipped: false, // 今回スキップされたか
    interrupted: 0, // 新規ゲームなどで中断された回数
    completed: 0, // 最後まで完了した回数
    visualsRemaining: false, // オーバーレイ表示後もカスケード画像が残っているか
    cleared: false, // カスケード画像を片付け済みか
  };
  if (typeof window !== "undefined") {
    window.__victoryDebug = victoryDebug;
  }

  /** カード面スプライト用の角丸パス */
  function roundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /** 実カードと同じ配色・配置でカード面 1 枚をオフスクリーン Canvas に描く */
  function createCardSprite(card, width, height, dpr) {
    if (!card || typeof document === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.scale(dpr, dpr);

    const radius = Math.max(2, width * CARD_RADIUS_RATIO);
    const gradient = ctx.createLinearGradient(0, 0, width * 0.42, height);
    gradient.addColorStop(0, CARD_BG_TOP);
    gradient.addColorStop(1, CARD_BG_BOTTOM);
    roundRectPath(ctx, 0.5, 0.5, width - 1, height - 1, radius);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    const color = rules.isRed(card) ? CARD_RED : CARD_BLACK;
    const rankText = RANKS[card.rank];
    const suitText = SUITS[card.suit];
    const rankFont = width * CORNER_RANK_FONT_RATIO;
    const suitFont = width * CORNER_SUIT_FONT_RATIO;
    const padX = width * CORNER_PAD_X_RATIO;
    const padY = height * CORNER_PAD_Y_RATIO;
    const gap = width * CORNER_GAP_RATIO;
    const fontFamily = '"Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';

    const drawCorner = (x, y) => {
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = `700 ${rankFont}px ${fontFamily}`;
      ctx.fillText(rankText, x, y);
      const rankWidth = ctx.measureText(rankText).width;
      ctx.font = `700 ${suitFont}px ${fontFamily}`;
      ctx.fillText(suitText, x + rankWidth + gap, y + (rankFont - suitFont) * 0.55);
    };

    drawCorner(padX, padY);
    ctx.save();
    ctx.translate(width, height);
    ctx.rotate(Math.PI);
    drawCorner(padX, padY);
    ctx.restore();

    if (width >= CENTER_MARK_MIN_WIDTH) {
      const centerRank = width * CENTER_RANK_FONT_RATIO;
      const centerSuit = width * CENTER_SUIT_FONT_RATIO;
      const centerGap = width * 0.02;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 ${centerRank}px ${fontFamily}`;
      ctx.fillText(rankText, width / 2, height / 2 - (centerSuit + centerGap) / 2);
      ctx.font = `700 ${centerSuit}px ${fontFamily}`;
      ctx.fillText(suitText, width / 2, height / 2 + (centerRank + centerGap) / 2);
    }
    return canvas;
  }

  /** #stamp-canvas / #trail-canvas を解像度上限 2 で初期化する */
  function setupCascadeCanvas(id) {
    const canvas = document.getElementById(id);
    if (!canvas) {
      return null;
    }
    const dpr = canvasDpr(typeof window !== "undefined" ? window.devicePixelRatio : 1);
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    return { canvas, ctx, dpr };
  }

  /** スタンプを全消去する */
  function clearStampCanvas(stamp) {
    if (!stamp || !stamp.ctx) {
      return;
    }
    stamp.ctx.save();
    stamp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    stamp.ctx.clearRect(0, 0, stamp.canvas.width, stamp.canvas.height);
    stamp.ctx.restore();
  }

  /* ---------------- スキップ入力の抑止 ---------------- */

  // カスケード中の最初のポインタ / キー入力はスキップだけに使い、
  // 同じ入力でゲーム操作・ボタン操作が走らないよう capture 段階で止める。
  // スキップ後の click / keyup も 1 回だけ握りつぶす。
  let victoryInput = null;
  let victorySwallow = null;

  function removeVictorySwallow() {
    if (!victorySwallow) {
      return;
    }
    if (victorySwallow.timer !== null) {
      clearTimeout(victorySwallow.timer);
    }
    document.removeEventListener("click", victorySwallow.onClick, true);
    document.removeEventListener("keyup", victorySwallow.onKeyUp, true);
    victorySwallow = null;
  }

  function armVictorySwallow() {
    if (victorySwallow) {
      if (victorySwallow.timer !== null) {
        clearTimeout(victorySwallow.timer);
      }
    } else {
      const onClick = (e) => {
        removeVictorySwallow();
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const onKeyUp = (e) => {
        removeVictorySwallow();
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      document.addEventListener("click", onClick, true);
      document.addEventListener("keyup", onKeyUp, true);
      victorySwallow = { onClick, onKeyUp, timer: null };
    }
    victorySwallow.timer = setTimeout(removeVictorySwallow, 700);
  }

  function installVictoryInput() {
    if (victoryInput) {
      return;
    }
    const onPointerDown = (e) => {
      if (!victory) {
        return;
      }
      armVictorySwallow();
      skipVictoryCascade();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKeyDown = (e) => {
      if (!victory) {
        return;
      }
      armVictorySwallow();
      skipVictoryCascade();
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    victoryInput = { onPointerDown, onKeyDown };
  }

  function removeVictoryInput() {
    if (!victoryInput) {
      return;
    }
    document.removeEventListener("pointerdown", victoryInput.onPointerDown, true);
    document.removeEventListener("keydown", victoryInput.onKeyDown, true);
    victoryInput = null;
  }

  /* ---------------- カスケード本体 ---------------- */

  function allVictoryFlightsResting(controller) {
    return controller.flights.length > 0 && controller.flights.every((flight) => flight.resting);
  }

  /** 全カードが放出済みかつ一度は床に触れたら、1 秒後に仕上げ花火を予約する */
  function maybeScheduleVictoryFireworks() {
    const controller = victory;
    if (!controller || controller.finished || controller.fireworksScheduled) {
      return;
    }
    if (!controller.allReleased) {
      return;
    }
    if (!controller.flights.every((flight) => flight.touchedFloor)) {
      return;
    }
    controller.fireworksScheduled = true;
    controller.fireworksTimer = setTimeout(startVictoryFireworks, FIREWORK_DELAY_MS);
  }

  /** 仕上げ花火を 1 発上げ、残りがあれば間隔を空けて次を予約する */
  function launchVictoryFirework() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    const fireNumber = controller.fireworksLaunched + 1;
    const isFinal = fireNumber === FIREWORK_COUNT;
    const point = isFinal
      ? finalFireworkPoint(controller.gameRect)
      : fireworkPoint(Math.random, controller.gameRect);
    const sizeMultiplier = fireworkSizeMultiplier(fireNumber);
    const particleMultiplier = fireworkParticleMultiplier(fireNumber);
    const firedAt = performance.now();
    burst(point.x, point.y, controller.cardWidth, FIREWORK_BURST_LIMIT, {
      sizeMultiplier,
      particleMultiplier,
    });
    const previous = victoryDebug.fireworksLog[victoryDebug.fireworksLog.length - 1];
    victoryDebug.fireworksLog.push({
      number: fireNumber,
      sizeMultiplier,
      particleMultiplier,
      particleCount: particleCountFor(particleMultiplier),
      x: point.x,
      y: point.y,
      firedAt,
      intervalBeforeMs: previous ? firedAt - previous.firedAt : null,
    });
    controller.fireworksLaunched++;
    victoryDebug.fireworks = controller.fireworksLaunched;
    if (controller.fireworksLaunched < FIREWORK_COUNT) {
      const nextNumber = controller.fireworksLaunched + 1;
      controller.fireworksTimer = setTimeout(launchVictoryFirework, fireworkGapBefore(nextNumber));
    } else {
      controller.fireworksTimer = null;
      maybeFinishVictory();
    }
  }

  function startVictoryFireworks() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    launchVictoryFirework();
  }

  /** 全カード静止 + 全花火発射が揃ったら、余韻を置いて終了する */
  function maybeFinishVictory() {
    const controller = victory;
    if (!controller || controller.finished || controller.finishTimer !== null) {
      return;
    }
    if (controller.fireworksLaunched < FIREWORK_COUNT) {
      return;
    }
    if (!allVictoryFlightsResting(controller)) {
      return;
    }
    controller.finishTimer = setTimeout(() => {
      finishVictoryCascade({ skipped: false });
    }, GRACE_MS);
  }

  /**
   * カスケードの画像（クローン・スタンプ・隠していた実カード）を片付ける。
   * オーバーレイが閉じたとき、または中断時に呼ぶ。冪等。
   */
  function cleanupVictoryVisuals(controller) {
    if (!controller || controller.cleaned) {
      return;
    }
    controller.cleaned = true;
    for (const clone of controller.clones) {
      if (clone.parentNode) {
        clone.parentNode.removeChild(clone);
      }
    }
    for (const el of controller.hiddenEls) {
      el.classList.remove("anim-hidden");
    }
    clearStampCanvas(controller.stamp);
    clearStampCanvas(controller.trail);
    if (victoryAftermath === controller) {
      victoryAftermath = null;
    }
    victoryDebug.visualsRemaining = false;
    victoryDebug.cleared = true;
  }

  /**
   * カスケードの進行を終える。interrupted のときは画像を即片付けて
   * オーバーレイを出さない。それ以外は画像を残したまま onComplete
   * (勝利オーバーレイ表示)を呼び、片付けは hideOverlay() に任せる。
   */
  function finishVictoryCascade({ skipped = false, interrupted = false } = {}) {
    const controller = victory;
    if (!controller) {
      return;
    }
    controller.finished = true;
    victory = null;
    if (controller.releaseTimer !== null) {
      clearTimeout(controller.releaseTimer);
      controller.releaseTimer = null;
    }
    if (controller.fireworksTimer !== null) {
      clearTimeout(controller.fireworksTimer);
      controller.fireworksTimer = null;
    }
    if (controller.finishTimer !== null) {
      clearTimeout(controller.finishTimer);
      controller.finishTimer = null;
    }
    if (controller.rafId !== null) {
      cancelAnimationFrame(controller.rafId);
      controller.rafId = null;
    }
    removeVictoryInput();
    victoryDebug.active = false;
    if (interrupted) {
      cleanupVictoryVisuals(controller);
      victoryDebug.interrupted++;
    } else {
      // モーダルの背後にカスケード画像を残す
      if (victoryAftermath) {
        cleanupVictoryVisuals(victoryAftermath);
      }
      victoryAftermath = controller;
      victoryDebug.visualsRemaining = true;
      victoryDebug.cleared = false;
      if (skipped) {
        victoryDebug.skipped = true;
      } else {
        victoryDebug.completed++;
      }
    }
    if (!interrupted && typeof controller.onComplete === "function") {
      controller.onComplete();
    }
  }

  /** 新しいゲームなどで演出だけを中断する(オーバーレイは出さない) */
  function abortVictoryCascade() {
    if (victory) {
      finishVictoryCascade({ interrupted: true });
    }
  }

  /** 入力によるスキップ。片付け後に勝利オーバーレイを出す */
  function skipVictoryCascade() {
    if (victory) {
      finishVictoryCascade({ skipped: true });
    }
  }

  /** 放出予定が残っていれば次の 1 枚を予約する */
  function scheduleNextVictoryRelease() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    if (controller.releaseIndex >= controller.schedule.length) {
      controller.allReleased = true;
      maybeScheduleVictoryFireworks();
      return;
    }
    controller.releaseTimer = setTimeout(releaseVictoryCard, RELEASE_INTERVAL_MS);
  }

  /** 飛行カードの現在位置を指定キャンバスへ描く */
  function stampVictorySprite(controller, flight, target, countStamp) {
    const sprite = controller.sprites.get(flight.cardId);
    if (!sprite) {
      return false;
    }
    target.ctx.drawImage(sprite, flight.x, flight.y, flight.width, flight.height);
    if (countStamp) {
      victoryDebug.stamps++;
    }
    return true;
  }

  /**
   * 飛行が静止したカードを最終位置でスタンプ用キャンバスへ焼き、DOM クローンを外す。
   * 以後の見た目はスタンプ用キャンバスの絵だけになる(B2)。
   * 軌跡は別キャンバス(#trail-canvas)なので、静止後の再スタンプは行わない。
   */
  function restVictoryFlight(controller, flight) {
    stampVictorySprite(controller, flight, controller.stamp, true);
    flight.resting = true;
    controller.restingCount++;
    victoryDebug.resting = controller.restingCount;
    victoryDebug.restingPositions.push({
      cardId: flight.cardId,
      x: flight.x,
      y: flight.y,
      width: flight.width,
      height: flight.height,
    });
    const clone = flight.clone;
    if (clone) {
      if (clone.parentNode) {
        clone.parentNode.removeChild(clone);
      }
      const index = controller.clones.indexOf(clone);
      if (index !== -1) {
        controller.clones.splice(index, 1);
      }
      flight.clone = null;
    }
  }

  /** ホーム山から 1 枚をクローンとして放出する */
  function releaseVictoryCard() {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    controller.releaseTimer = null;
    if (controller.releaseIndex >= controller.schedule.length) {
      controller.allReleased = true;
      maybeScheduleVictoryFireworks();
      return;
    }
    const item = controller.schedule[controller.releaseIndex];
    controller.releaseIndex++;
    const realEl = cardElById(item.cardId);
    const sprite = controller.sprites.get(item.cardId);
    if (!realEl || !sprite) {
      scheduleNextVictoryRelease();
      return;
    }
    const rect = realEl.getBoundingClientRect();
    const velocity = initialVelocity();
    const flight = createFlightState({
      x: rect.left,
      y: rect.top,
      width: controller.cardWidth,
      height: controller.cardHeight,
      vx: velocity.vx,
      vy: velocity.vy,
    });
    flight.cardId = item.cardId;
    flight.homeIndex = item.homeIndex;
    flight.realEl = realEl;

    const clone = realEl.cloneNode(true);
    clone.classList.remove(
      "selected",
      "movable",
      "shake",
      "anim-hidden",
      "hint-source",
      "hint-target",
      "drop-hint",
      "drop-target",
      "drag-hidden"
    );
    clone.classList.add("victory-clone");
    clone.style.left = "0px";
    clone.style.top = "0px";
    clone.style.width = `${flight.width}px`;
    clone.style.height = `${flight.height}px`;
    clone.style.zIndex = String(2000 + controller.releaseIndex);
    clone.style.transform = `translate3d(${flight.x}px, ${flight.y}px, 0px)`;
    getAnimLayer().appendChild(clone);
    realEl.classList.add("anim-hidden");

    flight.clone = clone;
    controller.flights.push(flight);
    controller.clones.push(clone);
    controller.hiddenEls.push(realEl);
    victoryDebug.released = controller.flights.length;
    scheduleNextVictoryRelease();
  }

  /** クローンの位置は transform だけで更新する(left/top は 0 固定) */
  function positionVictoryClone(flight) {
    if (!flight.clone) {
      return;
    }
    flight.clone.style.transform = `translate3d(${flight.x}px, ${flight.y}px, 0px)`;
  }

  /** 放出済みカードの物理更新とスタンプ描画 */
  function victoryTick(now) {
    const controller = victory;
    if (!controller || controller.finished) {
      return;
    }
    controller.rafId = null;
    if (controller.lastFrame === null) {
      controller.lastFrame = now;
      controller.lastStamp = now;
    }
    const dt = Math.min(0.05, Math.max(0, (now - controller.lastFrame) / 1000));
    controller.lastFrame = now;

    for (const flight of controller.flights) {
      if (flight.resting) {
        continue;
      }
      const result = stepFlight(flight, dt, controller.bounds);
      if (result.landed) {
        victoryDebug.floorTouches++;
        maybeScheduleVictoryFireworks();
      }
      if (flight.resting) {
        restVictoryFlight(controller, flight);
      } else {
        positionVictoryClone(flight);
      }
    }

    const hasFlying = controller.flights.some((flight) => !flight.resting);
    const stampDue = now - controller.lastStamp >= STAMP_INTERVAL_MS;
    if (hasFlying && stampDue) {
      controller.lastStamp = now;
      for (const flight of controller.flights) {
        if (flight.resting) {
          continue;
        }
        // 軌跡は stamp の下にある専用キャンバスへ描く
        stampVictorySprite(controller, flight, controller.trail, true);
      }
    }

    maybeFinishVictory();
    if (victory === controller && !controller.finished) {
      controller.rafId = requestAnimationFrame(victoryTick);
    }
  }

  /**
   * 勝利時カスケードを開始する。開始できたら true、無効時は false。
   * onComplete は「スキップ or 正常完了」で片付け後に 1 回呼ぶ
   * (新規ゲームによる中断では呼ばない)。
   */
  function startVictoryCascade(state, onComplete) {
    if (victory) {
      return true;
    }
    if (!isAnimationsEnabled() || prefersReducedMotion()) {
      return false;
    }
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
    const schedule = buildReleaseSchedule(state.foundations);
    if (schedule.length === 0) {
      return false;
    }
    const layer = getAnimLayer();
    const gameEl = document.getElementById("game");
    const stamp = setupCascadeCanvas("stamp-canvas");
    const trail = setupCascadeCanvas("trail-canvas");
    const firstEl = cardElById(schedule[0].cardId);
    if (!layer || !gameEl || !stamp || !trail || !firstEl) {
      return false;
    }
    // 勝利の最終手がまだ飛んでいる場合、そのクローンと anim-hidden を確定して
    // からカスケードを始める(ホーム山の見た目と隠し状態が競合しないようにする)
    cancelActiveFlight();
    // カード寸法とフッター上端は保持値を使う(P3)
    const cardWidth = boardGeometry.cardWidth || 88;
    const cardHeight = boardGeometry.cardHeight || 124;
    const cardById = new Map();
    for (const pile of state.foundations) {
      for (const card of pile) {
        cardById.set(card.id, card);
      }
    }
    const sprites = new Map();
    for (const item of schedule) {
      const card = cardById.get(item.cardId);
      const sprite = createCardSprite(card, cardWidth, cardHeight, stamp.dpr);
      if (sprite) {
        sprites.set(item.cardId, sprite);
      }
    }
    // 花火の位置は盤面の実寸(ゲーム高さは山の伸びで変わる)から決める。
    // 開始時に一度だけ測る。
    const gameRect = gameEl.getBoundingClientRect();
    const footerTop = boardGeometry.footerTop;
    const controller = {
      onComplete,
      schedule,
      releaseIndex: 0,
      flights: [],
      restingCount: 0,
      clones: [],
      hiddenEls: [],
      sprites,
      stamp,
      trail,
      cardWidth,
      cardHeight,
      gameRect,
      bounds: {
        left: 0,
        right: boardGeometry.viewportWidth || window.innerWidth,
        floor: resolveFloorY(
          footerTop,
          gameRect.bottom,
          boardGeometry.viewportHeight || window.innerHeight
        ),
      },
      releaseTimer: null,
      rafId: null,
      lastFrame: null,
      lastStamp: 0,
      allReleased: false,
      fireworksScheduled: false,
      fireworksTimer: null,
      fireworksLaunched: 0,
      finishTimer: null,
      finished: false,
      cleaned: false,
    };
    victory = controller;
    victoryDebug.fires++;
    victoryDebug.active = true;
    victoryDebug.released = 0;
    victoryDebug.floorTouches = 0;
    victoryDebug.fireworks = 0;
    victoryDebug.fireworksLog = [];
    victoryDebug.stamps = 0;
    victoryDebug.resting = 0;
    victoryDebug.restingPositions = [];
    victoryDebug.skipped = false;
    victoryDebug.visualsRemaining = true;
    victoryDebug.cleared = false;
    installVictoryInput();
    releaseVictoryCard();
    controller.rafId = requestAnimationFrame(victoryTick);
    return true;
  }

  function isVictoryCascadeActive() {
    return victory !== null;
  }

  /** render 先頭の分岐を現行順序のまま再現する */
  function prepareRender(state) {
    // 勝利オーバーレイ表示中はカスケード画像を保持するため再描画しない
    // (モーダルが閉じたとき hideOverlay() が画像を片付ける)
    if (victoryAftermath) {
      if (state.won) {
        return "skip";
      }
      cleanupVictoryVisuals(victoryAftermath);
    }
    // カスケード中に盤面が作り直される場合:
    // - 新しいゲーム (won=false) は演出を中断し、オーバーレイも出さない
    // - 勝利したままの再描画(リサイズ等)は演出を終えて通常表示+オーバーレイへ
    if (victory) {
      if (!state.won) {
        abortVictoryCascade();
      } else {
        finishVictoryCascade({ skipped: false });
        return "finish";
      }
    }
    return "continue";
  }

  /** オーバーレイを閉じたときの片付け。aftermath が無ければ何もしない */
  function cleanupAftermath() {
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
  }

  /** アニメーション無効化時の即時終了 */
  function finishNow() {
    finishVictoryCascade({ skipped: false });
  }

  function isActive() {
    return victory !== null;
  }

  return {
    start: startVictoryCascade,
    isActive,
    skip: skipVictoryCascade,
    abort: abortVictoryCascade,
    prepareRender,
    cleanupAftermath,
    finishNow,
  };
}
