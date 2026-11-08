/* =========================================================
 * View 層 (DOM 構築・描画・通知・勝利画面)
 * DOM 参照はこのモジュールと配下の表示モジュール内へ閉じ込める。
 * ゲーム状態 (state) は引数で受け取り、直接変更しない。
 * タイマーの経過時間計算や乱数生成などの非 DOM ロジックは持たない。
 * ========================================================= */

import { SUITS, RANKS, NUM_CASCADES, NUM_FREE, NUM_HOME } from "./constants.js";
import * as rules from "./rules.js";
import * as gameState from "./game-state.js";
import { createHintView } from "./hint-view.js";
import { createLandingEffects } from "./landing-effects.js";
import { createCardAnimations } from "./card-animations.js";
import { createDragPhysics } from "./drag-physics.js";
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

/** View を生成する。DOM 要素の参照はクロージャ内に保持する */
export function createView() {
  /* ---------------- DOM 参照 ---------------- */

  const freeSlotEls = [];
  const homeSlotEls = [];
  const cascadeEls = [];
  let dragLayer = null;
  // cardId -> 盤面のカード要素。render() をまたいで保持し、出入りのあった
  // カードだけを生成・破棄する(毎回 52 枚を作り直さない)。
  const cardElMap = new Map();
  // 盤面ジオメトリのキャッシュ。初期化とリサイズのときだけ測り直す(P3)。
  const boardGeometry = {
    cardWidth: 88,
    cardHeight: 124,
    areaTop: 0,
    footerTop: null,
    footerReserve: 68,
    viewportWidth: 0,
    viewportHeight: 0,
    budget: 280,
  };
  let boardGeometryResizeBound = false;
  // 同期描画中だけ対象カードのトランジションを止める(P4)。
  const transitionSuppressEls = new Map();
  let transitionSuppressSeq = 0;
  let toastHandle = null;
  let victory = null; // 進行中の勝利時カスケード
  let victoryAftermath = null; // オーバーレイ表示後も残しているカスケード画像

  /* ---------------- ドラッグの物理 ---------------- */

  // ドラッグレイヤー内のカードに transform で傾き・追随遅れを付ける。
  // 先頭カードの位置 (レイヤーの left/top) は従来どおりポインタへ直接合わせ、
  // 遅らせるのは後続カードの相対オフセットと先頭の傾きだけ。
  let dragPhysics = null;
  let dragPhysicsEls = [];
  let dragRafId = null;
  let dragLastFrameTime = null;
  let dragLastLeft = null;
  let dragLastTop = null;

  /** E2E 検証専用のデバッグ情報 (現在の傾き角と各カードの遅れ量) */
  const dragDebug = { enabled: false, active: false, tilt: 0, velocity: 0, offsets: [] };
  if (typeof window !== "undefined") {
    window.__dragDebug = dragDebug;
  }

  /* ---------------- 勝利時カスケードのデバッグ ---------------- */

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

  /* ---------------- カード要素の生成 ---------------- */

  /** 中央にランク(大)とスート(小)を縦に並べる MS FreeCell 風の表示 */
  function centerMarkHtml(card) {
    return `<div class="center-mark"><span class="center-rank">${RANKS[card.rank]}</span><span class="center-suit">${SUITS[card.suit]}</span></div>`;
  }

  function makeCardEl(card) {
    const el = document.createElement("div");
    el.className = "card " + (rules.isRed(card) ? "red" : "black");
    el.dataset.cardId = card.id;
    const corner = (cls) =>
      `<div class="corner ${cls}"><span class="rank">${RANKS[card.rank]}</span><span class="suit">${SUITS[card.suit]}</span></div>`;
    el.innerHTML = corner("top") + centerMarkHtml(card) + corner("bottom");
    return el;
  }

  function cardElById(cardId) {
    const id = Number(cardId);
    const el = cardElMap.get(id);
    if (el) {
      return el;
    }
    return document.querySelector(`#game .card[data-card-id="${id}"]`);
  }

  // 再描画時に要素から落とす一時クラス。selected / movable は
  // updateHighlights が状態との差分だけを付け替える。
  const CARD_TRANSIENT_CLASSES = [
    "drop-hint",
    "drop-target",
    "drag-hidden",
    "shake",
    "anim-hidden",
    "hint-source",
    "hint-target",
  ];
  const CARD_TRANSITION_CLASSES = new Set([
    "selected",
    "movable",
    "drop-hint",
    "drop-target",
    "hint-source",
    "hint-target",
  ]);

  /** 同期描画中だけ、そのカードのトランジションを止める */
  function suppressCardTransition(el) {
    if (!el) {
      return;
    }
    transitionSuppressSeq++;
    const token = transitionSuppressSeq;
    transitionSuppressEls.set(el, token);
    el.style.transition = "none";
    // 最初の描画を済ませた次のフレームで戻す。連続描画では最新の指定だけ有効。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (transitionSuppressEls.get(el) !== token) {
          return;
        }
        transitionSuppressEls.delete(el);
        el.style.transition = "";
      });
    });
  }

  function clearCardTransitionSuppression(el) {
    if (!el || !transitionSuppressEls.has(el)) {
      return;
    }
    transitionSuppressEls.delete(el);
    el.style.transition = "";
  }

  /**
   * 指定カードの要素を返す。前回の render で使った要素があればそれを再利用し、
   * 再描画で消える一時クラスだけを落とす。選択・移動可能のクラスは
   * updateHighlights が差分で更新する。配置スタイル(top / z-index)は
   * 呼び出し側のゾーンに合わせて設定する。無ければ生成する。
   */
  function reusableCardEl(card) {
    let el = cardElMap.get(card.id);
    if (!el) {
      el = makeCardEl(card);
      cardElMap.set(card.id, el);
      return el;
    }
    for (const cls of CARD_TRANSIENT_CLASSES) {
      if (!el.classList.contains(cls)) {
        continue;
      }
      if (CARD_TRANSITION_CLASSES.has(cls)) {
        suppressCardTransition(el);
      }
      el.classList.remove(cls);
    }
    return el;
  }

  /** 列以外のゾーンへ置くカードから、列用の配置スタイルを落とす */
  function resetCardPlacement(el) {
    if (el.style.top !== "") {
      el.style.top = "";
    }
    if (el.style.zIndex !== "") {
      el.style.zIndex = "";
    }
  }

  /**
   * コンテナ内のカード子要素を desiredEls の順に揃える。
   * desiredEls に無いカードは取り除き、既に同じ並びなら DOM を触らない。
   * ゾーン間を移動した要素は insertBefore で付け替える(要素は作り直さない)。
   */
  function reconcileCards(container, desiredEls) {
    const desired = new Set(desiredEls);
    for (const child of [...container.children]) {
      if (child.classList.contains("card") && !desired.has(child)) {
        container.removeChild(child);
      }
    }
    const current = [];
    for (const child of container.children) {
      if (child.classList.contains("card")) {
        current.push(child);
      }
    }
    if (
      current.length === desiredEls.length &&
      current.every((el, i) => el === desiredEls[i])
    ) {
      return;
    }
    // 後ろから揃えると、動かす必要のある要素だけを挿入できる。
    let next = null;
    for (let i = desiredEls.length - 1; i >= 0; i--) {
      const el = desiredEls[i];
      if (el.parentNode === container && el.nextElementSibling === next) {
        next = el;
        continue;
      }
      container.insertBefore(el, next);
      next = el;
    }
  }

  /**
   * 盤面ジオメトリを実測して保持する(P3)。render() からは呼ばず、
   * 盤面初期化時と resize のときだけ呼ぶ。
   */
  function measureBoardGeometry() {
    const freeSlot = freeSlotEls[0];
    const cascade = cascadeEls[0];
    const footerEl = document.querySelector(".site-footer");
    const gameEl = document.getElementById("game");
    if (freeSlot) {
      const rect = freeSlot.getBoundingClientRect();
      boardGeometry.cardWidth = rect.width || 88;
      boardGeometry.cardHeight = rect.height || 124;
    }
    if (cascade) {
      boardGeometry.areaTop = cascade.getBoundingClientRect().top;
    }
    const footerRect = footerEl ? footerEl.getBoundingClientRect() : null;
    boardGeometry.footerTop = footerRect ? footerRect.top : null;
    boardGeometry.viewportWidth = window.innerWidth;
    boardGeometry.viewportHeight = window.innerHeight;
    const gamePadBottom = gameEl
      ? parseFloat(getComputedStyle(gameEl).paddingBottom) || 0
      : 0;
    boardGeometry.footerReserve =
      gamePadBottom + (footerRect ? footerRect.height : 56) + 12;
    boardGeometry.budget = Math.max(
      280,
      boardGeometry.viewportHeight - boardGeometry.areaTop - boardGeometry.footerReserve
    );
  }

  function bindBoardGeometryResize() {
    if (boardGeometryResizeBound || typeof window === "undefined") {
      return;
    }
    window.addEventListener("resize", measureBoardGeometry);
    boardGeometryResizeBound = true;
  }

  /* ---------------- カード移動・配布アニメーション ---------------- */

  const cardAnimations = createCardAnimations({
    cardElById,
    getDragLayer: () => dragLayer,
    prefersReducedMotion,
  });

  /** OS / ブラウザーの reduced-motion 設定が有効か */
  function prefersReducedMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* ---------------- セル着地エフェクト ---------------- */

  // 着地演出の DOM 実装は landing-effects.js が担当する。
  const landingEffects = createLandingEffects({
    cardElById,
    isAnimationsEnabled: () => cardAnimations.isEnabled(),
    prefersReducedMotion,
    getSnapWillChangeToken: (el) => cardAnimations.getSnapWillChangeToken(el),
    clearSnapWillChange: cardAnimations.clearSnapWillChange,
  });

  function playLandingEffects(landing) {
    return landingEffects.playLandingEffects(landing);
  }

  /* ---------------- 描画 ---------------- */

  function render(state) {
    // 勝利オーバーレイ表示中はカスケード画像を保持するため再描画しない
    // (モーダルが閉じたとき hideOverlay() が画像を片付ける)
    if (victoryAftermath) {
      if (state.won) {
        return;
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
        return;
      }
    }
    // 再描画で盤面を更新する前に、進行中の配布と飛行は即座に確定する
    cardAnimations.finishDeal({ forced: true });
    cardAnimations.cancelActiveFlight();
    const desiredIds = new Set();
    // --- フリーセル ---
    for (let i = 0; i < NUM_FREE; i++) {
      const slot = freeSlotEls[i];
      const card = state.freeCells[i];
      const desired = [];
      if (card) {
        const el = reusableCardEl(card);
        resetCardPlacement(el);
        desired.push(el);
        desiredIds.add(card.id);
      }
      reconcileCards(slot, desired);
    }
    // --- ホーム ---
    // ホームの山札を全カード重ねて描画する(見た目は最上位 1 枚と同じ)。
    // 飛行アニメーションで各カードが個別にホームへ飛べるよう、全カードに
    // DOM 要素を持たせるため(最上位だけ描画すると下のカードの要素が無い)。
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = homeSlotEls[i];
      const pile = state.foundations[i];
      slot.dataset.label = pile.length > 0 ? SUITS[pile[pile.length - 1].suit] : "A";
      const desired = pile.map((card) => {
        const el = reusableCardEl(card);
        resetCardPlacement(el);
        desiredIds.add(card.id);
        return el;
      });
      reconcileCards(slot, desired);
    }
    // --- カスケード ---
    // ジオメトリは初期化・リサイズ時に測って保持した値を使う(P3)。
    // 山の下端がフッター(画面下端に張り付いている)より下に伸びないよう、
    // 「#game の下パディング + フッターの高さ + 余白」を下側の予約域として
    // 確保する。これにより通常のディールでは山が伸縮してもフッターは
    // 押し出されない。予約域を超える極端な積み上げでは budget の下限
    // (280px)が優先され、フッターはコンテンツに押されて下へ追い出される
    // (スクロールで到達できる)
    const cardH = boardGeometry.cardHeight;
    const budget = boardGeometry.budget;
    for (let i = 0; i < NUM_CASCADES; i++) {
      const wrap = cascadeEls[i];
      const pile = state.cascades[i];
      const overlap =
        pile.length > 1
          ? Math.min(34, Math.max(20, (budget - cardH) / (pile.length - 1)))
          : 0;
      // カードは position: absolute でレイアウト高さに反映されないため、
      // 山の見た目の高さを wrap の高さに設定する(後続のフッターなどの
      // 要素がカードの下に回り込まないようにするため)
      wrap.style.height =
        pile.length > 0 ? (pile.length - 1) * overlap + cardH + "px" : "";
      const desired = pile.map((card, idx) => {
        const el = reusableCardEl(card);
        el.style.top = idx * overlap + "px";
        el.style.zIndex = idx + 1;
        desiredIds.add(card.id);
        return el;
      });
      reconcileCards(wrap, desired);
    }
    // 状態から消えたカード(テスト用 fixture など)の要素を片付ける
    for (const [id, el] of cardElMap) {
      if (desiredIds.has(id)) {
        continue;
      }
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      cardAnimations.clearSnapWillChange(el);
      clearCardTransitionSuppression(el);
      cardElMap.delete(id);
    }
    updateHighlights(state);
    updateStatus(state);
    cardAnimations.playArmedAnimations();
  }

  /* =========================================================
   * 移動アニメーション・配布アニメーションの接続
   * 実装は card-animations.js。view は公開 API と内部呼び出しを保つ。
   * ========================================================= */

  function setAnimationsEnabled(enabled) {
    cardAnimations.setEnabled(enabled, () => {
      if (victory) {
        finishVictoryCascade({ skipped: false });
      }
    });
  }

  /* =========================================================
   * 勝利時カスケード (victory cascade)
   * 勝利確定時にホーム 4 山からカードを放り、床で跳ねさせながら
   * #stamp-canvas にカード面を焼き付け、仕上げ花火で締める。
   * ゲーム状態には触れず、表示の層だけで完結する。
   * ========================================================= */

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
    cardAnimations.getAnimLayer().appendChild(clone);
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
    if (!cardAnimations.isEnabled() || prefersReducedMotion()) {
      return false;
    }
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
    const schedule = buildReleaseSchedule(state.foundations);
    if (schedule.length === 0) {
      return false;
    }
    const layer = cardAnimations.getAnimLayer();
    const gameEl = document.getElementById("game");
    const stamp = setupCascadeCanvas("stamp-canvas");
    const trail = setupCascadeCanvas("trail-canvas");
    const firstEl = cardElById(schedule[0].cardId);
    if (!layer || !gameEl || !stamp || !trail || !firstEl) {
      return false;
    }
    // 勝利の最終手がまだ飛んでいる場合、そのクローンと anim-hidden を確定して
    // からカスケードを始める(ホーム山の見た目と隠し状態が競合しないようにする)
    cardAnimations.cancelActiveFlight();
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

  /** カードのクラスを差分で付け替える。トランジション対象なら同期描画中だけ止める */
  function setCardClass(el, cls, on) {
    if (el.classList.contains(cls) === on) {
      return;
    }
    if (CARD_TRANSITION_CLASSES.has(cls)) {
      suppressCardTransition(el);
    }
    el.classList.toggle(cls, on);
  }

  function updateHighlights(state) {
    const movableIds = new Set();
    for (let i = 0; i < NUM_CASCADES; i++) {
      const pile = state.cascades[i];
      for (let pos = 0; pos < pile.length; pos++) {
        if (rules.isValidSequence(pile.slice(pos))) {
          movableIds.add(pile[pos].id);
        }
      }
    }
    for (let i = 0; i < NUM_FREE; i++) {
      if (state.freeCells[i]) {
        movableIds.add(state.freeCells[i].id);
      }
    }
    const selectedIds = new Set(
      state.selected ? gameState.selectedGroup(state).map((card) => card.id) : []
    );
    for (const [id, el] of cardElMap) {
      setCardClass(el, "movable", movableIds.has(id));
      setCardClass(el, "selected", selectedIds.has(id));
    }
  }

  /* ---------------- コントロール Enable/Disable の一元管理 ---------------- */

  // syncControls が参照する UI 状態(最後に描画したゲーム状態とソルバーUIのフラグを集約)
  let controlsState = {
    lastState: null, // 最後に描画したゲーム状態(render 時に更新)
    autoSolving: false, // 自動解答中(計算・再生)
    solverBusy: false, // ソルバー計算中
    solverMode: null, // "hint" | "auto" | null(ラベル書き換えの対象を限定)
  };

  /** 状態表(docs/ui-state-matrix.md 4章)に準拠してツールバーの disabled を同期する */
  function syncControls() {
    const { lastState, autoSolving: autoSolvingFlag, solverBusy, solverMode } = controlsState;
    const won = lastState ? lastState.won : false;
    const hasHistory = lastState ? lastState.historyStack.length > 0 : false;
    const hasAutoMove = lastState ? gameState.hasAutoMove(lastState) : false;
    const busyHint = solverMode === "hint" && solverBusy;
    const busyAuto = solverMode === "auto" && solverBusy;
    const autoSolving = autoSolvingFlag || busyAuto;

    const newGameBtn = document.getElementById("new-game-btn");
    const restartBtn = document.getElementById("restart-btn");
    const undoBtn = document.getElementById("undo-btn");
    const autoMoveBtn = document.getElementById("auto-move-btn");
    const hintBtn = document.getElementById("hint-btn");
    const autoToggle = document.getElementById("auto-solve-toggle");
    const autoMoveToggle = document.getElementById("auto-move-toggle");
    const seedInput = document.getElementById("seed-input");
    const startBtn = document.getElementById("start-game-btn");

    const disableNewGameRelated = autoSolving;
    if (newGameBtn) {
      newGameBtn.disabled = disableNewGameRelated;
    }
    if (restartBtn) {
      restartBtn.disabled = disableNewGameRelated;
    }
    if (seedInput) {
      seedInput.disabled = disableNewGameRelated;
    }
    if (startBtn) {
      startBtn.disabled = disableNewGameRelated;
    }

    if (undoBtn) {
      undoBtn.disabled = won || !hasHistory || autoSolving;
    }
    if (autoMoveBtn) {
      autoMoveBtn.disabled = won || autoSolving || busyHint || !hasAutoMove;
    }
    if (hintBtn) {
      hintBtn.disabled = won || busyHint || busyAuto;
    }
    if (autoToggle) {
      if (won) {
        autoToggle.disabled = true;
      } else if (busyHint) {
        autoToggle.disabled = true;
      } else {
        autoToggle.disabled = false;
      }
    }
    if (autoMoveToggle) {
      autoMoveToggle.disabled = won || autoSolving;
    }
  }

  function updateStatus(state) {
    controlsState.lastState = state;
    document.getElementById("move-counter").textContent = `手数: ${state.moveCount}`;
    syncControls();
  }

  /* ---------------- タイマー表示 ---------------- */

  function setTimerLabel(text) {
    document.getElementById("timer").textContent = text;
  }

  /* ---------------- フィードバック(トースト / シェイク) ---------------- */

  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add("show");
    if (toastHandle) {
      clearTimeout(toastHandle);
    }
    toastHandle = setTimeout(() => toast.classList.remove("show"), 1800);
  }

  function shakeEl(el) {
    if (!el) {
      return;
    }
    el.classList.remove("shake");
    void el.offsetWidth; // アニメーション再開用
    el.classList.add("shake");
  }

  function tooManyMessage(limit) {
    return `一度に移動できるのは最大 ${limit} 枚です(空きセル・空き列が増えるとさらに増えます)`;
  }

  /** 失敗手のフィードバック(トーストと対象スロットのシェイク) */
  function failFeedback(res, destZone, destIndex) {
    if (res.reason === "too-many") {
      showToast(tooManyMessage(res.limit));
    }
    const el =
      destZone === "free"
        ? freeSlotEls[destIndex]
        : destZone === "home"
          ? homeSlotEls[destIndex]
          : cascadeEls[destIndex];
    shakeEl(el);
  }

  /* ---------------- 勝利・詰み画面 ---------------- */

  function showWin(gameNumber, moveCount, time) {
    document.getElementById("overlay-title").textContent = "🎉 クリア！";
    document.getElementById("overlay-message").textContent =
      `No.${gameNumber} を ${moveCount} 手・ ${time} でクリアしました！`;
    document.getElementById("overlay-undo").classList.add("hidden");
    document.getElementById("overlay").classList.remove("hidden");
    // 勝利直前の render では won がまだ false のため、ここで再度同期する
    // (UI 状態表どおり、完了済みの操作を無効化する)
    syncControls();
  }

  function showStuck() {
    document.getElementById("overlay-title").textContent = "詰みました";
    document.getElementById("overlay-message").textContent =
      "これ以上動かせるカードがありません。1手戻すか、新しいゲームを始めてください。";
    document.getElementById("overlay-undo").classList.remove("hidden");
    document.getElementById("overlay").classList.remove("hidden");
  }

  function hideOverlay() {
    document.getElementById("overlay").classList.add("hidden");
    // カスケードの画像はモーダルが閉じたタイミングで片付ける。
    // カスケードと無関係な hideOverlay では victoryAftermath が null なので無害。
    if (victoryAftermath) {
      cleanupVictoryVisuals(victoryAftermath);
    }
  }

  /* ---------------- やり直し確認ダイアログ ---------------- */

  let confirmResolve = null; // 表示中の Promise の resolve(非 null なら表示中)
  let confirmPrevFocus = null; // 開く前にフォーカスがあった要素

  /** ダイアログを閉じて待ち受けている Promise を確定させる */
  function resolveConfirmDialog(result) {
    if (!confirmResolve) {
      return;
    }
    const resolve = confirmResolve;
    confirmResolve = null;
    document.getElementById("confirm-dialog").classList.add("hidden");
    if (confirmPrevFocus && typeof confirmPrevFocus.focus === "function") {
      confirmPrevFocus.focus();
    }
    confirmPrevFocus = null;
    resolve(result);
  }

  /** ダイアログ内のキー操作。Enter=実行 / Esc=中止。
   *  stopPropagation で app 側のショートカット(Ctrl+Z / Esc)への漏れを防ぐ */
  function onConfirmKeydown(e) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      resolveConfirmDialog(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      resolveConfirmDialog(true);
    }
  }

  /** やり直し確認ダイアログを表示し、実行で true / 中止で false に解決する
   *  Promise を返す。開いている間はキャンセルボタンへフォーカスし、
   *  閉じたら元の要素へフォーカスを戻す */
  function showConfirmRestart() {
    if (confirmResolve) {
      return Promise.resolve(false); // 既に開いている場合は二重表示しない
    }
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmPrevFocus = document.activeElement;
      const dlg = document.getElementById("confirm-dialog");
      dlg.classList.remove("hidden");
      dlg.onkeydown = onConfirmKeydown;
      document.getElementById("confirm-cancel-btn").focus();
    });
  }

  /* ---------------- 盤面の構築 ---------------- */

  function buildBoard() {
    const freeArea = document.getElementById("free-cells");
    const homeArea = document.getElementById("home-cells");
    const cascadeArea = document.getElementById("cascade-area");

    for (let i = 0; i < NUM_FREE; i++) {
      const slot = document.createElement("div");
      slot.className = "slot free";
      slot.dataset.zone = "free";
      slot.dataset.index = i;
      slot.dataset.label = "✦";
      freeArea.appendChild(slot);
      landingEffects.createSlotGlow(slot);
      freeSlotEls.push(slot);
    }
    for (let i = 0; i < NUM_HOME; i++) {
      const slot = document.createElement("div");
      slot.className = "slot home";
      slot.dataset.zone = "home";
      slot.dataset.index = i;
      slot.dataset.label = "A";
      homeArea.appendChild(slot);
      landingEffects.createSlotGlow(slot);
      homeSlotEls.push(slot);
    }
    for (let i = 0; i < NUM_CASCADES; i++) {
      const wrap = document.createElement("div");
      wrap.className = "cascade";
      wrap.dataset.zone = "cascade";
      wrap.dataset.index = i;
      const slot = document.createElement("div");
      slot.className = "slot";
      wrap.appendChild(slot);
      cascadeArea.appendChild(wrap);
      cascadeEls.push(wrap);
    }
    // 小破裂用 canvas は初回着地ではなく盤面初期化時に確保・サイズ決定する
    landingEffects.ensureLandingCanvases();
    // 盤面ジオメトリはここで一度だけ測り、以後はリサイズ時だけ更新する(P3)
    measureBoardGeometry();
    bindBoardGeometryResize();
  }

  /* ---------------- ドラッグ & ドロップ用 DOM 操作 ---------------- */

  function getDragLayer() {
    if (!dragLayer) {
      dragLayer = document.createElement("div");
      dragLayer.id = "drag-layer";
      document.body.appendChild(dragLayer);
    }
    return dragLayer;
  }

  /** 物理を付けてよいか。reduced-motion とアニメーション無効時は従来の剛体ドラッグ */
  function dragPhysicsAllowed() {
    if (!cardAnimations.isEnabled()) {
      return false;
    }
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return false;
    }
    return true;
  }

  function stopDragRaf() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    dragLastFrameTime = null;
  }

  /** 物理状態と transform を破棄する (ドラッグ終了時) */
  function resetDragPhysics() {
    stopDragRaf();
    for (const el of dragPhysicsEls) {
      el.style.transform = "";
    }
    dragPhysics = null;
    dragPhysicsEls = [];
    dragLastLeft = null;
    dragLastTop = null;
    dragDebug.active = false;
    dragDebug.tilt = 0;
    dragDebug.velocity = 0;
    dragDebug.offsets = [];
  }

  /** 物理状態を transform へ反映する */
  function applyDragTransforms() {
    if (!dragPhysics) {
      return;
    }
    const state = dragPhysics.getState();
    const head = dragPhysicsEls[0];
    if (head) {
      head.style.transform =
        Math.abs(state.tilt) < 0.001 ? "" : `rotate(${state.tilt.toFixed(3)}deg)`;
    }
    for (let i = 1; i < dragPhysicsEls.length; i++) {
      const offset = state.offsets[i] ?? { x: 0, y: 0 };
      dragPhysicsEls[i].style.transform =
        Math.abs(offset.x) < 0.01 && Math.abs(offset.y) < 0.01
          ? ""
          : `translate3d(${offset.x.toFixed(2)}px, ${offset.y.toFixed(2)}px, 0)`;
    }
    dragDebug.tilt = state.tilt;
    dragDebug.velocity = state.velocity;
    dragDebug.offsets = state.offsets.map((offset) => ({ x: offset.x, y: offset.y }));
  }

  function dragPhysicsFrame(now) {
    dragRafId = null;
    if (!dragPhysics) {
      return;
    }
    const dt = dragLastFrameTime === null ? 1 / 60 : (now - dragLastFrameTime) / 1000;
    dragLastFrameTime = now;
    dragPhysics.tick(dt, now);
    applyDragTransforms();
    dragRafId = requestAnimationFrame(dragPhysicsFrame);
  }

  function startDragRaf() {
    if (dragRafId !== null) {
      return;
    }
    dragLastFrameTime = null;
    dragRafId = requestAnimationFrame(dragPhysicsFrame);
  }

  /** 掴んだカード群の実際の表示位置を、先頭カード基準の相対オフセットで返す。
   *  列のカード間隔は描画時に 20〜34px で変わるため、固定値で積み直すと
   *  掴んだ瞬間に並びが変わって見える。実レイアウトが取れない場合だけ
   *  従来の 30px をフォールバックに使う。 */
  function dragLayoutOffsets(cards) {
    const headEl = cards.length > 0 ? cardElById(cards[0].id) : null;
    const headRect = headEl ? headEl.getBoundingClientRect() : null;
    return cards.map((card, i) => {
      if (!headRect) {
        return { x: 0, y: i * 30 };
      }
      const el = cardElById(card.id);
      if (!el) {
        return { x: 0, y: i * 30 };
      }
      const rect = el.getBoundingClientRect();
      return { x: rect.left - headRect.left, y: rect.top - headRect.top };
    });
  }

  /** ドラッグレイヤーにカード群を積んで表示する */
  function buildDragLayer(cards) {
    resetDragPhysics();
    const layer = getDragLayer();
    layer.innerHTML = "";
    const offsets = dragLayoutOffsets(cards);
    cards.forEach((card, i) => {
      const el = makeCardEl(card);
      el.style.left = offsets[i].x + "px";
      el.style.top = offsets[i].y + "px";
      layer.appendChild(el);
    });
    layer.style.width = "var(--card-w)";
    layer.style.display = "block";
    dragLastLeft = null;
    dragLastTop = null;
    dragDebug.enabled = dragPhysicsAllowed();
    dragDebug.active = false;
    dragDebug.offsets = cards.map(() => ({ x: 0, y: 0 }));
    if (dragDebug.enabled && cards.length > 0) {
      dragPhysics = createDragPhysics(cards.length);
      dragPhysicsEls = [...layer.querySelectorAll(".card")];
      dragDebug.active = true;
      startDragRaf();
    }
  }

  function positionDragLayer(x, y, offsetX, offsetY) {
    const layer = getDragLayer();
    const left = x - offsetX;
    const top = y - offsetY;
    let dx = 0;
    let dy = 0;
    if (dragLastLeft !== null) {
      dx = left - dragLastLeft;
      dy = top - dragLastTop;
    }
    dragLastLeft = left;
    dragLastTop = top;
    layer.style.left = left + "px";
    layer.style.top = top + "px";
    if (dragPhysics) {
      dragPhysics.moveBy(dx, dy, x, performance.now());
      applyDragTransforms();
    }
  }

  /** ドロップ確定時の準備。先頭の傾きを即座に戻し、矩形を回転前の形にそろえる
   *  (後続カードの遅れはそのまま。getDragCardRects は実際の見た目を返す) */
  function prepareDragForDrop() {
    if (!dragPhysics) {
      return;
    }
    dragPhysics.release();
    applyDragTransforms();
  }

  function hideDragLayer() {
    if (dragLayer) {
      dragLayer.style.display = "none";
    }
    resetDragPhysics();
  }

  /** 移動元のカードを隠す(drag-hidden クラス付与) */
  function hideCards(cardIds) {
    // ドラッグ開始時はヒントの発光も止める(見えているカードが消えるため)
    hintView.clearSheen();
    cardIds.forEach((id) => {
      const el = cardElById(id);
      if (el) {
        el.classList.add("drag-hidden");
      }
    });
  }

  function clearDropHints() {
    document.querySelectorAll("#game .drop-hint").forEach((el) => el.classList.remove("drop-hint"));
  }

  function setDropHint(el, on) {
    el.classList.toggle("drop-hint", on);
  }

  function clearDropTargets() {
    document.querySelectorAll("#game .drop-target").forEach((el) => el.classList.remove("drop-target"));
  }

  function setDropTarget(el, on) {
    el.classList.toggle("drop-target", on);
  }

  /* ---------------- スロット / 入力欄アクセス ---------------- */

  function freeSlots() {
    return freeSlotEls.slice();
  }

  function homeSlots() {
    return homeSlotEls.slice();
  }

  function cascades() {
    return cascadeEls.slice();
  }

  function seedInput() {
    return document.getElementById("seed-input");
  }

  function overlayEl() {
    return document.getElementById("overlay");
  }

  /* ---------------- ソルバー UI ---------------- */

  // ヒント / ソルバー UI の DOM 表示は hint-view.js が担当する。
  // view 側はコントロール状態の集約と syncControls の呼び出しだけを持つ。
  const hintView = createHintView({
    cardElById,
    freeSlots,
    homeSlots,
    cascades,
    isAnimationsEnabled: () => cardAnimations.isEnabled(),
  });

  function showHint(move) {
    hintView.showHint(move);
  }

  function clearHint() {
    hintView.clearHint();
  }

  function setAutoSolving(solving) {
    controlsState.autoSolving = solving;
    const gameEl = document.getElementById("game");
    if (gameEl) {
      gameEl.classList.toggle("auto-solving", solving);
    }
    // 自動解答の再生中は飛行クローンも盤面と同じ暗さに揃える
    // (通常プレイ・配布・勝利カスケードではクラスを付けない)
    cardAnimations.getAnimLayer().classList.toggle("auto-solving", solving);
    syncControls();
  }

  function setSolverBusy(busy, mode) {
    controlsState.solverMode = busy ? (mode === "auto" ? "auto" : "hint") : null;
    controlsState.solverBusy = busy;
    hintView.setSolverBusy(busy, mode);
    syncControls();
  }

  function setSolverStage(stage) {
    hintView.setSolverStage(stage, controlsState.solverMode);
  }

  return {
    render,
    buildBoard,
    setTimerLabel,
    showToast,
    shakeEl,
    tooManyMessage,
    failFeedback,
    showWin,
    showStuck,
    hideOverlay,
    showConfirmRestart,
    resolveConfirmDialog,
    cardElById,
    playLandingEffects,
    setAnimationsEnabled,
    startDealAnimation: cardAnimations.startDealAnimation,
    isDealActive: cardAnimations.isDealActive,
    skipDeal: cardAnimations.skipDeal,
    setNextRenderAnimation: cardAnimations.setNextRenderAnimation,
    showHint,
    clearHint,
    setAutoSolving,
    runAfterAnimations: cardAnimations.runAfterAnimations,
    getCardRects: cardAnimations.getCardRects,
    getDragCardRects: cardAnimations.getDragCardRects,
    animateDragLayerBack: cardAnimations.animateDragLayerBack,
    getDragLayer,
    buildDragLayer,
    positionDragLayer,
    prepareDragForDrop,
    hideDragLayer,
    hideCards,
    clearDropHints,
    setDropHint,
    clearDropTargets,
    setDropTarget,
    freeSlots,
    homeSlots,
    cascades,
    seedInput,
    overlayEl,
    setSolverBusy,
    setSolverStage,
    startVictoryCascade,
    isVictoryCascadeActive,
    skipVictoryCascade,
    abortVictoryCascade,
  };
}
