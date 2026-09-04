(() => {
  "use strict";

  const STORE_HI = "kastflap-hi";
  const STORE_MUTE = "kastflap-mute";
  const STORE_BIRD = "kastflap-bird";

  function storeGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }
  function storeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  }

  const PAL = {
    navy: "#074ea2",
    navyDeep: "#112d63",
    anthra: "#1c1f24",
    anthraMid: "#3a3f46",
    cream: "#efe6d6",
    white: "#f7f5f1",
    wood: "#c4a06a",
    woodDark: "#8d6a3a",
    gold: "#c08a2c",
    handle: "#2a2d32",
  };

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const hud = document.getElementById("hud");
  const scoreEl = document.getElementById("score");
  const hiEl = document.getElementById("hi");
  const ctaEl = document.getElementById("cta");
  const titleEl = document.getElementById("title");
  const resultEl = document.getElementById("result");
  const muteBtn = document.getElementById("mute");
  const iconOn = document.getElementById("icon-on");
  const iconOff = document.getElementById("icon-off");

  const assets = {
    owl: [],
    sparrow: null,
    wood: null,
    wall: null,
    oak: null,
    ready: false,
  };

  let woodPat = null;

  const sfx = {
    ctx: null,
    muted: storeGet(STORE_MUTE, "0") === "1",
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type, gain, slide) {
      if (this.muted || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    flap() {
      this.tone(620, 0.07, "square", 0.035, 880);
    },
    point() {
      this.tone(880, 0.09, "sine", 0.045, 1320);
    },
    hit() {
      this.tone(140, 0.22, "sawtooth", 0.05, 70);
    },
  };

  const state = {
    mode: "start",
    bird: storeGet(STORE_BIRD, "owl") === "sparrow" ? "sparrow" : "owl",
    score: 0,
    hi: Number(storeGet(STORE_HI, "0")) || 0,
    W: 390,
    H: 844,
    t: 0,
    last: 0,
    diedAt: 0,
    shake: 0,
    flash: 0,
    bgX: 0,
    hover: 0,
  };

  const bird = {
    x: 110,
    y: 360,
    vy: 0,
    size: 64,
    frame: 1,
    wingT: 0,
  };

  const cabs = [];
  const bits = [];

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function viewSize() {
    const vv = window.visualViewport;
    const W = Math.max(1, Math.round(vv && vv.width ? vv.width : window.innerWidth));
    const H = Math.max(1, Math.round(vv && vv.height ? vv.height : window.innerHeight));
    return { W, H };
  }

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { W, H } = viewSize();
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = W;
    state.H = H;
    state.vu = clamp(W / 390, 0.82, 1.15);
    state.groundH = Math.max(48, H * 0.08);
    state.ceilH = Math.max(20, H * 0.03);
    state.playH = H - state.groundH - state.ceilH;
    bird.size = clamp(Math.round(46 * state.vu), 40, 56);
    bird.x = W * 0.22;
    state.cabW = clamp(Math.round(62 * state.vu), 52, 74);
  }

  function difficulty(score) {
    const t = clamp(score / 18, 0, 1);
    return {
      speed: lerp(188, 275, t) * state.vu,
      gap: lerp(0.34, 0.24, t) * state.playH,
      spacing: lerp(248, 210, t) * state.vu,
    };
  }

  function makeCab(x) {
    const d = difficulty(state.score);
    const minCab = Math.max(64, state.playH * 0.12);
    const gapH = d.gap;
    const lo = state.ceilH + minCab;
    const hi = state.H - state.groundH - minCab - gapH;
    const gapY = lo >= hi ? (lo + hi) / 2 : rand(lo, hi);
    const roll = Math.random();
    const variant = roll < 0.42 ? "white" : roll < 0.78 ? "wood" : "anthra";
    const kind = Math.random() < 0.2 ? "frame" : "solid";
    return {
      x,
      w: state.cabW,
      gapY,
      gapH,
      variant,
      kind,
      scored: false,
    };
  }

  function resetWorld(attract) {
    cabs.length = 0;
    bits.length = 0;
    const d = difficulty(0);
    const startX = attract ? state.W * 0.58 : state.W + 36;
    for (let i = 0; i < 6; i++) cabs.push(makeCab(startX + i * d.spacing));
    bird.y = state.H * 0.42;
    bird.vy = 0;
    bird.frame = 1;
    bird.wingT = 0;
    state.score = 0;
    state.bgX = 0;
    state.shake = 0;
    state.flash = 0;
    scoreEl.textContent = "0";
  }

  function startGame() {
    resetWorld();
    state.mode = "play";
    overlay.classList.add("is-off");
    hud.classList.add("is-on");
    bird.vy = -400 * state.vu;
    sfx.flap();
    puff(bird.x - 8, bird.y + 10, 6, PAL.white);
  }

  function gameOver() {
    if (state.mode !== "play") return;
    state.mode = "dead";
    state.diedAt = performance.now();
    state.shake = 11;
    state.flash = 0.45;
    sfx.hit();
    puff(bird.x, bird.y, 16, PAL.gold);
    const best = state.score > state.hi;
    if (best) {
      state.hi = state.score;
      storeSet(STORE_HI, String(state.hi));
      hiEl.textContent = String(state.hi);
    }
    titleEl.textContent = "KastFlap";
    resultEl.hidden = false;
    resultEl.innerHTML = best
      ? `Nieuw record <strong>${state.score}</strong>`
      : `Score <strong>${state.score}</strong>`;
    ctaEl.textContent = "Tik om opnieuw";
    overlay.dataset.mode = "dead";
    window.setTimeout(() => {
      if (state.mode === "dead") {
        overlay.classList.remove("is-off");
        hud.classList.remove("is-on");
      }
    }, 420);
  }

  function flap() {
    sfx.ensure();
    if (state.mode === "start") {
      startGame();
      return;
    }
    if (state.mode === "dead") {
      if (performance.now() - state.diedAt < 480) return;
      overlay.dataset.mode = "start";
      resultEl.hidden = true;
      ctaEl.textContent = "Tik om te starten";
      startGame();
      return;
    }
    bird.vy = -460 * state.vu;
    bird.wingT = 0;
    sfx.flap();
    puff(bird.x - 10, bird.y + 12, 5, "#ffffffcc");
  }

  function puff(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      bits.push({
        x,
        y,
        vx: rand(-80, 40),
        vy: rand(-60, 80),
        life: rand(0.25, 0.55),
        age: 0,
        size: rand(2, 5),
        color,
      });
    }
  }

  function circleRect(cx, cy, r, x, y, w, h) {
    const nx = clamp(cx, x, x + w);
    const ny = clamp(cy, y, y + h);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function hitsCab(cab, cx, cy, r) {
    const topH = cab.gapY;
    const botY = cab.gapY + cab.gapH;
    const botH = state.H - botY;
    if (cab.kind === "frame") {
      if (circleRect(cx, cy, r, cab.x, 0, cab.w, topH)) return true;
      if (circleRect(cx, cy, r, cab.x, botY, cab.w, botH)) return true;
      return false;
    }
    if (circleRect(cx, cy, r, cab.x, 0, cab.w, topH)) return true;
    if (circleRect(cx, cy, r, cab.x, botY, cab.w, botH)) return true;
    return false;
  }

  function update(dt) {
    state.t += dt;
    state.hover += dt;
    state.shake = Math.max(0, state.shake - dt * 28);
    state.flash = Math.max(0, state.flash - dt * 1.6);
    state.bgX += (state.mode === "play" ? difficulty(state.score).speed : 28) * dt;

    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 120 * dt;
      if (p.age > p.life) bits.splice(i, 1);
    }

    if (state.mode === "start") {
      bird.y = state.H * 0.42 + Math.sin(state.hover * 2.4) * 10;
      bird.vy = 0;
      bird.wingT += dt * 8;
      return;
    }

    const g = 1680 * state.vu;
    bird.vy = Math.min(bird.vy + g * dt, 820 * state.vu);
    bird.y += bird.vy * dt;
    bird.wingT += dt * (bird.vy < 0 ? 16 : 9);

    if (state.mode === "dead") {
      const floor = state.H - state.groundH - bird.size * 0.18;
      if (bird.y > floor) {
        bird.y = floor;
        bird.vy = 0;
      }
      return;
    }

    const d = difficulty(state.score);
    let right = 0;
    for (const cab of cabs) {
      cab.x -= d.speed * dt;
      right = Math.max(right, cab.x);
      if (!cab.scored && cab.x + cab.w < bird.x) {
        cab.scored = true;
        state.score += 1;
        scoreEl.textContent = String(state.score);
        sfx.point();
        puff(bird.x + 16, bird.y, 7, PAL.gold);
      }
    }
    for (const cab of cabs) {
      if (cab.x + cab.w < -40) {
        const fresh = makeCab(right + d.spacing);
        cab.x = fresh.x;
        cab.w = fresh.w;
        cab.gapY = fresh.gapY;
        cab.gapH = fresh.gapH;
        cab.variant = fresh.variant;
        cab.kind = fresh.kind;
        cab.scored = false;
        right = cab.x;
      }
    }

    const r = bird.size * 0.24;
    if (bird.y - r < state.ceilH || bird.y + r > state.H - state.groundH) {
      gameOver();
      return;
    }
    for (const cab of cabs) {
      if (hitsCab(cab, bird.x, bird.y, r)) {
        gameOver();
        return;
      }
    }
  }

  function roundRect(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad);
    else {
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    }
  }

  function mat(variant) {
    if (variant === "wood") {
      return {
        edge: "rgba(72,44,18,0.55)",
        inner: "rgba(40,24,8,0.16)",
        hi: "rgba(255,230,190,0.22)",
        sh: "rgba(40,20,8,0.3)",
        handle: "#1a1d21",
        handleHi: "#7a8088",
        groove: "rgba(40,20,8,0.28)",
        side: "#7a5a32",
      };
    }
    if (variant === "anthra") {
      return {
        edge: "rgba(0,0,0,0.45)",
        inner: "rgba(0,0,0,0.2)",
        hi: "rgba(255,255,255,0.1)",
        sh: "rgba(0,0,0,0.38)",
        handle: PAL.gold,
        handleHi: "#e8c56a",
        groove: "rgba(255,255,255,0.1)",
        side: "#1c2025",
      };
    }
    return {
      edge: "rgba(140,130,118,0.55)",
      inner: "rgba(0,0,0,0.06)",
      hi: "rgba(255,255,255,0.55)",
      sh: "rgba(120,110,98,0.24)",
      handle: PAL.navy,
      handleHi: "#4d8adf",
      groove: "rgba(90,82,72,0.18)",
      side: "#cfc8bc",
    };
  }

  function fillFace(x, y, w, h, variant, r) {
    const m = mat(variant);
    ctx.save();
    roundRect(x, y, w, h, r);
    ctx.clip();
    if (variant === "wood") {
      if (assets.oak) {
        const tw = 110;
        for (let yy = y; yy < y + h; yy += tw) {
          for (let xx = x; xx < x + w; xx += tw) {
            ctx.drawImage(assets.oak, xx, yy, tw, tw);
          }
        }
      } else if (woodPat) {
        ctx.fillStyle = woodPat;
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = "rgba(60,36,12,0.1)";
      ctx.fillRect(x, y, w, h);
    } else if (variant === "anthra") {
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "#2a2e34");
      g.addColorStop(0.45, "#41484f");
      g.addColorStop(1, "#262a2f");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "#ece8e0");
      g.addColorStop(0.35, "#fffcf7");
      g.addColorStop(1, "#ddd6cb");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = m.hi;
    ctx.fillRect(x, y, 3, h);
    ctx.fillRect(x, y, w, 2);
    ctx.fillStyle = m.sh;
    ctx.fillRect(x + w - 3, y, 3, h);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.restore();
    ctx.strokeStyle = m.edge;
    ctx.lineWidth = 1.15;
    roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  function drawBar(x, y, len, thick, vertical, color, hi) {
    if (len < 8) return;
    ctx.save();
    if (vertical) {
      roundRect(x, y, thick, len, thick / 2);
      const g = ctx.createLinearGradient(x, y, x + thick, y);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, color);
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      roundRect(x, y, len, thick, thick / 2);
      const g = ctx.createLinearGradient(x, y, x, y + thick);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, color);
      g.addColorStop(1, color);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawShakerDoor(x, y, w, h, variant, handleSide) {
    const m = mat(variant);
    fillFace(x, y, w, h, variant, 3);
    const fr = Math.max(5, Math.min(9, w * 0.15));
    if (h > fr * 2 + 10 && w > fr * 2 + 8) {
      ctx.strokeStyle = m.groove;
      ctx.lineWidth = 1.5;
      roundRect(x + fr, y + fr, w - fr * 2, h - fr * 2, 2);
      ctx.stroke();
      ctx.fillStyle = m.inner;
      ctx.fillRect(x + fr + 1, y + fr + 1, w - fr * 2 - 2, 3);
    }
    const thick = 3.4;
    if (handleSide === "right") {
      drawBar(x + w - 8, y + 8, Math.max(14, h - 16), thick, true, m.handle, m.handleHi);
    } else if (handleSide === "left") {
      drawBar(x + 4.5, y + 8, Math.max(14, h - 16), thick, true, m.handle, m.handleHi);
    } else if (handleSide === "h-top") {
      drawBar(x + w * 0.16, y + 7, w * 0.68, thick, false, m.handle, m.handleHi);
    } else if (handleSide === "h-bot") {
      drawBar(x + w * 0.16, y + h - 11, w * 0.68, thick, false, m.handle, m.handleHi);
    }
  }

  function drawDoorPair(x, y, w, h, variant, preferH) {
    const gap = 3;
    const pad = 5;
    const dw = (w - pad * 2 - gap) / 2;
    if (dw < 14 || h < 18) {
      fillFace(x, y, w, h, variant, 3);
      return;
    }
    const useH = preferH || h < 44;
    if (useH) {
      const at = preferH === "h-bot" ? "h-bot" : "h-top";
      drawShakerDoor(x + pad, y, dw, h, variant, at);
      drawShakerDoor(x + pad + dw + gap, y, dw, h, variant, at);
    } else {
      drawShakerDoor(x + pad, y, dw, h, variant, "right");
      drawShakerDoor(x + pad + dw + gap, y, dw, h, variant, "left");
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(x + pad + dw, y + 2, gap, h - 4);
  }

  function drawDrawer(x, y, w, h, variant) {
    const m = mat(variant);
    fillFace(x, y, w, h, variant, 3);
    drawBar(x + w * 0.2, y + h / 2 - 2, w * 0.6, 4, false, m.handle, m.handleHi);
  }

  function drawWorktop(x, y, w, th, variant) {
    const ox = 6;
    ctx.save();
    roundRect(x - ox, y, w + ox * 2, th, 2);
    ctx.clip();
    if (variant === "anthra") {
      const g = ctx.createLinearGradient(x, y, x, y + th);
      g.addColorStop(0, "#6a7078");
      g.addColorStop(0.5, "#3e444c");
      g.addColorStop(1, "#2a2e33");
      ctx.fillStyle = g;
      ctx.fillRect(x - ox, y, w + ox * 2, th);
    } else if (woodPat) {
      ctx.fillStyle = woodPat;
      ctx.fillRect(x - ox, y, w + ox * 2, th);
    } else {
      ctx.fillStyle = PAL.wood;
      ctx.fillRect(x - ox, y, w + ox * 2, th);
    }
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(x - ox, y, w + ox * 2, 3);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(x - ox, y + th - 4, w + ox * 2, 4);
    ctx.restore();
    ctx.strokeStyle = "rgba(40,24,8,0.35)";
    ctx.lineWidth = 1;
    roundRect(x - ox, y, w + ox * 2, th, 2);
    ctx.stroke();
  }

  function drawPlinth(x, y, w, h) {
    ctx.fillStyle = "#1a1d21";
    ctx.fillRect(x + 5, y, w - 10, h);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x + 5, y, w - 10, 2);
  }

  function drawCornice(x, y, w, h, variant) {
    fillFace(x - 3, y, w + 6, h, variant, 1);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.fillRect(x - 3, y + h - 2, w + 6, 2);
  }

  function drawLightRail(x, y, w) {
    ctx.fillStyle = "#2a2d32";
    ctx.fillRect(x + 3, y - 4, w - 6, 4);
    const glow = ctx.createLinearGradient(x, y, x, y + 18);
    glow.addColorStop(0, "rgba(232,196,110,0.38)");
    glow.addColorStop(1, "rgba(232,196,110,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x + 6, y, w - 12, 18);
  }

  function drawShelfBits(x, y, w) {
    ctx.fillStyle = "rgba(255,252,247,0.7)";
    ctx.beginPath();
    ctx.ellipse(x + w * 0.3, y, Math.min(11, w * 0.14), 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(80,70,60,0.35)";
    ctx.stroke();
    ctx.fillStyle = "rgba(7,78,162,0.4)";
    roundRect(x + w * 0.62, y - 11, 7, 12, 1.5);
    ctx.fill();
  }

  function drawOpenCarcass(x, y, w, h, variant) {
    const t = Math.max(8, w * 0.12);
    fillFace(x, y, w, h, variant, 4);
    const ih = Math.max(6, h - t * 2);
    ctx.save();
    roundRect(x + t, y + t, w - t * 2, ih, 2);
    ctx.clip();
    ctx.fillStyle = "#d7cbb6";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(x + t, y + t, 5, ih);
    const shelves = Math.max(1, Math.floor(ih / 40));
    for (let i = 1; i <= shelves; i++) {
      const sy = y + t + (ih * i) / (shelves + 1);
      ctx.fillStyle = variant === "wood" ? "rgba(90,55,22,0.4)" : "rgba(40,40,40,0.22)";
      ctx.fillRect(x + t, sy, w - t * 2, 4);
      drawShelfBits(x + t, sy - 2, w - t * 2);
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.1;
    roundRect(x + t, y + t, w - t * 2, ih, 2);
    ctx.stroke();
  }

  function drawColumn(cab, y, h, isTop) {
    const { x, w, variant, kind } = cab;
    if (h < 8) return;
    const depth = Math.max(7, w * 0.1);
    const frontW = w - depth;

    ctx.fillStyle = "rgba(20,24,30,0.2)";
    ctx.fillRect(x + 6, y + 8, w, Math.max(0, h - 4));

    ctx.fillStyle = mat(variant).side;
    ctx.beginPath();
    ctx.moveTo(x + frontW, y);
    ctx.lineTo(x + w, y + 6);
    ctx.lineTo(x + w, y + h + 6);
    ctx.lineTo(x + frontW, y + h);
    ctx.closePath();
    ctx.fill();

    if (kind === "frame") {
      drawOpenCarcass(x, y, frontW, h, variant);
      if (!isTop) drawPlinth(x, y + h - 10, frontW, 10);
      else drawLightRail(x, y + h, frontW);
      return;
    }

    if (isTop) {
      const cornice = Math.min(9, h * 0.12);
      const rail = 5;
      const bodyH = h - cornice - rail;
      if (bodyH < 22) {
        fillFace(x, y, frontW, h, variant, 4);
        drawLightRail(x, y + h, frontW);
        return;
      }
      drawCornice(x, y, frontW, cornice, variant);
      const target = clamp(frontW * 0.82, 46, 74);
      const n = Math.max(1, Math.round(bodyH / target));
      const modH = bodyH / n;
      const bodyY = y + cornice;
      for (let i = 0; i < n; i++) {
        drawDoorPair(x, bodyY + i * modH + 1, frontW, modH - 2, variant, i === n - 1 ? "h-bot" : false);
      }
      drawLightRail(x, y + h, frontW);
      return;
    }

    const topTh = clamp(h * 0.075, 17, 22);
    const drawerH = clamp(h * 0.11, 24, 34);
    const plinth = 12;
    drawWorktop(x, y, frontW, topTh, variant);
    let y0 = y + topTh;
    let remain = h - topTh - plinth;
    if (remain > drawerH + 30) {
      drawDrawer(x + 5, y0 + 2, frontW - 10, drawerH - 4, variant);
      y0 += drawerH;
      remain -= drawerH;
    }
    const target = clamp(frontW * 1.02, 50, 86);
    const n = Math.max(1, Math.round(remain / target));
    const modH = remain / n;
    for (let i = 0; i < n; i++) {
      drawDoorPair(x, y0 + i * modH + 1, frontW, modH - 2, variant, i === 0 ? "h-top" : false);
    }
    drawPlinth(x, y + h - plinth, frontW, plinth);
  }

  function drawCabinet(cab) {
    const topH = cab.gapY;
    const botY = cab.gapY + cab.gapH;
    const botH = state.H - botY;
    drawColumn(cab, 0, topH, true);
    drawColumn(cab, botY, botH, false);
  }

  function drawWorld() {
    const { W, H, ceilH, groundH } = state;
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#f5efe5");
    wall.addColorStop(1, "#e6d9c4");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    const far = state.bgX * 0.22;
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = PAL.navyDeep;
    for (let i = 0; i < 8; i++) {
      const fx = ((i * 96 - far) % (W + 200)) - 50;
      const topH = 52 + (i % 3) * 18;
      roundRect(fx, ceilH + 14, 58, topH, 2);
      ctx.fill();
      const botH = 64 + (i % 2) * 22;
      roundRect(fx + 8, H - groundH - botH, 62, botH, 2);
      ctx.fill();
      ctx.fillRect(fx + 5, H - groundH - botH - 6, 68, 6);
    }
    ctx.globalAlpha = 1;

    for (const cab of cabs) drawCabinet(cab);

    ctx.fillStyle = PAL.navyDeep;
    ctx.fillRect(0, 0, W, ceilH);
    ctx.fillStyle = PAL.navy;
    ctx.fillRect(0, ceilH - 4, W, 3);
    ctx.fillStyle = PAL.gold;
    ctx.fillRect(0, ceilH - 1, W, 1.5);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, H - groundH, W, groundH);
    ctx.clip();
    if (woodPat) {
      ctx.fillStyle = woodPat;
      ctx.fillRect(0, H - groundH, W, groundH);
    } else {
      ctx.fillStyle = PAL.wood;
      ctx.fillRect(0, H - groundH, W, groundH);
    }
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(0, H - groundH + 10 + i * 10, W, 1);
    }
    ctx.restore();
    ctx.fillStyle = PAL.anthra;
    ctx.fillRect(0, H - groundH, W, 7);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, H - groundH + 1, W, 1);
  }

  function drawBird() {
    const rot = state.mode === "start" ? 0 : clamp(bird.vy / (900 * state.vu), -0.45, 0.9);
    const cycle = [0, 1, 2, 1];
    const fi = cycle[Math.floor(bird.wingT) % 4];
    bird.frame = state.mode === "dead" ? 2 : fi;
    const s = bird.size;
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(rot);
    let img = null;
    if (state.bird === "owl" && assets.owl[bird.frame]) img = assets.owl[bird.frame];
    else if (state.bird === "sparrow" && assets.sparrow) img = assets.sparrow;
    if (img) {
      ctx.drawImage(img, -s * 0.58, -s * 0.52, s * 1.2, s * 1.05);
    } else {
      ctx.fillStyle = PAL.navy;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.38, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(s * 0.16)}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText("HAGRO", 0, 4);
    }
    ctx.restore();
  }

  function drawBits() {
    for (const p of bits) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
    }
    drawWorld();
    drawBits();
    drawBird();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${state.flash})`;
      ctx.fillRect(0, 0, state.W, state.H);
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (state.last || now)) / 1000);
    state.last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function setMute(on) {
    sfx.muted = on;
    storeSet(STORE_MUTE, on ? "1" : "0");
    muteBtn.setAttribute("aria-pressed", on ? "true" : "false");
    muteBtn.setAttribute("aria-label", on ? "Geluid uit" : "Geluid aan");
    iconOn.hidden = on;
    iconOff.hidden = !on;
  }

  function setBird(id) {
    state.bird = id === "sparrow" ? "sparrow" : "owl";
    storeSet(STORE_BIRD, state.bird);
    document.querySelectorAll(".char").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.bird === state.bird);
    });
  }

  function onPointer(e) {
    if (e.target.closest("a, button")) return;
    e.preventDefault();
    flap();
  }

  function bootUI() {
    hiEl.textContent = String(state.hi);
    setMute(sfx.muted);
    setBird(state.bird);
    hud.classList.remove("is-on");
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(src));
      img.src = src;
    });
  }

  async function loadAssets() {
    try {
      const [up, mid, down, sparrow, wood, oak] = await Promise.all([
        loadImage("assets/owl-up-v2.png"),
        loadImage("assets/owl-mid-v2.png"),
        loadImage("assets/owl-down-v2.png"),
        loadImage("assets/sparrow-v2.png"),
        loadImage("assets/wood.png"),
        loadImage("assets/oak-door.png"),
      ]);
      assets.owl = [up, mid, down];
      assets.sparrow = sparrow;
      assets.wood = wood;
      assets.oak = oak;
      woodPat = ctx.createPattern(wood, "repeat");
      assets.ready = true;
    } catch (err) {
      assets.ready = false;
    }
  }

  function onResize() {
    const yRatio = bird.y / (state.H || 1);
    layout();
    bird.y = yRatio * state.H;
  }
  window.addEventListener("resize", onResize);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResize);
  }
  window.addEventListener("pointerdown", onPointer, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    }
    if (e.key === "m" || e.key === "M") setMute(!sfx.muted);
  });
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  muteBtn.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    sfx.ensure();
    setMute(!sfx.muted);
  });
  document.querySelectorAll(".char").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      setBird(btn.dataset.bird);
    });
  });
  document.querySelector(".site").addEventListener("pointerdown", (e) => e.stopPropagation());

  window.__kastflap = () => ({
    mode: state.mode,
    score: state.score,
    y: bird.y,
    vy: bird.vy,
    x: bird.x,
    H: state.H,
    W: state.W,
    ceilH: state.ceilH,
    groundH: state.groundH,
    cabs: cabs.map((c) => ({
      x: c.x,
      w: c.w,
      gapY: c.gapY,
      gapH: c.gapH,
      kind: c.kind,
      variant: c.variant,
      scored: c.scored,
    })),
  });

  layout();
  bootUI();
  resetWorld(true);
  loadAssets();
  requestAnimationFrame(frame);
})();
