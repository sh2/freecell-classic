/* =========================================================
 * E 群: 世界観系 8 件
 * 魔法陣・SSR・スロット・花火・桜・宇宙・水中・コイン噴水。
 * ========================================================= */

import { DOPA_LABELS, SPACE_LINES, UNDERWATER_LINES } from "./dopa-text.js";

export const EFFECT_HANDLERS_E = {
  "e01-magic"(k, c) {
    const p = c.epic ? { x: k.vw / 2, y: k.vh / 2 } : k.cardCenter(c.cardId);
    const board = k.boardRect();
    const size = Math.min(
      k.vw * 0.94,
      Math.max(Math.min(k.vw, k.vh) * 0.98, board.width * 0.85)
    );
    const fallback = () => {
      const circle = k.make("div", "dopa-magic-circle");
      circle.style.left = `${p.x}px`;
      circle.style.top = `${p.y}px`;
      for (let i = 0; i < 12; i++) {
        const rune = k.make("span", "dopa-rune");
        rune.textContent = ["✧", "✦", "◈", "✶", "❖", "✵"][i % 6];
        rune.style.transform = `rotate(${i * 30}deg) translateY(-92px)`;
        circle.appendChild(rune);
      }
      k.mount(circle, {
        duration: 1200,
        priority: 3,
        easing: "linear",
        frames: [
          { transform: "translate(-50%, -50%) rotate(0deg) scale(0.2)", opacity: 0 },
          { transform: "translate(-50%, -50%) rotate(160deg) scale(1)", opacity: 1, offset: 0.3 },
          { transform: "translate(-50%, -50%) rotate(320deg) scale(1.1)", opacity: 0.9, offset: 0.75 },
          { transform: "translate(-50%, -50%) rotate(420deg) scale(0.4)", opacity: 0 },
        ],
      });
    };
    k.showImageEffect({
      src: "src/img/magic-circle.png",
      x: p.x,
      y: p.y,
      width: size,
      height: size,
      className: "dopa-magic-image",
      blend: "screen",
      duration: 1200,
      priority: 2,
      easing: "linear",
      frames: [
        { transform: "translate(-50%, -50%) rotate(0deg) scale(0.9)", opacity: 0 },
        { transform: "translate(-50%, -50%) rotate(90deg) scale(1)", opacity: 1, offset: 0.16 },
        { transform: "translate(-50%, -50%) rotate(280deg) scale(1.02)", opacity: 0.95, offset: 0.76 },
        { transform: "translate(-50%, -50%) rotate(360deg) scale(1.15)", opacity: 0 },
      ],
      onError: fallback,
    });
    k.burst({ x: p.x, y: p.y, count: 20, colors: ["#9a7bff", "#7fd8ff", "#ffffff"], spread: 110, duration: 1100 });
    k.text(DOPA_LABELS.magicCircle, { x: p.x, y: p.y - 120, size: 36, color: "#c9b3ff", duration: 1100, free: true });
  },

  "e02-ssr"(k, c) {
    const p = k.cardCenter(c.cardId);
    const dark = k.make("div", "dopa-ssr-dark");
    k.mount(dark, {
      duration: 1900,
      priority: 4,
      frames: [
        { opacity: 0 },
        { opacity: 0.82, offset: 0.12 },
        { opacity: 0.82, offset: 0.85 },
        { opacity: 0 },
      ],
    });
    for (let i = 0; i < 5; i++) {
      const pillar = k.make("div", "dopa-ssr-pillar");
      pillar.style.left = `${k.vw / 2 - 90 + i * 36}px`;
      pillar.style.background = `linear-gradient(180deg, rgba(255,255,255,0), ${
        ["#ff5a9a", "#ffb347", "#ffe45a", "#6ff09a", "#7fd8ff"][i]
      } 45%, rgba(255,255,255,0))`;
      k.mount(pillar, {
        duration: 1500,
        delay: 120 + i * 90,
        priority: 4,
        frames: [
          { transform: "scaleY(0) translateY(50%)", opacity: 0 },
          { transform: "scaleY(1) translateY(0)", opacity: 1, offset: 0.3 },
          { transform: "scaleY(1) translateY(0)", opacity: 0.9, offset: 0.75 },
          { transform: "scaleY(1.4) translateY(0)", opacity: 0 },
        ],
      });
    }
    const frame = k.make("div", "dopa-ssr-frame");
    frame.style.left = `${p.x}px`;
    frame.style.top = `${p.y}px`;
    k.mount(frame, {
      duration: 1700,
      delay: 300,
      priority: 4,
      frames: [
        { transform: "translate(-50%, -50%) scale(2.2) rotate(-8deg)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-4deg)", opacity: 1, offset: 0.22 },
        { transform: "translate(-50%, -50%) scale(1) rotate(-4deg)", opacity: 1, offset: 0.82 },
        { transform: "translate(-50%, -50%) scale(1.15) rotate(-4deg)", opacity: 0 },
      ],
    });
    k.text(DOPA_LABELS.ssr, {
      x: p.x,
      y: p.y,
      size: 96,
      color: "#ffe45a",
      duration: 1750,
      delay: 360,
      rotate: -4,
      className: "dopa-ssr-text",
    });
    k.burst({ x: p.x, y: p.y, count: 40, colors: ["#ffe45a", "#ff5a9a", "#7fd8ff", "#ffffff"], spread: 190, duration: 1700 });
  },

  "e03-slot"(k, c) {
    const p = k.cardCenter(c.cardId);
    const labels = ["7", "7", "7"];
    for (let i = 0; i < 3; i++) {
      const reel = k.make("div", "dopa-reel");
      reel.style.left = `${p.x - 90 + i * 66}px`;
      reel.style.top = `${p.y - 48}px`;
      reel.textContent = labels[i];
      k.mount(reel, {
        duration: 1100,
        delay: i * 90,
        priority: 4,
        frames: [
          { transform: "translateY(-120%) scale(0.8)", opacity: 0, filter: "blur(3px)" },
          { transform: "translateY(0) scale(1)", opacity: 1, filter: "blur(0px)", offset: 0.65 },
          { transform: "translateY(0) scale(1.1)", opacity: 1, offset: 0.82 },
          { transform: "translateY(0) scale(1)", opacity: 0 },
        ],
      });
    }
    k.at(() => {
      k.flash({ color: "#ffe45a", opacity: 0.5, duration: 300 });
      k.burst({ x: p.x, y: p.y, count: 24, colors: ["#ffe45a", "#ffcf5a", "#ffffff"], spread: 140, duration: 700 });
      k.text(DOPA_LABELS.slot, { x: p.x, y: p.y - 90, size: 52, color: "#ffe45a", duration: 700 });
    }, 780);
  },

  "e04-firework"(k, c) {
    const p = k.cardCenter(c.cardId);
    const night = k.make("div", "dopa-night");
    k.mount(night, {
      duration: 1400,
      priority: 2,
      frames: [
        { opacity: 0 },
        { opacity: 0.55, offset: 0.18 },
        { opacity: 0.55, offset: 0.8 },
        { opacity: 0 },
      ],
    });
    const bursts = [
      { x: k.vw * 0.3, y: k.vh * 0.24, color: "#ff7a9a", delay: 0 },
      { x: k.vw * 0.68, y: k.vh * 0.2, color: "#7fd8ff", delay: 280 },
      { x: k.vw * 0.5, y: k.vh * 0.32, color: "#ffe45a", delay: 560 },
    ];
    for (const burst of bursts) {
      k.at(() => {
        k.burst({ x: burst.x, y: burst.y, count: 26, colors: [burst.color, "#ffffff"], spread: 150, duration: 900 });
        k.ring({ x: burst.x, y: burst.y, width: 130, height: 130, color: burst.color, duration: 700 });
      }, burst.delay);
    }
    k.text(DOPA_LABELS.fireworks, { x: p.x, y: p.y - 100, size: 44, color: "#ffe45a", duration: 1300, free: true });
  },

  "e05-sakura"(k) {
    for (let i = 0; i < (k.mobile ? 24 : 46); i++) {
      const petal = k.make("div", "dopa-petal");
      petal.style.left = `${k.rand() * k.vw}px`;
      petal.style.top = `${-30 - k.rand() * 160}px`;
      petal.style.background = ["#ffc4d6", "#ff9ec1", "#ffdbe7"][i % 3];
      k.mount(petal, {
        duration: 1400 + k.rand() * 500,
        delay: k.rand() * 350,
        priority: 1,
        easing: "linear",
        frames: [
          { transform: "translate(0, 0) rotate(0deg)", opacity: 0.95 },
          {
            transform: `translate(${k.rand() * 180 - 90}px, ${k.vh + 80}px) rotate(${k.rand() * 720 - 360}deg)`,
            opacity: 0.75,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.sakura, { x: k.vw / 2, y: k.vh * 0.18, size: 38, color: "#ffdbe7", duration: 1500, free: true });
  },

  "e06-space"(k) {
    const board = k.boardRect();
    const cx = board.left + board.width / 2;
    const cy = board.top + board.height / 2;
    k.showImageEffect({
      src: "src/img/nebula-backdrop.jpg",
      x: cx,
      y: cy,
      width: board.width,
      height: board.height,
      className: "dopa-nebula-bg",
      objectFit: "cover",
      duration: 1500,
      priority: 0,
      frames: [
        { transform: "translate(-50%, -50%) scale(1.04)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9, offset: 0.16 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 0.9, offset: 0.82 },
        { transform: "translate(-50%, -50%) scale(1.04)", opacity: 0 },
      ],
    });
    const catWidth = Math.min(k.vw * 0.55, Math.max(board.width * 0.45, 180));
    const startX = board.left - catWidth * 0.7;
    const endX = board.left + board.width + catWidth * 0.7;
    const catY = cy + (k.rand() * 2 - 1) * board.height * 0.16;
    k.showImageEffect({
      src: "src/img/space-cat.jpg",
      x: startX,
      y: catY,
      width: catWidth,
      height: catWidth,
      className: "dopa-space-cat",
      objectFit: "cover",
      duration: 1500,
      delay: 120,
      priority: 2,
      easing: "linear",
      frames: [
        { transform: "translate(-50%, -50%) rotate(-8deg) scale(0.92)", opacity: 0 },
        {
          transform: "translate(-50%, -50%) translateX(-20px) rotate(-4deg) scale(1)",
          opacity: 1,
          offset: 0.12,
        },
        {
          transform: `translate(-50%, -50%) translateX(${(endX - startX) * 0.55}px) rotate(6deg) scale(1.02)`,
          opacity: 1,
          offset: 0.58,
        },
        {
          transform: `translate(-50%, -50%) translateX(${endX - startX}px) rotate(8deg) scale(0.95)`,
          opacity: 0,
        },
      ],
    });
    for (let i = 0; i < (k.mobile ? 20 : 40); i++) {
      const star = k.make("div", "dopa-star");
      star.style.left = `${k.rand() * k.vw}px`;
      star.style.top = `${k.rand() * k.vh}px`;
      star.style.width = `${1 + k.rand() * 2.4}px`;
      star.style.height = star.style.width;
      k.mount(star, {
        duration: 500 + k.rand() * 900,
        delay: k.rand() * 250,
        priority: 1,
        frames: [
          { opacity: 0, transform: "scale(0.2)" },
          { opacity: 1, transform: "scale(1.5)", offset: 0.4 },
          { opacity: 0.4, transform: "scale(1)" },
        ],
      });
    }
    k.text(SPACE_LINES[Math.floor(k.rand() * SPACE_LINES.length)], { x: cx, y: board.top + board.height * 0.2, size: 40, color: "#cfe8ff", duration: 1400, free: true });
  },

  "e07-underwater"(k) {
    const water = k.make("div", "dopa-water");
    k.mount(water, {
      duration: 1500,
      priority: 2,
      frames: [
        { opacity: 0 },
        { opacity: 0.62, offset: 0.16 },
        { opacity: 0.62, offset: 0.82 },
        { opacity: 0 },
      ],
    });
    for (let i = 0; i < (k.mobile ? 24 : 44); i++) {
      const bubble = k.make("div", "dopa-bubble");
      const size = 6 + k.rand() * 18;
      bubble.style.width = `${size}px`;
      bubble.style.height = `${size}px`;
      bubble.style.left = `${k.rand() * k.vw}px`;
      bubble.style.top = `${k.vh + 20}px`;
      k.mount(bubble, {
        duration: 1200 + k.rand() * 500,
        delay: k.rand() * 300,
        priority: 1,
        easing: "linear",
        frames: [
          { transform: "translateY(0) scale(0.6)", opacity: 0 },
          { transform: "translateY(-40vh) scale(1)", opacity: 0.8, offset: 0.4 },
          { transform: `translateY(${-k.vh - 80}px) scale(1.2)`, opacity: 0 },
        ],
      });
    }
    k.text(UNDERWATER_LINES[Math.floor(k.rand() * UNDERWATER_LINES.length)], { x: k.vw / 2, y: k.vh * 0.2, size: 42, color: "#bfe8ff", duration: 1400, free: true });
  },

  "e08-casino"(k) {
    for (let i = 0; i < (k.mobile ? 28 : 52); i++) {
      const coin = k.make("div", "dopa-coin");
      coin.style.left = `${k.vw / 2 + k.rand() * 120 - 60}px`;
      coin.style.top = `${k.vh - 20}px`;
      const angle = -Math.PI / 2 + (k.rand() - 0.5) * 1.4;
      const speed = 240 + k.rand() * 260;
      const dx = Math.cos(angle) * speed;
      const dy = Math.sin(angle) * speed;
      k.mount(coin, {
        duration: 1100 + k.rand() * 350,
        delay: k.rand() * 220,
        priority: 2,
        easing: "cubic-bezier(0.2, 0.7, 0.4, 1)",
        frames: [
          { transform: "translate(-50%, -50%) scale(0.7) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55}px)) scale(1) rotate(180deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) scale(0.6) rotate(420deg)`,
            opacity: 0,
          },
        ],
      });
    }
    k.text(DOPA_LABELS.jackpot, { x: k.vw / 2, y: k.vh * 0.24, size: 54, color: "#ffe45a", duration: 1300, free: true, className: "dopa-ssr-text" });
  },
};
