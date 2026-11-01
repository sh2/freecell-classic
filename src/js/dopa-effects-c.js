/* =========================================================
 * C 群: 画面系 10 件
 * 盤面への transform / filter は kit.screen() で一時クラスを付け、
 * dopa-visuals.js が必ず解除する(同時 2 件まで)。
 * ========================================================= */

import { DOPA_LABELS, SLOWMO_LINES } from "./dopa-text.js";

export const EFFECT_HANDLERS_C = {
  "c01-punchzoom"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.screen("dopa-fx-punchzoom", 520);
    k.shake("sm");
    k.ring({ x: p.x, y: p.y, width: 90, height: 90, color: "#ffffff", duration: 420, className: "dopa-impact-ring" });
    k.burst({ x: p.x, y: p.y, count: 14, colors: ["#ffffff", "#ffcf5a"], spread: 90, duration: 520 });
    k.text(DOPA_LABELS.zoom, { x: p.x, y: p.y - 70, size: 36, color: "#ffffff", duration: 520 });
  },

  "c02-speedlines"(k) {
    const cx = k.vw / 2;
    const cy = k.vh / 2;
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + k.rand() * 0.12;
      const node = k.make("div", "dopa-speedline");
      node.style.left = `${cx}px`;
      node.style.top = `${cy}px`;
      node.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
      k.mount(node, {
        duration: 500 + k.rand() * 250,
        delay: i * 8,
        priority: 2,
        frames: [
          { transform: `rotate(${(angle * 180) / Math.PI}deg) translateX(120px) scaleX(0.2)`, opacity: 0 },
          {
            transform: `rotate(${(angle * 180) / Math.PI}deg) translateX(${420 + k.rand() * 260}px) scaleX(1)`,
            opacity: 0.9,
            offset: 0.35,
          },
          {
            transform: `rotate(${(angle * 180) / Math.PI}deg) translateX(${520 + k.rand() * 300}px) scaleX(0.4)`,
            opacity: 0,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.focus, { x: cx, y: cy - 20, size: 54, color: "#ffffff", duration: 700 });
  },

  "c03-slowmo"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.screen("dopa-fx-slowmo", 1200);
    k.text(SLOWMO_LINES[Math.floor(k.rand() * SLOWMO_LINES.length)], { x: k.vw / 2, y: k.vh * 0.22, size: 34, color: "#d8f0ff", duration: 1150 });
    k.ring({ x: p.x, y: p.y, width: 150, height: 110, color: "#d8f0ff", duration: 1100 });
    k.burst({ x: p.x, y: p.y, count: 10, colors: ["#d8f0ff", "#ffffff"], spread: 60, duration: 1100 });
  },

  "c04-invert"(k) {
    k.screen("dopa-fx-invert", 380);
    k.flash({ color: "#ffffff", opacity: 0.65, duration: 260, blend: "difference" });
    k.text(DOPA_LABELS.invert, { x: k.vw / 2, y: k.vh / 2, size: 72, color: "#ffffff", duration: 420 });
  },

  "c05-glitch"(k, c) {
    const p = k.cardCenter(c.cardId);
    k.screen("dopa-fx-glitch", 680);
    const colors = ["#ff3b6b", "#3bffc8", "#3b7bff"];
    colors.forEach((color, i) => {
      k.text(DOPA_LABELS.glitch, {
        x: p.x + (i - 1) * 8,
        y: p.y,
        size: 46,
        color,
        duration: 520,
        className: "dopa-glitch-text",
        frames: [
          { transform: "translate(-50%, -50%) translateX(0)", opacity: 0 },
          { transform: "translate(-50%, -50%) translateX(-10px)", opacity: 0.9, offset: 0.2 },
          { transform: "translate(-50%, -50%) translateX(9px)", opacity: 0.7, offset: 0.5 },
          { transform: "translate(-50%, -50%) translateX(-4px)", opacity: 0.9, offset: 0.75 },
          { transform: "translate(-50%, -50%) translateX(0)", opacity: 0 },
        ],
      });
    });
    k.flash({ color: "#ffffff", opacity: 0.28, duration: 320 });
  },

  "c06-split-screen"(k) {
    k.screen("dopa-fx-split", 700);
    for (const top of ["0%", "50%"]) {
      const bar = k.make("div", "dopa-split-bar");
      bar.style.top = top;
      k.mount(bar, {
        duration: 650,
        priority: 3,
        frames: [
          { transform: "translateX(-100%)", opacity: 0.75 },
          { transform: "translateX(0)", opacity: 0.75, offset: 0.3 },
          { transform: "translateX(0)", opacity: 0.75, offset: 0.7 },
          { transform: "translateX(100%)", opacity: 0 },
        ],
      });
    }
    k.text(DOPA_LABELS.split, { x: k.vw / 2, y: k.vh / 2, size: 58, color: "#ffffff", duration: 620 });
  },

  "c07-fisheye"(k) {
    k.screen("dopa-fx-fisheye", 680);
    k.ring({ x: k.vw / 2, y: k.vh / 2, width: k.vw * 0.8, height: k.vh * 0.8, color: "#9fd8ff", duration: 650 });
    k.text(DOPA_LABELS.zoom, { x: k.vw / 2, y: k.vh * 0.2, size: 32, color: "#9fd8ff", duration: 620 });
  },

  "c08-kaleido"(k) {
    k.screen("dopa-fx-kaleido", 900);
    const node = k.make("div", "dopa-kaleido");
    node.style.left = `${k.vw / 2}px`;
    node.style.top = `${k.vh / 2}px`;
    k.mount(node, {
      duration: 900,
      priority: 3,
      easing: "linear",
      frames: [
        { transform: "translate(-50%, -50%) rotate(0deg) scale(0.2)", opacity: 0 },
        { transform: "translate(-50%, -50%) rotate(180deg) scale(1)", opacity: 0.85, offset: 0.35 },
        { transform: "translate(-50%, -50%) rotate(360deg) scale(1.15)", opacity: 0.85, offset: 0.75 },
        { transform: "translate(-50%, -50%) rotate(540deg) scale(1.4)", opacity: 0 },
      ],
    });
    k.text(DOPA_LABELS.kaleido, { x: k.vw / 2, y: k.vh * 0.8, size: 34, color: "#ffb3e6", duration: 850 });
  },

  "c09-spotlight"(k, c) {
    const p = k.cardCenter(c.cardId);
    const node = k.make("div", "dopa-spotlight");
    node.style.background = `radial-gradient(circle at ${p.x}px ${p.y}px, rgba(255,255,255,0.18) 0 70px, rgba(0,0,0,0.82) 210px)`;
    k.mount(node, {
      duration: 1100,
      priority: 3,
      frames: [
        { opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { opacity: 1, offset: 0.75 },
        { opacity: 0 },
      ],
    });
    k.ring({ x: p.x, y: p.y, width: 170, height: 130, color: "#ffffff", duration: 1000 });
    k.text(DOPA_LABELS.spotlight, { x: p.x, y: p.y - 96, size: 30, color: "#ffffff", duration: 900 });
  },

  "c10-felt"(k, c) {
    const variants = [
      { key: "fire", className: "dopa-felt-fire", colors: ["#ff7a3c", "#ffcf5a", "#ff3b3b"], label: DOPA_LABELS.inferno },
      { key: "ice", className: "dopa-felt-ice", colors: ["#9fd8ff", "#d8f0ff", "#6fa8ff"], label: DOPA_LABELS.freeze },
      { key: "gold", className: "dopa-felt-gold", colors: ["#ffd34a", "#fff3b0", "#c99a1a"], label: DOPA_LABELS.goldRush },
    ];
    const forced = c.variant === "inferno" ? "fire" : c.variant;
    const v = variants.find((item) => item.key === forced) ?? variants[Math.floor(k.rand() * variants.length)];
    k.screen(v.className, 1300);
    if (v.key === "fire") {
      const inferno = k.make("div", "dopa-inferno-layer");
      inferno.style.left = "0";
      inferno.style.top = "0";
      inferno.style.width = "100vw";
      inferno.style.height = "100vh";
      k.mount(inferno, {
        duration: 1300,
        priority: 2,
        frames: [
          { opacity: 0 },
          { opacity: 0.92, offset: 0.18 },
          { opacity: 0.92, offset: 0.8 },
          { opacity: 0 },
        ],
      });
    }
    const count = v.key === "fire" ? (k.mobile ? 28 : 56) : 24;
    for (let i = 0; i < count; i++) {
      const x = v.key === "fire" ? k.rand() * k.vw : 40 + k.rand() * (k.vw - 80);
      const y = v.key === "fire" ? k.rand() * k.vh : 80 + k.rand() * (k.vh - 160);
      if (v.className === "dopa-felt-ice") {
        const shard = k.make("div", "dopa-shard");
        shard.style.background = v.colors[i % v.colors.length];
        shard.style.left = `${x}px`;
        shard.style.top = `${y}px`;
        k.mount(shard, {
          duration: 1000 + k.rand() * 300,
          delay: i * 20,
          priority: 1,
          frames: [
            { transform: "scale(0.2) rotate(0deg)", opacity: 0 },
            { transform: "scale(1) rotate(30deg)", opacity: 0.9, offset: 0.3 },
            { transform: "scale(0.6) rotate(90deg)", opacity: 0 },
          ],
        });
      } else {
        k.burst({
          x,
          y,
          count: v.key === "fire" ? 3 : 2,
          colors: v.colors,
          spread: v.key === "fire" ? 80 : 40,
          duration: 800 + k.rand() * 400,
          gravity: v.className === "dopa-felt-fire" ? -0.9 : 0.4,
        });
      }
    }
    k.text(v.label, { x: k.vw / 2, y: k.vh * 0.2, size: 44, color: v.colors[0], duration: 1200, free: v.key === "fire" });
  },
};
