/* =========================================================
 * G 群: 失敗系 4 件
 * 失敗ドラッグ/タップと詰みを、勝利と区別できる演出にする。
 * ========================================================= */

import { DOPA_LABELS } from "./dopa-text.js";

export const EFFECT_HANDLERS_G = {
  "g01-fail-cross"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.text("✕", {
      x: p.x,
      y: p.y,
      size: 120,
      color: "#ff4a4a",
      duration: 850,
      rotate: -12,
      className: "dopa-fail-cross",
      frames: [
        { transform: "translate(-50%, -50%) scale(3.2) rotate(-12deg)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-12deg)", opacity: 1, offset: 0.18 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-12deg)", opacity: 1, offset: 0.72 },
        { transform: "translate(-50%, -50%) scale(1.2) rotate(-12deg)", opacity: 0 },
      ],
    });
    k.flash({ color: "#ff2a2a", opacity: 0.28, duration: 260 });
    k.shake("sm");
    k.burst({ x: p.x, y: p.y, count: 16, colors: ["#ff4a4a", "#ffffff"], spread: 90, duration: 700 });
  },

  "g02-fail-sink"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 950,
        priority: 3,
        anchored: true,
        easing: "ease-in",
        frames: [
          { transform: "translateY(0) rotate(0deg) scale(1)", opacity: 1, filter: "grayscale(0)" },
          { transform: "translateY(60px) rotate(-8deg) scale(0.95)", opacity: 0.7, filter: "grayscale(0.6)", offset: 0.55 },
          { transform: "translateY(220px) rotate(-16deg) scale(0.6)", opacity: 0, filter: "grayscale(1)" },
        ],
      });
    }
    k.text(DOPA_LABELS.niceTry, { x: p.x, y: p.y - 80, size: 32, color: "#b9c4d0", duration: 900 });
    for (let i = 0; i < 8; i++) {
      k.at(() => {
        k.burst({
          x: p.x + k.rand() * 50 - 25,
          y: p.y + 80,
          count: 2,
          colors: ["#8a94a0", "#b9c4d0"],
          spread: 26,
          duration: 500,
          gravity: 0.8,
        });
      }, i * 80);
    }
  },

  "g03-stuck-gray"(k) {
    k.screen("dopa-fx-gray", 1150);
    const p = k.cardCenter(null);
    const clone = k.cloneCard(null);
    if (clone) {
      k.mount(clone, {
        duration: 1100,
        priority: 3,
        easing: "ease-in",
        frames: [
          { transform: "translateY(0) rotate(0deg) scale(1)", opacity: 0.9, filter: "grayscale(0)" },
          { transform: "translateY(40px) rotate(4deg) scale(0.92)", opacity: 0.6, filter: "grayscale(1)", offset: 0.6 },
          { transform: "translateY(120px) rotate(8deg) scale(0.7)", opacity: 0, filter: "grayscale(1)" },
        ],
      });
    }
    k.text(DOPA_LABELS.stuck, { x: p.x, y: p.y - 90, size: 58, color: "#c9d0d8", duration: 1100, free: true, className: "dopa-stuck-text" });
    k.text(DOPA_LABELS.timesUp, { x: p.x, y: p.y - 36, size: 26, color: "#9aa4ae", duration: 1000, free: true });
  },

  "g04-stuck-skull"(k) {
    const p = k.cardCenter(null);
    const dark = k.make("div", "dopa-skull-dark");
    k.mount(dark, {
      duration: 1100,
      priority: 3,
      frames: [
        { opacity: 0 },
        { opacity: 0.55, offset: 0.2 },
        { opacity: 0.55, offset: 0.8 },
        { opacity: 0 },
      ],
    });
    k.text("☠", { x: p.x, y: p.y - 40, size: 110, color: "#e6eaf0", duration: 1050, className: "dopa-skull" });
    k.text(DOPA_LABELS.gameOver, { x: p.x, y: p.y + 70, size: 40, color: "#ff6b6b", duration: 1000, free: true });
    k.shake("sm");
  },
};
