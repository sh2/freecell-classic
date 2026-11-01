/* =========================================================
 * A 群: カード系 10 件
 * 各ハンドラーは dopa-visuals.js の演出キット(k)と
 * イベント文脈(c)を受け取り、DOM 演出を組み立てる。
 * ========================================================= */

import { DOPA_LABELS } from "./dopa-text.js";

const SUITS = ["♣", "♦", "♥", "♠"];
const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export const EFFECT_HANDLERS_A = {
  "a01-ghost"(k, c) {
    const p = k.cardCenter(c.cardId);
    for (let i = 0; i < 3; i++) {
      const clone = k.cloneCard(c.cardId);
      if (!clone) {
        break;
      }
      k.mount(clone, {
        duration: 720,
        delay: i * 70,
        priority: 1,
        anchored: true,
        frames: [
          { transform: `translate(${i * 10}px, ${i * -8}px) scale(1)`, opacity: 0.5 },
          { transform: `translate(${i * 46}px, ${i * -34}px) scale(1.04)`, opacity: 0 },
        ],
      });
    }
    k.burst({ x: p.x, y: p.y, count: 8, colors: ["#9fe0ff", "#ffffff"], spread: 50, duration: 700 });
  },

  "a02-crack"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 900,
        priority: 2,
        anchored: true,
        frames: [
          { transform: "scale(1) rotate(0deg)", filter: "brightness(1)", opacity: 1 },
          { transform: "scale(1.02) rotate(-1deg)", filter: "brightness(1.8) contrast(1.6)", opacity: 0.85 },
          { transform: "scale(0.96) rotate(1deg)", opacity: 0 },
        ],
      });
    }
    for (let i = 0; i < 10; i++) {
      const shard = k.make("div", "dopa-shard");
      const angle = (i / 10) * Math.PI * 2;
      const dist = (60 + k.rand() * 90) * k.scale;
      shard.style.background = i % 3 === 0 ? "#e6c15a" : i % 2 === 0 ? "#f7f4ec" : "#c43b3b";
      shard.style.left = `${p.x}px`;
      shard.style.top = `${p.y}px`;
      k.mount(shard, {
        duration: 700 + k.rand() * 220,
        priority: 1,
        frames: [
          { transform: "translate(-50%, -50%) rotate(0deg) scale(1)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${
              Math.sin(angle) * dist
            }px)) rotate(${k.rand() * 540 - 270}deg) scale(0.4)`,
            opacity: 0,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.crack, { x: p.x, y: p.y - 40, size: 42, color: "#ffdd66", duration: 700, rotate: -8 });
    k.ring({ x: p.x, y: p.y, width: 120, height: 90, color: "#ffe28a", duration: 500 });
  },

  "a03-giant"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 800,
        priority: 3,
        anchored: true,
        frames: [
          { transform: "scale(1)", opacity: 1 },
          { transform: "scale(2.6) translateY(-18px)", opacity: 1, offset: 0.55 },
          { transform: "scale(2.2) translateY(6px)", opacity: 0 },
        ],
      });
    }
    k.shake("lg");
    k.ring({ x: p.x, y: p.y, width: 180, height: 150, color: "#ffcf5a", duration: 600 });
    k.burst({ x: p.x, y: p.y + 40, count: 14, colors: ["#e6c15a", "#ffffff"], spread: 110, duration: 700 });
    k.text(DOPA_LABELS.thud, { x: p.x, y: p.y - 70, size: 56, color: "#ffcf5a", duration: 650 });
  },

  "a04-spin"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 850,
        priority: 2,
        anchored: true,
        frames: [
          { transform: "rotate(0deg) scale(1)", opacity: 1 },
          { transform: "rotate(720deg) scale(0.8) translate(80px, -60px)", opacity: 0.8, offset: 0.6 },
          { transform: "rotate(1080deg) scale(0.35) translate(130px, -90px)", opacity: 0 },
        ],
      });
    }
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const node = k.make("div", "dopa-streak");
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      node.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
      k.mount(node, {
        duration: 550,
        delay: i * 15,
        priority: 1,
        frames: [
          { transform: `rotate(${(angle * 180) / Math.PI}deg) translateX(0) scaleX(0.2)`, opacity: 0.9 },
          {
            transform: `rotate(${(angle * 180) / Math.PI}deg) translateX(110px) scaleX(1)`,
            opacity: 0,
          },
        ],
      });
    }
  },

  "a05-boomerang"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      const dx = (p.x < k.vw / 2 ? 1 : -1) * (160 + k.rand() * 120);
      k.mount(clone, {
        duration: 950,
        priority: 2,
        anchored: true,
        easing: "ease-in-out",
        frames: [
          { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
          { transform: `translate(${dx}px, -150px) rotate(240deg)`, opacity: 1, offset: 0.45 },
          { transform: "translate(0, 0) rotate(720deg) scale(0.9)", opacity: 0, offset: 1 },
        ],
      });
    }
    k.burst({ x: p.x, y: p.y, count: 10, colors: ["#7fd8ff", "#e6c15a"], spread: 80, duration: 900 });
  },

  "a06-warp"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 750,
        priority: 2,
        anchored: true,
        frames: [
          { transform: "scale(1) rotate(0deg)", opacity: 1, filter: "blur(0px)" },
          { transform: "scale(0.05) rotate(540deg)", opacity: 0, filter: "blur(6px)" },
        ],
      });
    }
    for (let i = 0; i < 4; i++) {
      k.ring({
        x: p.x,
        y: p.y,
        width: 120 + i * 40,
        height: 90 + i * 30,
        color: "#9a7bff",
        duration: 420 + i * 80,
        className: "dopa-warp-ring",
      });
    }
    k.burst({ x: p.x, y: p.y, count: 12, colors: ["#9a7bff", "#ffffff"], spread: 60, duration: 700 });
  },

  "a07-tornado"(k, c) {
    const p = k.cardCenter(c.cardId);
    for (let i = 0; i < 4; i++) {
      const clone = k.cloneCard(c.cardId);
      if (!clone) {
        break;
      }
      const radius = 70 + i * 28;
      const turns = 2 + i * 0.4;
      k.mount(clone, {
        duration: 1100,
        delay: i * 60,
        priority: 2,
        anchored: true,
        easing: "linear",
        frames: [
          { transform: `translate(0, 120px) rotate(0deg) scale(0.7)`, opacity: 0.35 },
          {
            transform: `translate(${Math.cos(turns * Math.PI) * radius}px, -40px) rotate(${turns * 360}deg) scale(0.9)`,
            opacity: 0.9,
            offset: 0.5,
          },
          {
            transform: `translate(${Math.cos(turns * Math.PI * 2) * radius}px, -260px) rotate(${turns * 720}deg) scale(0.4)`,
            opacity: 0,
          },
        ],
      });
    }
    for (let i = 0; i < 22; i++) {
      const node = k.make("div", "dopa-particle");
      node.style.width = "5px";
      node.style.height = "5px";
      node.style.background = i % 3 === 0 ? "#e6c15a" : "#c9f0ff";
      node.style.left = `${p.x}px`;
      node.style.top = `${p.y}px`;
      const angle = (i / 22) * Math.PI * 4;
      const radius = 50 + (i % 5) * 22;
      k.mount(node, {
        duration: 1000,
        delay: i * 12,
        priority: 1,
        easing: "linear",
        frames: [
          { transform: "translate(-50%, -50%) rotate(0deg)", opacity: 0.9 },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * radius}px), calc(-50% + ${
              Math.sin(angle) * radius - 180
            }px)) rotate(360deg)`,
            opacity: 0,
          },
        ],
      });
    }
  },

  "a08-rocket"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 900,
        priority: 2,
        anchored: true,
        easing: "cubic-bezier(0.3, 0.9, 0.4, 1)",
        frames: [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: "translate(14px, -120px) scale(0.9)", opacity: 1, offset: 0.45 },
          { transform: `translate(30px, ${-k.vh}px) scale(0.5)`, opacity: 0 },
        ],
      });
    }
    for (let i = 0; i < 16; i++) {
      const flame = k.make("div", "dopa-flame");
      flame.style.left = `${p.x + k.rand() * 20 - 10}px`;
      flame.style.top = `${p.y + 20}px`;
      k.mount(flame, {
        duration: 600,
        delay: i * 28,
        priority: 1,
        frames: [
          { transform: "translate(-50%, 0) scale(1)", opacity: 0.95 },
          { transform: `translate(calc(-50% + ${k.rand() * 40 - 20}px), ${80 + k.rand() * 80}px) scale(0.2)`, opacity: 0 },
        ],
      });
    }
    k.text("🚀", { x: p.x, y: p.y - 40, size: 44, color: "#fff", duration: 800 });
  },

  "a09-bounce"(k, c) {
    const p = k.cardCenter(c.cardId);
    const clone = k.cloneCard(c.cardId);
    if (clone) {
      k.mount(clone, {
        duration: 1000,
        priority: 2,
        anchored: true,
        easing: "ease-out",
        frames: [
          { transform: "translateY(0) scale(1, 1)", opacity: 1 },
          { transform: "translateY(-90px) scale(0.92, 1.08)", offset: 0.16 },
          { transform: "translateY(0) scale(1.12, 0.88)", offset: 0.32 },
          { transform: "translateY(-55px) scale(0.95, 1.05)", offset: 0.48 },
          { transform: "translateY(0) scale(1.08, 0.92)", offset: 0.64 },
          { transform: "translateY(-24px) scale(0.98, 1.02)", offset: 0.78 },
          { transform: "translateY(0) scale(1, 1)", opacity: 0, offset: 1 },
        ],
      });
    }
    for (let i = 0; i < 3; i++) {
      k.at(() => {
        k.ring({
          x: p.x,
          y: p.y + 30,
          width: 80 + i * 26,
          height: 24 + i * 8,
          color: "#ffe28a",
          duration: 380,
          className: "dopa-bounce-ring",
        });
      }, 180 + i * 220);
    }
  },

  "a10-split"(k, c) {
    const p = k.cardCenter(c.cardId);
    const suit = Number.isInteger(c.cardId) ? c.cardId % 4 : 0;
    const rank = Number.isInteger(c.cardId) ? Math.floor(c.cardId / 4) + 1 : 1;
    const left = k.text(RANKS[rank] ?? "?", {
      x: p.x,
      y: p.y,
      size: 58,
      color: suit === 1 || suit === 2 ? "#ff6b6b" : "#222",
      duration: 950,
      frames: [
        { transform: "translate(-50%, -50%) translate(0, 0) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -50%) translate(-70px, -40px) rotate(-20deg) scale(1.1)", offset: 0.45 },
        { transform: "translate(-50%, -50%) translate(0, 0) scale(1)", opacity: 1, offset: 0.8 },
        { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
      ],
    });
    const right = k.text(SUITS[suit] ?? "?", {
      x: p.x,
      y: p.y,
      size: 58,
      color: suit === 1 || suit === 2 ? "#ff6b6b" : "#222",
      duration: 950,
      frames: [
        { transform: "translate(-50%, -50%) translate(0, 0) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -50%) translate(70px, 40px) rotate(20deg) scale(1.1)", offset: 0.45 },
        { transform: "translate(-50%, -50%) translate(0, 0) scale(1)", opacity: 1, offset: 0.8 },
        { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
      ],
    });
    k.flash({ color: "#ffffff", opacity: 0.3, duration: 480 });
    k.burst({ x: p.x, y: p.y, count: 12, colors: ["#e6c15a", "#ffffff"], spread: 70, duration: 900 });
    return left && right;
  },
};
