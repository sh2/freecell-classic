/* =========================================================
 * F 群: 節目系 6 件
 * スート完成・K 戴冠・残り枚数・勝利シーケンス(f04→f05→f06)。
 * ========================================================= */

import { DOPA_LABELS } from "./dopa-text.js";

export const EFFECT_HANDLERS_F = {
  "f01-foundation-finale"(k, c) {
    const p = k.zoneCenter(c.dest?.zone === "home" ? "home" : "home", c.dest?.index ?? 0);
    for (let i = 0; i < 13; i++) {
      const clone = k.cloneCard(c.cardId);
      if (!clone) {
        break;
      }
      const angle = (i / 13) * Math.PI * 2;
      const radius = 110 + (i % 3) * 34;
      k.mount(clone, {
        duration: 1250,
        delay: i * 24,
        priority: 2,
        anchored: true,
        frames: [
          { transform: "translate(0, 0) rotate(0deg) scale(0.6)", opacity: 0 },
          {
            transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius * 0.7}px) rotate(${
              angle * 90
            }deg) scale(0.9)`,
            opacity: 0.95,
            offset: 0.4,
          },
          {
            transform: `translate(${Math.cos(angle) * radius * 0.4}px, ${
              Math.sin(angle) * radius * 0.4 - 30
            }px) rotate(${angle * 160}deg) scale(0.5)`,
            opacity: 0,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.suitComplete, { x: p.x, y: p.y - 120, size: 44, color: "#ffe45a", duration: 1400 });
    k.burst({ x: p.x, y: p.y, count: 34, colors: ["#ffe45a", "#ffffff", "#ffcf5a"], spread: 200, duration: 1300 });
    k.ring({ x: p.x, y: p.y, width: 260, height: 200, color: "#ffe45a", duration: 1000 });
  },

  "f02-crown"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.text("👑", { x: p.x, y: p.y - 80, size: 62, color: "#ffe45a", duration: 1100, className: "dopa-crown" });
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 1100,
        priority: 3,
        anchored: true,
        frames: [
          { transform: "scale(1)", filter: "brightness(1)", opacity: 1 },
          { transform: "scale(1.08)", filter: "brightness(1.7) drop-shadow(0 0 20px #ffe45a)", offset: 0.3 },
          { transform: "scale(1)", filter: "brightness(1.3) drop-shadow(0 0 10px #ffe45a)", offset: 0.75 },
          { transform: "scale(1)", filter: "brightness(1)", opacity: 0 },
        ],
      });
    }
    k.ring({ x: p.x, y: p.y, width: 150, height: 120, color: "#ffe45a", duration: 900 });
    k.burst({ x: p.x, y: p.y - 50, count: 22, colors: ["#ffe45a", "#fff3b0", "#ffffff"], spread: 110, duration: 1000 });
  },

  "f03-countdown"(k, c) {
    const remaining = Number.isInteger(c.remaining) ? c.remaining : 10;
    k.text(String(remaining), {
      free: true,
      x: k.vw / 2,
      y: k.vh * 0.32,
      size: 92,
      color: remaining <= 3 ? "#ff6b6b" : "#ffe45a",
      duration: 950,
      className: "dopa-countdown",
      frames: [
        { transform: "translate(-50%, -50%) scale(2.4)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.2 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.7 },
        { transform: "translate(-50%, -50%) scale(1.3)", opacity: 0 },
      ],
    });
    k.text(`${remaining}${DOPA_LABELS.countdownSuffix}`, { x: k.vw / 2, y: k.vh * 0.32 + 76, size: 28, color: "#ffffff", duration: 900, free: true });
    k.ring({ x: k.vw / 2, y: k.vh * 0.32, width: 190, height: 150, color: remaining <= 3 ? "#ff6b6b" : "#ffe45a", duration: 800 });
  },

  "f04-curtain"(k) {
    for (let i = 0; i < 24; i++) {
      const clone = k.cloneCard(null);
      const x = (i % 12) * (k.vw / 12) + k.vw / 24;
      const y = i < 12 ? -140 : k.vh + 120;
      clone.style.left = `${x}px`;
      clone.style.top = `${y}px`;
      k.mount(clone, {
        duration: 1100,
        delay: (i % 12) * 35,
        priority: 2,
        frames: [
          { transform: "translate(-50%, -50%) rotate(0deg) scale(0.8)", opacity: 0 },
          {
            transform: `translate(-50%, ${i < 12 ? 180 : -180}px) rotate(${k.rand() * 40 - 20}deg) scale(1)`,
            opacity: 0.9,
            offset: 0.35,
          },
          {
            transform: `translate(-50%, ${i < 12 ? 260 : -260}px) rotate(${k.rand() * 60 - 30}deg) scale(0.8)`,
            opacity: 0,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.curtainCall, { x: k.vw / 2, y: k.vh / 2, size: 52, color: "#ffe45a", duration: 1150, free: true, className: "dopa-curtain-text" });
  },

  "f05-glassbreak"(k) {
    const cx = k.vw / 2;
    const cy = k.vh / 2;
    k.hitStop(140);
    k.backgroundExplosion({ x: cx, y: cy, color: "#9fe0ff" });
    k.tilt({ x: cx, y: cy });
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2 + k.rand() * 0.2;
      const len = 160 + k.rand() * 260;
      const seg = k.make("div", "dopa-glass-crack");
      seg.style.left = `${cx}px`;
      seg.style.top = `${cy}px`;
      seg.style.width = `${len}px`;
      seg.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
      k.mount(seg, {
        duration: 900,
        delay: i * 12,
        priority: 4,
        frames: [
          { transform: `rotate(${(angle * 180) / Math.PI}deg) scaleX(0)`, opacity: 0 },
          { transform: `rotate(${(angle * 180) / Math.PI}deg) scaleX(1)`, opacity: 1, offset: 0.25 },
          { transform: `rotate(${(angle * 180) / Math.PI}deg) scaleX(1)`, opacity: 0.7, offset: 0.7 },
          { transform: `rotate(${(angle * 180) / Math.PI}deg) scaleX(1)`, opacity: 0 },
        ],
      });
    }
    for (let i = 0; i < 30; i++) {
      const shard = k.make("div", "dopa-glass-shard");
      shard.style.left = `${cx}px`;
      shard.style.top = `${cy}px`;
      const angle = k.rand() * Math.PI * 2;
      const dist = (120 + k.rand() * 320) * k.scale;
      k.mount(shard, {
        duration: 900 + k.rand() * 300,
        delay: k.rand() * 160,
        priority: 2,
        frames: [
          { transform: "translate(-50%, -50%) rotate(0deg) scale(1)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${
              Math.sin(angle) * dist
            }px)) rotate(${k.rand() * 720 - 360}deg) scale(0.5)`,
            opacity: 0,
          },
        ],
      });
    }
    k.flash({ color: "#ffffff", opacity: 0.55, duration: 300 });
    k.text(DOPA_LABELS.youWin, { x: cx, y: cy, size: 86, color: "#ffffff", duration: 1250, free: true, className: "dopa-you-win" });
  },

  "f06-staffroll"(k) {
    const credits = k.make("div", "dopa-credits");
    credits.innerHTML =
      `<div>${DOPA_LABELS.staff}</div><div>${DOPA_LABELS.director}</div><div>${DOPA_LABELS.cards}</div><div>${DOPA_LABELS.effects}</div><div>${DOPA_LABELS.thanks}</div>`;
    credits.style.left = `${k.vw / 2}px`;
    credits.style.top = `${k.vh + 40}px`;
    k.mount(credits, {
      duration: 1800,
      priority: 3,
      easing: "linear",
      frames: [
        { transform: "translate(-50%, 0)", opacity: 0 },
        { transform: `translate(-50%, ${-k.vh * 0.85}px)`, opacity: 1, offset: 0.15 },
        { transform: `translate(-50%, ${-k.vh * 1.2}px)`, opacity: 0 },
      ],
    });
    for (let i = 0; i < (k.mobile ? 40 : 90); i++) {
      const node = k.make("div", "dopa-paper");
      node.style.left = `${k.rand() * k.vw}px`;
      node.style.top = `${-20 - k.rand() * 200}px`;
      node.style.background = ["#ffe45a", "#ff7a9a", "#7fd8ff", "#9fe08a", "#ffffff"][i % 5];
      k.mount(node, {
        duration: 1200 + k.rand() * 600,
        delay: k.rand() * 450,
        priority: 1,
        frames: [
          { transform: "translateY(0) rotate(0deg)", opacity: 1 },
          {
            transform: `translateY(${k.vh + 80}px) translateX(${k.rand() * 120 - 60}px) rotate(${k.rand() * 720 - 360}deg)`,
            opacity: 0.85,
          },
        ],
      });
    }
  },
};
