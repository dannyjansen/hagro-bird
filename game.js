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

  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.W = W;
    state.H = H;
    state.vu = H / 800;
    state.groundH = Math.max(68, H * 0.11);
    state.ceilH = Math.max(26, H * 0.042);
    state.playH = H - state.groundH - state.ceilH;
    bird.size = clamp(Math.round(H * 0.092), 54, 82);
    bird.x = W * 0.27;
    state.cabW = clamp(Math.round(W * 0.2), 70, 98);
  }

  function difficulty(score) {
    const t = clamp(score / 22, 0, 1);
    return {
      speed: lerp(150, 255, t) * state.vu,
      gap: lerp(0.36, 0.24, t) * state.playH,
      spacing: lerp(290, 220, t) * Math.max(state.W / 390, 0.85),
    };
  }

  function makeCab(x) {
    const d = difficulty(state.score);
    const minCab = Math.max(58, state.playH * 0.12);
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
    const startX = attract ? state.W * 0.52 : state.W + 40;
    for (let i = 0; i < 4; i++) cabs.push(makeCab(startX + i * d.spacing));
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
    bird.vy = -430 * state.vu;
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
    bird.vy = -500 * state.vu;
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

    const g = 1780 * state.vu;
    bird.vy = Math.min(bird.vy + g * dt, 920 * state.vu);
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

    const r = bird.size * 0.22;
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

  function fillBody(x, y, w, h, variant) {
    if (variant === "wood") {
      ctx.save();
      roundRect(x, y, w, h, 5);
      ctx.clip();
      if (assets.oak) ctx.drawImage(assets.oak, x, y, w, Math.max(h, w));
      else if (woodPat) {
        ctx.fillStyle = woodPat;
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(x, y, w, h);
      }
      ctx.fillStyle = "rgba(40,24,8,0.12)";
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = "rgba(70,42,16,0.55)";
      ctx.lineWidth = 1.5;
      roundRect(x, y, w, h, 5);
      ctx.stroke();
      return;
    }
    if (variant === "anthra") {
      const g = ctx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "#2f3338");
      g.addColorStop(0.5, "#3d4248");
      g.addColorStop(1, "#2a2e33");
      ctx.fillStyle = g;
      roundRect(x, y, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      return;
    }
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, "#f3f1ec");
    g.addColorStop(0.45, "#fff");
    g.addColorStop(1, "#e7e3db");
    ctx.fillStyle = g;
    roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(160,150,138,0.55)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function handleColor(variant) {
    if (variant === "anthra") return PAL.gold;
    if (variant === "wood") return PAL.handle;
    return PAL.navy;
  }

  function drawDoor(x, y, w, h, variant, handleAt) {
    ctx.save();
    fillBody(x, y, w, h, variant);
    ctx.strokeStyle = variant === "anthra" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    const inset = Math.max(5, w * 0.1);
    roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, 2);
    ctx.stroke();
    const lines = 3;
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = variant === "white" ? "#6d655c" : "#fff";
    for (let i = 1; i < lines; i++) {
      const ly = y + (h * i) / lines;
      ctx.beginPath();
      ctx.moveTo(x + inset + 2, ly);
      ctx.lineTo(x + w - inset - 2, ly);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const hw = Math.max(14, w * 0.42);
    const hh = 4;
    const hx = x + (w - hw) / 2;
    const hy = handleAt === "top" ? y + 10 : y + h - 14;
    ctx.fillStyle = handleColor(variant);
    roundRect(hx, hy, hw, hh, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSolid(cab, y, h, isTop) {
    const { x, w, variant } = cab;
    ctx.fillStyle = "rgba(20,24,30,0.18)";
    ctx.fillRect(x + 5, y + 7, w, h);
    fillBody(x, y, w, h, variant);

    if (!isTop) {
      const th = Math.max(9, Math.min(16, h * 0.08));
      ctx.save();
      roundRect(x - 4, y, w + 8, th, 2);
      ctx.clip();
      if (woodPat) {
        ctx.fillStyle = woodPat;
        ctx.fillRect(x - 4, y, w + 8, th);
      } else {
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(x - 4, y, w + 8, th);
      }
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x - 4, y + th - 3, w + 8, 3);
      ctx.restore();
      ctx.fillStyle = PAL.anthra;
      ctx.fillRect(x + 3, y + h - 9, w - 6, 9);
    } else {
      ctx.fillStyle = variant === "anthra" ? "#23262b" : variant === "wood" ? PAL.woodDark : "#ded9d0";
      ctx.fillRect(x - 3, y + h - 6, w + 6, 6);
    }

    const inset = 7;
    const gap = 5;
    const doorW = (w - inset * 2 - gap) / 2;
    const topPad = isTop ? 8 : Math.max(14, h * 0.08) + 4;
    const botPad = isTop ? 12 : 14;
    const doorY = y + topPad;
    const doorH = Math.max(20, h - topPad - botPad);
    if (doorH > 18) {
      drawDoor(x + inset, doorY, doorW, doorH, variant, isTop ? "bottom" : "top");
      drawDoor(x + inset + doorW + gap, doorY, doorW, doorH, variant, isTop ? "bottom" : "top");
    }
  }

  function drawFrame(cab, y, h, isTop) {
    const { x, w, variant } = cab;
    const t = Math.max(10, w * 0.16);
    ctx.fillStyle = "rgba(20,24,30,0.16)";
    ctx.fillRect(x + 4, y + 5, w, h);
    fillBody(x, y, w, h, variant);
    ctx.save();
    ctx.beginPath();
    roundRect(x + t, y + t, w - t * 2, Math.max(4, h - t * 2), 3);
    ctx.clip();
    ctx.fillStyle = "#efe6d6";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "rgba(28,31,36,0.18)";
    ctx.fillRect(x + t, y + h * 0.48, w - t * 2, 4);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1.2;
    roundRect(x + t, y + t, w - t * 2, Math.max(4, h - t * 2), 3);
    ctx.stroke();
    if (!isTop) {
      ctx.fillStyle = PAL.anthra;
      ctx.fillRect(x + 2, y + h - 8, w - 4, 8);
    }
  }

  function drawCabinet(cab) {
    const topH = cab.gapY;
    const botY = cab.gapY + cab.gapH;
    const botH = state.H - botY;
    if (cab.kind === "frame") {
      drawFrame(cab, 0, topH, true);
      drawFrame(cab, botY, botH, false);
    } else {
      drawSolid(cab, 0, topH, true);
      drawSolid(cab, botY, botH, false);
    }
  }

  function drawWorld() {
    const { W, H, ceilH, groundH } = state;
    const wall = ctx.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#f5efe5");
    wall.addColorStop(1, "#e6d9c4");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);

    const far = state.bgX * 0.22;
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 8; i++) {
      const fx = ((i * 90 - far) % (W + 180)) - 40;
      const fh = 70 + (i % 3) * 28;
      ctx.fillStyle = PAL.navyDeep;
      roundRect(fx, ceilH + 20, 54, fh, 3);
      ctx.fill();
      roundRect(fx + 10, H - groundH - fh - 10, 54, fh, 3);
      ctx.fill();
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
        loadImage("assets/owl-up.png"),
        loadImage("assets/owl-mid.png"),
        loadImage("assets/owl-down.png"),
        loadImage("assets/sparrow.png"),
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

  window.addEventListener("resize", () => {
    const yRatio = bird.y / (state.H || 1);
    layout();
    bird.y = yRatio * state.H;
  });
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
