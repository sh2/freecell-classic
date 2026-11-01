/* =========================================================
 * B 群: 攻撃系 10 件
 * 爆発・連射・斬撃・隕石・雷・ビーム・ラッシュ・ドリル・
 * 地割れ・ブラックホール。
 * ========================================================= */

import { DOPA_LABELS } from "./dopa-text.js";

function slashSegment(k, x, y, length, angle, className, duration) {
  const node = k.make("div", className);
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${length}px`;
  node.style.transform = `rotate(${angle}deg)`;
  k.mount(node, {
    duration,
    priority: 4,
    frames: [
      { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0 },
      { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.2 },
      { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.55 },
      { transform: `rotate(${angle}deg) scaleX(1) translateX(40px)`, opacity: 0 },
    ],
  });
  return node;
}

export const EFFECT_HANDLERS_B = {
  "b01-explosion"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    k.backgroundExplosion({ x: p.x, y: p.y, color: "#ff8a3c" });
    k.tilt({ x: p.x, y: p.y });
    k.flash({ color: "#ff9d3c", opacity: 0.55, duration: 420 });
    k.shake("lg");
    k.ring({ x: p.x, y: p.y, width: 60, height: 60, color: "#ffdf8a", duration: 600 });
    k.ring({ x: p.x, y: p.y, width: 160, height: 160, color: "#ff6b3c", duration: 800 });
    k.burst({
      x: p.x,
      y: p.y,
      count: 30,
      colors: ["#ffcf5a", "#ff7a3c", "#ffffff", "#7a6a5a"],
      spread: 150,
      size: 9,
      duration: 950,
      gravity: 1,
    });
    k.text(DOPA_LABELS.kaboom, { x: p.x, y: p.y - 80, size: 58, color: "#ffdf8a", duration: 900, rotate: -6 });
  },

  "b02-machinegun"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    for (let i = 0; i < 10; i++) {
      k.at(() => {
        k.shake("sm");
        k.burst({
          x: p.x + k.rand() * 120 - 60,
          y: p.y + k.rand() * 80 - 40,
          count: 5,
          colors: ["#ffe28a", "#ffb347", "#ffffff"],
          spread: 36,
          size: 5,
          duration: 300,
        });
        const shell = k.make("div", "dopa-shell");
        shell.style.left = `${p.x + k.rand() * 60 - 30}px`;
        shell.style.top = `${p.y}px`;
        k.mount(shell, {
          duration: 520,
          priority: 1,
          frames: [
            { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
            { transform: `translate(${30 + k.rand() * 40}px, 90px) rotate(540deg)`, opacity: 0 },
          ],
        });
      }, i * 90);
    }
    k.text(DOPA_LABELS.ratatata, { x: p.x, y: p.y - 64, size: 46, color: "#ffe28a", duration: 1000, className: "dopa-telop--shake" });
  },

  "b03-iaido"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    k.screen("dopa-fx-iaido", 520);
    k.flash({ color: "#ffffff", opacity: 0.6, duration: 180 });
    slashSegment(k, p.x - 180, p.y, 460, -18, "dopa-slash", 520);
    slashSegment(k, p.x - 160, p.y + 18, 380, -18, "dopa-slash dopa-slash--thin", 520);
    k.at(() => {
      k.burst({ x: p.x, y: p.y, count: 16, colors: ["#ffffff", "#ff5a5a"], spread: 120, duration: 520 });
      k.shake("sm");
    }, 160);
    k.text(DOPA_LABELS.slash, { x: p.x + 120, y: p.y - 80, size: 64, color: "#ffffff", duration: 700, rotate: 10 });
  },

  "b04-meteor"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    const startX = p.x + 260;
    const startY = p.y - 320;
    const meteor = k.make("div", "dopa-meteor");
    meteor.style.left = `${startX}px`;
    meteor.style.top = `${startY}px`;
    meteor.style.width = "190px";
    meteor.style.transform = "rotate(38deg)";
    k.mount(meteor, {
      duration: 420,
      priority: 4,
      easing: "ease-in",
      frames: [
        { transform: "rotate(38deg) translateX(0) scaleX(0.6)", opacity: 0 },
        { transform: "rotate(38deg) translateX(-260px) scaleX(1)", opacity: 1, offset: 0.5 },
        {
          transform: `rotate(38deg) translateX(${-Math.hypot(260, 320)}px) scaleX(0.2)`,
          opacity: 0.8,
        },
      ],
    });
    k.at(() => {
      k.backgroundExplosion({ x: p.x, y: p.y, color: "#ffb347" });
      k.tilt({ x: p.x, y: p.y });
      k.flash({ color: "#ffb347", opacity: 0.55, duration: 420 });
      k.shake("lg");
      k.ring({ x: p.x, y: p.y, width: 180, height: 180, color: "#ffb347", duration: 800 });
      k.burst({
        x: p.x,
        y: p.y,
        count: 28,
        colors: ["#ffb347", "#ff5a3c", "#ffffff", "#6b5a4a"],
        spread: 180,
        size: 10,
        duration: 1000,
        gravity: 1,
      });
    }, 380);
    k.text(DOPA_LABELS.meteor, { x: p.x - 10, y: p.y - 90, size: 52, color: "#ffcf5a", duration: 900, rotate: -8 });
  },

  "b05-lightning"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    let x = p.x + k.rand() * 120 - 60;
    let y = -20;
    for (let i = 0; i < 9; i++) {
      const nextX = p.x + ((i + 1) / 9) * (x - p.x) * -0.4 + k.rand() * 60 - 30;
      const nextY = y + (p.y - y) / (9 - i);
      const dx = nextX - x;
      const dy = nextY - y;
      const len = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const seg = k.make("div", "dopa-bolt");
      seg.style.left = `${x}px`;
      seg.style.top = `${y}px`;
      seg.style.width = `${len}px`;
      seg.style.transform = `rotate(${angle}deg)`;
      k.mount(seg, {
        duration: 380 + i * 20,
        delay: i * 18,
        priority: 4,
        frames: [
          { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.3 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0.25, offset: 0.6 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.75 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0 },
        ],
      });
      x = nextX;
      y = nextY;
    }
    k.at(() => {
      k.flash({ color: "#d8f0ff", opacity: 0.7, duration: 320 });
      k.shake("lg");
      k.burst({ x: p.x, y: p.y, count: 22, colors: ["#d8f0ff", "#9fd8ff", "#ffffff"], spread: 150, duration: 800 });
    }, 220);
    k.text(DOPA_LABELS.lightning, { x: p.x, y: p.y - 80, size: 58, color: "#d8f0ff", duration: 800 });
  },

  "b06-beam"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    const beam = k.make("div", "dopa-beam");
    beam.style.left = "0px";
    beam.style.top = `${p.y}px`;
    beam.style.width = `${Math.max(200, p.x)}px`;
    k.mount(beam, {
      duration: 720,
      priority: 4,
      frames: [
        { transform: "scaleX(0) translateY(-50%)", opacity: 0 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 1, offset: 0.25 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 0.9, offset: 0.7 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 0 },
      ],
    });
    const core = k.make("div", "dopa-beam dopa-beam--core");
    core.style.left = "0px";
    core.style.top = `${p.y}px`;
    core.style.width = `${Math.max(200, p.x)}px`;
    k.mount(core, {
      duration: 720,
      priority: 4,
      frames: [
        { transform: "scaleX(0) translateY(-50%)", opacity: 0 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 1, offset: 0.25 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 1, offset: 0.55 },
        { transform: "scaleX(1) translateY(-50%)", opacity: 0 },
      ],
    });
    k.at(() => {
      k.shake("md");
      k.burst({ x: p.x, y: p.y, count: 24, colors: ["#7ff0ff", "#ffffff", "#6fa8ff"], spread: 140, duration: 760 });
      k.ring({ x: p.x, y: p.y, width: 150, height: 150, color: "#7ff0ff", duration: 600 });
    }, 300);
    k.text(DOPA_LABELS.beam, { x: p.x - 20, y: p.y - 80, size: 46, color: "#7ff0ff", duration: 800 });
  },

  "b07-rush"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    for (let i = 0; i < 8; i++) {
      k.at(() => {
        const dx = k.rand() * 220 - 110;
        const dy = k.rand() * 160 - 80;
        k.ring({
          x: p.x + dx,
          y: p.y + dy,
          width: 46 * k.scale,
          height: 46 * k.scale,
          color: i % 2 === 0 ? "#ffcf5a" : "#ff8a5a",
          duration: 300,
          className: "dopa-impact-ring",
        });
        k.burst({
          x: p.x + dx,
          y: p.y + dy,
          count: 5,
          colors: ["#ffcf5a", "#ffffff"],
          spread: 28,
          duration: 280,
        });
        if (i % 2 === 0) {
          k.shake("sm");
        }
      }, i * 85);
    }
    k.text(DOPA_LABELS.dododo, { x: p.x, y: p.y - 80, size: 54, color: "#ffcf5a", duration: 900, className: "dopa-telop--shake" });
  },

  "b08-drill"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    const cone = k.make("div", "dopa-drill");
    cone.style.left = `${p.x}px`;
    cone.style.top = `${p.y}px`;
    k.mount(cone, {
      duration: 850,
      priority: 3,
      easing: "linear",
      frames: [
        { transform: "translate(-50%, -50%) rotate(0deg) scale(1)", opacity: 1 },
        { transform: "translate(-50%, -50%) rotate(1080deg) scale(1.15)", opacity: 0.7 },
        { transform: "translate(-50%, -50%) rotate(1800deg) scale(0.5)", opacity: 0 },
      ],
    });
    for (let i = 0; i < 3; i++) {
      k.ring({
        x: p.x,
        y: p.y,
        width: 70 + i * 34,
        height: 70 + i * 34,
        color: "#ffb347",
        duration: 500 + i * 120,
        className: "dopa-drill-ring",
      });
    }
    k.burst({ x: p.x, y: p.y, count: 18, colors: ["#ffb347", "#ffffff", "#8a7a6a"], spread: 110, duration: 800 });
    k.shake("md");
    k.text(DOPA_LABELS.drill, { x: p.x, y: p.y - 70, size: 40, color: "#ffb347", duration: 800 });
  },

  "b09-groundcrack"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    const baseY = Math.min(k.vh - 60, p.y + 120);
    let x = 0;
    let y = baseY;
    for (let i = 0; i < 14; i++) {
      const nextX = x + k.vw / 14 + k.rand() * 20;
      const nextY = baseY + (k.rand() * 60 - 30);
      const dx = nextX - x;
      const dy = nextY - y;
      const len = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const seg = k.make("div", "dopa-crack");
      seg.style.left = `${x}px`;
      seg.style.top = `${y}px`;
      seg.style.width = `${len}px`;
      seg.style.transform = `rotate(${angle}deg)`;
      k.mount(seg, {
        duration: 900,
        delay: i * 20,
        priority: 3,
        frames: [
          { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.2 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0.9, offset: 0.8 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 0 },
        ],
      });
      x = nextX;
      y = nextY;
    }
    k.flash({ color: "#a87a46", opacity: 0.25, duration: 500 });
    k.shake("lg");
    k.burst({ x: p.x, y: baseY, count: 24, colors: ["#a87a46", "#e6c15a", "#5a4a3a"], spread: 160, duration: 950, gravity: 1 });
    k.text(DOPA_LABELS.crack, { x: p.x, y: p.y - 70, size: 44, color: "#e6c15a", duration: 900 });
  },

  "b10-blackhole"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.hitStop(120);
    const hole = k.make("div", "dopa-blackhole");
    hole.style.left = `${p.x}px`;
    hole.style.top = `${p.y}px`;
    k.mount(hole, {
      duration: 1400,
      priority: 4,
      frames: [
        { transform: "translate(-50%, -50%) scale(0)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%, -50%) scale(1.4)", opacity: 1, offset: 0.7 },
        { transform: "translate(-50%, -50%) scale(0.1)", opacity: 0 },
      ],
    });
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2;
      const radius = 150 + k.rand() * 120;
      const node = k.make("div", "dopa-particle");
      node.style.width = "4px";
      node.style.height = "4px";
      node.style.background = i % 2 === 0 ? "#b58cff" : "#e6c15a";
      node.style.left = `${p.x + Math.cos(angle) * radius}px`;
      node.style.top = `${p.y + Math.sin(angle) * radius}px`;
      k.mount(node, {
        duration: 900,
        delay: i * 12,
        priority: 1,
        easing: "ease-in",
        frames: [
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9 },
          { transform: `translate(calc(-50% + ${-Math.cos(angle) * radius}px), calc(-50% + ${
            -Math.sin(angle) * radius
          }px)) scale(0.1)`, opacity: 0 },
        ],
      });
    }
    k.at(() => {
      k.backgroundExplosion({ x: p.x, y: p.y, color: "#b58cff" });
      k.tilt({ x: p.x, y: p.y });
      k.flash({ color: "#b58cff", opacity: 0.45, duration: 380 });
      k.burst({ x: p.x, y: p.y, count: 28, colors: ["#b58cff", "#ffffff", "#7fd8ff"], spread: 180, duration: 700 });
      k.shake("lg");
    }, 820);
  },
};
