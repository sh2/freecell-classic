/* =========================================================
 * ヒント / ソルバー UI
 * ヒントの発光、移動元・移動先のハイライト、ソルバーの busy / stage 表示を
 * DOM に対して実行する。盤面の状態は持たず、必要な要素は deps 経由で受け取る。
 * ========================================================= */

import {
  SWEEP_DURATION_MS,
  SWEEP_BAND_RATIO,
  SWEEP_SKEW_DEG,
  SWEEP_LEAD,
  SWEEP_MAIN,
  SWEEP_WHITE,
  SWEEP_TAIL,
  SWEEP_GLOW,
  STATIC_DURATION_MS,
  STATIC_TOP,
  STATIC_BOTTOM,
  STATIC_GLOW,
  chooseSheenMode,
  visibleSheenHeight,
  hintSheenDebug,
} from "./hint-sheen.js";

/** ヒント / ソルバー UI を生成する */
export function createHintView({
  cardElById,
  freeSlots,
  homeSlots,
  cascades,
  isAnimationsEnabled,
}) {
  let hintEls = [];
  let hintTimer = null;
  const HINT_AUTO_HIDE_MS = 10000;

  /* ---------------- ヒント時のカード発光 (hint sheen) ---------------- */

  let sheenLayer = null;
  let sheenEl = null;
  let sheenTimer = null;

  function getSheenLayer() {
    if (!sheenLayer) {
      sheenLayer = document.createElement("div");
      sheenLayer.id = "hint-sheen-layer";
      sheenLayer.setAttribute("aria-hidden", "true");
      document.body.appendChild(sheenLayer);
    }
    return sheenLayer;
  }

  /** 発光要素とタイマーを片付ける (ヒント解除・ドラッグ開始・再表示時) */
  function clearHintSheen() {
    if (sheenTimer !== null) {
      clearTimeout(sheenTimer);
      sheenTimer = null;
    }
    if (sheenEl && sheenEl.parentNode) {
      sheenEl.parentNode.removeChild(sheenEl);
    }
    sheenEl = null;
    hintSheenDebug.active = false;
  }

  function finishHintSheen(el) {
    if (sheenEl !== el) {
      return;
    }
    clearHintSheen();
  }

  /**
   * 移動元カードへ光を 1 回だけ走らせる。
   * 発光要素は専用レイヤー上の別要素で、カード DOM を複製しないため
   * ドラッグレイヤーへ持ち込まれない。後続カードに隠れる範囲は高さを
   * 切り詰め、見えている部分の全体に帯が通るようにする。
   */
  function playHintSheen(srcEl) {
    clearHintSheen();
    if (!srcEl) {
      return;
    }
    const rect = srcEl.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return;
    }
    const cover = srcEl.nextElementSibling;
    const coverRect =
      cover && cover.classList && cover.classList.contains("card")
        ? cover.getBoundingClientRect()
        : null;
    const height = visibleSheenHeight(rect, coverRect);
    if (!(height > 0)) {
      return;
    }
    const reducedMotion =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mode = chooseSheenMode(isAnimationsEnabled(), reducedMotion);
    const band = Math.max(12, Math.round(rect.width * SWEEP_BAND_RATIO));

    const el = document.createElement("div");
    el.className = `hint-sheen hint-sheen--${mode}`;
    if (height < rect.height) {
      el.classList.add("hint-sheen--clipped");
    }
    el.setAttribute("aria-hidden", "true");
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${height}px`;
    el.style.setProperty("--sheen-duration", `${SWEEP_DURATION_MS}ms`);
    el.style.setProperty("--sheen-band", `${band}px`);
    el.style.setProperty("--sheen-skew", `${SWEEP_SKEW_DEG}deg`);
    el.style.setProperty("--sheen-lead", SWEEP_LEAD);
    el.style.setProperty("--sheen-white", SWEEP_WHITE);
    el.style.setProperty("--sheen-main", SWEEP_MAIN);
    el.style.setProperty("--sheen-tail", SWEEP_TAIL);
    el.style.setProperty("--sheen-glow", SWEEP_GLOW);
    el.style.setProperty("--sheen-from", `${-band}px`);
    el.style.setProperty("--sheen-to", `${Math.round(rect.width)}px`);
    el.style.setProperty("--sheen-still-top", STATIC_TOP);
    el.style.setProperty("--sheen-still-bottom", STATIC_BOTTOM);
    el.style.setProperty("--sheen-still-glow", STATIC_GLOW);
    getSheenLayer().appendChild(el);
    sheenEl = el;

    hintSheenDebug.plays++;
    hintSheenDebug.active = true;
    hintSheenDebug.mode = mode;
    hintSheenDebug.cardId = Number(srcEl.dataset.cardId);
    hintSheenDebug.left = rect.left;
    hintSheenDebug.top = rect.top;
    hintSheenDebug.width = rect.width;
    hintSheenDebug.height = height;

    const duration = mode === "sweep" ? SWEEP_DURATION_MS : STATIC_DURATION_MS;
    sheenTimer = setTimeout(() => finishHintSheen(el), duration + 40);
  }

  function clearHint() {
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    clearHintSheen();
    for (const el of hintEls) {
      el.classList.remove("hint-source", "hint-target");
    }
    hintEls = [];
  }

  function showHint(move) {
    clearHint();
    const srcEl = cardElById(move.cardId);
    if (srcEl) {
      srcEl.classList.add("hint-source");
      hintEls.push(srcEl);
      playHintSheen(srcEl);
    }
    let targetEl = null;
    if (move.destZone === "free") {
      targetEl = freeSlots()[move.destIndex] ?? null;
    } else if (move.destZone === "home") {
      // solverは destIndex をスート固定(0=♣,1=♦,2=♥,3=♠)で返すが、UIの
      // foundations/homeSlots は置かれた順(スロット順)のため、スートから
      // 実際のスロットを探す。game-state.js:113-119 と同様の補正を表示でも行う。
      const suit = move.cardId & 3;
      let slot = null;
      // 同スートの山があるスロットを探す
      for (const s of homeSlots()) {
        const top = s.querySelector(".card:last-child");
        if (top) {
          const topId = Number(top.dataset.cardId);
          if ((topId & 3) === suit) {
            slot = s;
            break;
          }
        }
      }
      // なければ空きスロット( A の移動先 )
      if (!slot) {
        for (const s of homeSlots()) {
          if (!s.querySelector(".card")) {
            slot = s;
            break;
          }
        }
      }
      // フォールバック(従来の slot順 destIndex)
      if (!slot) {
        slot = homeSlots()[move.destIndex] ?? null;
      }
      if (slot) {
        const topCardEl = slot.querySelector(".card:last-child");
        targetEl = topCardEl ?? slot;
      }
    } else if (move.destZone === "cascade") {
      const pile = cascades()[move.destIndex];
      if (pile) {
        const topCardEl = pile.querySelector(".card:last-child");
        targetEl = topCardEl ?? pile.querySelector(".slot");
      }
    }
    if (targetEl) {
      targetEl.classList.add("hint-target");
      hintEls.push(targetEl);
    }
    if (hintEls.length > 0) {
      if (hintTimer !== null) {
        clearTimeout(hintTimer);
      }
      hintTimer = setTimeout(clearHint, HINT_AUTO_HIDE_MS);
    }
    // 次の描画でハイライトが updateHighlights に消されないよう、render 後に再適用が必要なら
    // clearHint は手動操作時や 10 秒経過後に呼ばれる
  }

  /* ---------------- ヒントボタンの進捗表示 ---------------- */

  // 押下直後はスピナーのみで、一定時間経過しても計算が続いている場合だけ
  // ボタンの文字を段階表示(高速探索中…/安全探索中…)へ切り替える。
  // 即答する盤面(キャッシュヒット・高速で解ける配置)では遅延内に完了するため
  // 文字は一度も変わらずチラつかない。自動解答ラベルはヒント中は変えない。
  const HINT_STAGE_DELAY_MS = 300;
  let hintStageTimer = null;
  let hintStageText = null; // 遅延確定前に届いた最新の段階テキスト

  function stageLabelFor(stage) {
    if (stage === "safe" || stage === "safe2") {
      return "安全探索中…";
    }
    return "高速探索中…";
  }

  /** ヒントボタンへ段階テキストを反映する(遅延確定後に呼ばれる) */
  function applyHintStageText() {
    const btn = document.getElementById("hint-btn");
    if (btn) {
      btn.textContent = hintStageText || stageLabelFor("fast");
    }
  }

  /** ヒント計算の開始: スピナーを即表示し、段階テキストへの切替を遅延させる */
  function beginHintBusy() {
    const btn = document.getElementById("hint-btn");
    if (!btn) {
      return;
    }
    btn.classList.add("busy");
    btn.setAttribute("aria-busy", "true");
    hintStageText = null;
    if (hintStageTimer !== null) {
      clearTimeout(hintStageTimer);
    }
    hintStageTimer = setTimeout(() => {
      hintStageTimer = null;
      applyHintStageText();
    }, HINT_STAGE_DELAY_MS);
  }

  /** ヒント計算の終了: スピナーと段階テキストを解除して「ヒント」へ戻す */
  function endHintBusy() {
    if (hintStageTimer !== null) {
      clearTimeout(hintStageTimer);
      hintStageTimer = null;
    }
    hintStageText = null;
    const btn = document.getElementById("hint-btn");
    if (btn) {
      btn.classList.remove("busy");
      btn.removeAttribute("aria-busy");
      btn.textContent = "ヒント";
    }
  }

  /** ソルバー計算中のUI状態を制御する。
   *  mode="auto": 自動解答。ラベルに状態を表示するが、トグルは有効のまま
   *   (OFFでキャンセルできる)。テキスト幅はCSSで固定しているため位置は動かない。
   *  mode="hint": ヒント。自動解答ラベルは変えず、ヒントボタン自体に
   *   スピナーと段階テキストを表示する(トグルは無効化して自動解答開始を防ぐ)。 */
  function setSolverBusy(busy, mode) {
    if (mode === "auto") {
      const label = document.getElementById("auto-solve-label");
      if (label) {
        if (busy) {
          if (label.dataset.prevText === undefined) {
            label.dataset.prevText = label.textContent;
          }
          label.textContent = "計算中…";
        } else {
          // 完了・キャンセル時は必ず「自動解答」に戻す
          label.textContent = "自動解答";
          delete label.dataset.prevText;
        }
      }
    } else {
      // ヒント計算中: ボタン自体に進捗を出し、トグルのみ無効化
      if (busy) {
        beginHintBusy();
      } else {
        endHintBusy();
      }
    }
  }

  /** ソルバーの現在段階を表示する。
   *  auto: 自動解答ラベル / hint: ヒントボタンのテキスト(遅延確定後に反映) */
  function setSolverStage(stage, mode) {
    if (mode === "auto") {
      const label = document.getElementById("auto-solve-label");
      if (label) {
        if (stage === "safe" || stage === "safe2") {
          label.textContent = "安全探索中…";
        } else if (stage === "replay") {
          label.textContent = "自動解答中…";
        } else {
          label.textContent = "高速探索中…";
        }
      }
      return;
    }
    if (mode === "hint") {
      hintStageText = stageLabelFor(stage);
      if (hintStageTimer === null) {
        // 遅延時間が経過済みなら、届いた段階へ即座に切替える
        applyHintStageText();
      }
    }
  }

  return {
    showHint,
    clearHint,
    clearSheen: clearHintSheen,
    setSolverBusy,
    setSolverStage,
  };
}
