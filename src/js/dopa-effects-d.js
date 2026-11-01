/* =========================================================
 * D 群: テロップ系 8 件
 * 実況文言プールは 10 種以上。ランクは combo に応じて C/B/A/S/SS。
 * ========================================================= */

import {
  COMMENTARY_LINES,
  CROWD_LINES,
  CUTIN_PHRASES,
  DOPA_LABELS,
  ONOMATOPE_LINES,
} from "./dopa-text.js";

export const DOPA_ONOMATOPE = ONOMATOPE_LINES;



function rankFor(combo) {
  if (combo >= 8) {
    return "SS";
  }
  if (combo >= 5) {
    return "S";
  }
  if (combo >= 3) {
    return "A";
  }
  if (combo >= 2) {
    return "B";
  }
  return "C";
}

export const EFFECT_HANDLERS_D = {
  "d01-cutin"(k, c) {
    k.text(CUTIN_PHRASES[Math.floor(k.rand() * CUTIN_PHRASES.length)], {
      x: k.vw / 2,
      y: k.vh * 0.42,
      size: 84,
      color: "#fff3b0",
      duration: 1000,
      rotate: -8,
      free: true,
      frame: "dopa-frame-cutin",
      className: "dopa-cutin dopa-cutin-text",
    });
    k.burst({ x: k.cardCenter(c.cardId).x, y: k.cardCenter(c.cardId).y, count: 16, colors: ["#ffcf5a", "#ffffff"], spread: 100, duration: 900 });
  },

  "d02-commentary"(k) {
    const line = COMMENTARY_LINES[Math.floor(k.rand() * COMMENTARY_LINES.length)];
    k.text(line, {
      x: k.vw / 2,
      y: k.vh * 0.14 + 24,
      size: 34,
      color: "#ffffff",
      duration: 1300,
      free: true,
      frame: "dopa-frame-commentary",
      className: "dopa-commentary-text",
    });
  },

  "d03-damage"(k, c) {
    const p = k.cardCenter(c.cardId);
    const damage = 1000 + Math.floor(k.rand() * 98999);
    k.text(String(damage), {
      x: p.x,
      y: p.y - 30,
      size: 62,
      color: "#ffdf5a",
      duration: 950,
      rotate: -6,
      className: "dopa-damage",
      frames: [
        { transform: "translate(-50%, -50%) scale(0.4) rotate(-8deg)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.3) rotate(-4deg)", opacity: 1, offset: 0.2 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-4deg)", opacity: 1, offset: 0.6 },
        { transform: "translate(-50%, -130%) scale(0.9) rotate(-2deg)", opacity: 0 },
      ],
    });
    k.burst({ x: p.x, y: p.y, count: 18, colors: ["#ffdf5a", "#ff7a3c", "#ffffff"], spread: 100, duration: 800 });
    k.ring({ x: p.x, y: p.y, width: 120, height: 90, color: "#ffdf5a", duration: 600 });
  },

  "d04-combo"(k, c) {
    const value = Math.max(1, Number(c.combo) || 1);
    const p = k.cardCenter(c.cardId);
    k.text(`${value} COMBO`, {
      x: p.x,
      y: p.y - 80,
      size: Math.min(74, 34 + value * 4),
      color: value >= 8 ? "#ffdf5a" : value >= 4 ? "#ffab3c" : "#ffffff",
      duration: 1000,
      rotate: -5,
      className: "dopa-combo-text",
    });
    for (let i = 0; i < Math.min(20, 6 + value * 2); i++) {
      k.at(() => {
        k.burst({
          x: p.x + k.rand() * 80 - 40,
          y: p.y - 40,
          count: 3,
          colors: ["#ffdf5a", "#ff7a3c", "#ffffff"],
          spread: 50,
          duration: 600,
          gravity: -0.8,
        });
      }, i * 30);
    }
    k.ring({ x: p.x, y: p.y, width: 160, height: 120, color: value >= 8 ? "#ffdf5a" : "#ffab3c", duration: 700 });
  },

  "d05-onomatopeia"(k, c) {
    const p = k.cardCenter(c.cardId);
    const word = ONOMATOPE_LINES[Math.floor(k.rand() * ONOMATOPE_LINES.length)];
    k.text(word, {
      x: p.x,
      y: p.y - 30,
      size: 72,
      color: "#ffffff",
      duration: 1000,
      rotate: k.rand() * 16 - 8,
      free: true,
      frame: "dopa-frame-plate",
      className: "dopa-onomatopeia dopa-metal-text",
    });
    k.shake("sm");
  },

  "d06-rank"(k, c) {
    const rank = rankFor(Number(c.combo) || 1);
    const p = k.cardCenter(c.cardId);
    const node = k.make("div", `dopa-rank dopa-rank--${rank}`);
    node.textContent = rank;
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    k.mount(node, {
      duration: 1100,
      priority: 4,
      frames: [
        { transform: "translate(-50%, -50%) scale(3) rotate(-18deg)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-18deg)", opacity: 1, offset: 0.18 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-18deg)", opacity: 1, offset: 0.72 },
        { transform: "translate(-50%, -50%) scale(1.3) rotate(-18deg)", opacity: 0 },
      ],
    });
    k.ring({ x: p.x, y: p.y, width: 210, height: 160, color: rank === "SS" ? "#ffdf5a" : "#ffffff", duration: 800 });
    k.burst({ x: p.x, y: p.y, count: 20, colors: ["#ffdf5a", "#ffffff", "#ff7a7a"], spread: 140, duration: 900 });
  },

  "d07-ticker"(k) {
    k.text(DOPA_LABELS.breaking, {
      size: 20,
      color: "#1b1b1b",
      duration: 1900,
      free: true,
      motion: "cutin",
      frame: "dopa-frame-ticker",
      className: "dopa-ticker",
    });
  },

  "d08-crowd"(k) {
    k.text(CROWD_LINES[Math.floor(k.rand() * CROWD_LINES.length)], {
      x: k.vw / 2,
      y: k.vh * 0.2,
      size: 46,
      color: "#ffffff",
      duration: 1500,
      free: true,
      className: "dopa-crowd-text",
    });
    for (let i = 0; i < (k.mobile ? 30 : 60); i++) {
      const node = k.make("div", "dopa-paper");
      node.style.left = `${k.rand() * k.vw}px`;
      node.style.top = `${-20 - k.rand() * 120}px`;
      node.style.background = ["#ff7a7a", "#7fd8ff", "#ffdf5a", "#9fe08a", "#ffffff"][i % 5];
      k.mount(node, {
        duration: 1200 + k.rand() * 600,
        delay: k.rand() * 300,
        priority: 1,
        frames: [
          { transform: "translateY(0) rotate(0deg)", opacity: 1 },
          { transform: `translateY(${k.vh + 60}px) translateX(${k.rand() * 120 - 60}px) rotate(${k.rand() * 720 - 360}deg)`, opacity: 0.9 },
        ],
      });
    }
  },
};
