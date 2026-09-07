(() => {
  "use strict";

  const STORE_HI = "hagrobird-hi";
  const STORE_MUTE = "hagrobird-mute";
  const STORE_BIRD = "hagrobird-bird";

  function storeGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      if (v != null) return v;
      const legacy = localStorage.getItem(key.replace("hagrobird-", "kastflap-"));
      return legacy == null ? fallback : legacy;
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

  const J = window.HagroJump;
  if (!J) throw new Error("jump.js moet voor game.js geladen worden");
  const PHYS = J.PHYS;

  const canvas = document.getElementById("game");
  const ctx =
    canvas.getContext("2d", { alpha: false, desynchronized: true }) ||
    canvas.getContext("2d", { alpha: false });
  let gfx = ctx;
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
  let oakPat = null;
  let wallGrad = null;
  let prepared = null;
  const CACHE_PAD = 22;

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
    quality: J.pickStartQuality({
      deviceMemory: navigator.deviceMemory,
      saveData: !!(navigator.connection && navigator.connection.saveData),
    }),
    lastDraw: 0,
    qualityGraceUntil: 0,
    badWindows: 0,
  };
  const frameSamples = [];
  const DRAW_SAMPLES = 90;

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
    const W = Math.max(1, Math.round(window.innerWidth || 1));
    const H = Math.max(1, Math.round(window.innerHeight || 1));
    return { W, H };
  }

  function qcfg() {
    return J.qualityConfig(state.quality);
  }

  function layout() {
    const q = qcfg();
    const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap);
    state.drawDpr = dpr;
    state.cacheDpr = q.cacheDpr;
    state.simple = q.simple;
    const { W, H } = viewSize();
    const pixelW = Math.round(W * dpr);
    const pixelH = Math.round(H * dpr);
    if (canvas.width === pixelW && canvas.height === pixelH && state.W === W && state.H === H && state.drawDpr === dpr) {
      return;
    }
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = !q.simple;
    state.W = W;
    state.H = H;
    state.vu = clamp(W / 390, 0.82, 1.15);
    state.groundH = Math.max(48, H * 0.08);
    state.ceilH = Math.max(20, H * 0.03);
    state.playH = H - state.groundH - state.ceilH;
    bird.size = clamp(Math.round(46 * state.vu), 40, 56);
    bird.x = W * 0.22;
    state.cabW = clamp(Math.round(62 * state.vu), 52, 74);
    wallGrad = ctx.createLinearGradient(0, 0, 0, H);
    wallGrad.addColorStop(0, "#f5efe5");
    wallGrad.addColorStop(1, "#e6d9c4");
    for (let i = 0; i < cabs.length; i++) cabs[i].w = state.cabW;
    invalidateCabCaches();
  }

  function difficulty(score) {
    return J.difficulty(score, state.vu, state.playH);
  }

  function layoutOpts() {
    return {
      vu: state.vu,
      W: state.W,
      H: state.H,
      ceilH: state.ceilH,
      groundH: state.groundH,
      playH: state.playH,
      cabW: state.cabW,
      birdY: state.H * 0.42,
      birdR: bird.size * 0.24,
    };
  }

  function spawnCab(x, prev, score) {
    return J.makeCabinet(Object.assign(layoutOpts(), { x, prev, score }));
  }

  function prepareLevel() {
    prepared = J.buildCabinets(
      Object.assign(layoutOpts(), { count: J.AHEAD, startX: state.W + 36 })
    );
  }

  function resetBird() {
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

  function resetWorld(attract) {
    cabs.length = 0;
    bits.length = 0;
    const startX = attract ? state.W * 0.58 : state.W + 36;
    const count = attract ? 6 : J.AHEAD;
    const built = J.buildCabinets(Object.assign(layoutOpts(), { count, startX }));
    for (let i = 0; i < built.length; i++) cabs.push(built[i]);
    resetBird();
  }

  function startGame() {
    bits.length = 0;
    if (!prepared || prepared.length < J.AHEAD) prepareLevel();
    cabs.length = 0;
    for (let i = 0; i < prepared.length; i++) cabs.push(prepared[i]);
    prepared = null;
    resetBird();
    state.mode = "play";
    overlay.classList.add("is-off");
    hud.classList.add("is-on");
    bird.vy = -400 * state.vu;
    sfx.flap();
    puff(bird.x - 8, bird.y + 10, 6, PAL.white);
    state.qualityGraceUntil = performance.now() + 1800;
    state.badWindows = 0;
    frameSamples.length = 0;
    warmVisible(1);
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
    titleEl.textContent = "HagroBird";
    resultEl.hidden = false;
    resultEl.innerHTML = best
      ? `Nieuw record <strong>${state.score}</strong>`
      : `Score <strong>${state.score}</strong>`;
    ctaEl.textContent = "Tik om opnieuw";
    overlay.dataset.mode = "dead";
    prepareLevel();
    window.setTimeout(() => {
      if (state.mode === "dead") {
        overlay.classList.remove("is-off");
        hud.classList.remove("is-on");
        warmPrepared(8);
        idleWarm();
      }
    }, 420);
  }

  function flap() {
    if (state.mode === "start") {
      sfx.ensure();
      startGame();
      return;
    }
    if (state.mode === "dead") {
      if (performance.now() - state.diedAt < 480) return;
      sfx.ensure();
      overlay.dataset.mode = "start";
      resultEl.hidden = true;
      ctaEl.textContent = "Tik om te starten";
      startGame();
      return;
    }
    bird.vy = PHYS.flap * state.vu;
    bird.wingT = 0;
    const jx = bird.x - 10;
    const jy = bird.y + 12;
    requestAnimationFrame(() => {
      sfx.flap();
      puff(jx, jy, 5, "#ffffffcc");
    });
  }

  function puff(x, y, n, color) {
    const scale = qcfg().particles;
    if (scale <= 0) return;
    n = Math.max(1, Math.round(n * scale));
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

    const g = PHYS.gravity * state.vu;
    bird.vy = Math.min(bird.vy + g * dt, PHYS.vyMax * state.vu);
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
    for (const cab of cabs) {
      cab.x -= d.speed * dt;
      if (!cab.scored && cab.x + cab.w < bird.x) {
        cab.scored = true;
        state.score += 1;
        scoreEl.textContent = String(state.score);
        const px = bird.x + 16;
        const py = bird.y;
        requestAnimationFrame(() => {
          sfx.point();
          puff(px, py, 7, PAL.gold);
        });
      }
    }
    while (cabs.length && cabs[0].x + cabs[0].w < -80) {
      cabs.shift().cache = null;
    }
    while (cabs.length < J.AHEAD) {
      const last = cabs[cabs.length - 1];
      if (!last) {
        const built = J.buildCabinets(
          Object.assign(layoutOpts(), { count: J.AHEAD, startX: state.W + 36 })
        );
        for (let i = 0; i < built.length; i++) cabs.push(built[i]);
        break;
      }
      const idx = last.idx + 1;
      cabs.push(spawnCab(last.x + difficulty(idx).spacing, last, idx));
    }

    const r = bird.size * 0.24;
    if (bird.y - r < state.ceilH || bird.y + r > state.H - state.groundH) {
      gameOver();
      return;
    }
    for (const cab of cabs) {
      if (cab.x > bird.x + r + 8) break;
      if (cab.x + cab.w < bird.x - r) continue;
      if (hitsCab(cab, bird.x, bird.y, r)) {
        gameOver();
        return;
      }
    }
  }

  function makeOffscreen(w, h) {
    const dpr = state.cacheDpr || 1;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    const cctx = c.getContext("2d");
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.imageSmoothingEnabled = !state.simple;
    return { canvas: c, ctx: cctx };
  }

  function ensureCabCache(cab) {
    if (cab.cache && cab.cache.H === state.H && cab.cache.w === cab.w) return;
    const topH = cab.gapY;
    const botH = Math.max(1, state.H - (cab.gapY + cab.gapH));
    const origX = cab.x;
    cab.x = 0;
    const prev = gfx;

    const top = makeOffscreen(cab.w, topH + CACHE_PAD);
    gfx = top.ctx;
    drawColumn(cab, 0, topH, true);

    const bot = makeOffscreen(cab.w, botH);
    gfx = bot.ctx;
    drawColumn(cab, 0, botH, false);

    gfx = prev;
    cab.x = origX;
    cab.cache = {
      top: top.canvas,
      bot: bot.canvas,
      topH,
      botH,
      pad: CACHE_PAD,
      H: state.H,
      w: cab.w,
    };
    trimCaches();
  }

  function trimCaches() {
    const max = qcfg().maxCache;
    const lists = prepared ? [cabs, prepared] : [cabs];
    const held = [];
    for (let L = 0; L < lists.length; L++) {
      const list = lists[L];
      for (let i = 0; i < list.length; i++) {
        if (list[i].cache) held.push(list[i]);
      }
    }
    if (held.length <= max) return;
    held.sort((a, b) => a.x - b.x);
    while (held.length > max) {
      const passed = held[0].x + held[0].w < 0 ? held.shift() : held.pop();
      passed.cache = null;
    }
  }

  function cacheHorizon() {
    const q = qcfg();
    return state.W + (state.mode === "play" ? q.horizonPlay : q.horizonPrep);
  }

  function warmList(list, budget, horizon) {
    if (!list) return;
    let left = budget;
    for (let i = 0; i < list.length; i++) {
      if (left <= 0) return;
      const cab = list[i];
      if (cab.x > horizon) return;
      if (cab.x + cab.w < -80) {
        cab.cache = null;
        continue;
      }
      if (!cab.cache || cab.cache.H !== state.H || cab.cache.w !== cab.w) {
        ensureCabCache(cab);
        left -= 1;
      }
    }
  }

  function warmUpcoming(allNear) {
    const q = qcfg();
    warmList(cabs, allNear ? q.warmStart : q.warmPlay, cacheHorizon());
  }

  function warmVisible(maxN) {
    let n = 0;
    for (let i = 0; i < cabs.length && n < maxN; i++) {
      const cab = cabs[i];
      if (cab.x > state.W + 48) break;
      if (!cab.cache || cab.cache.H !== state.H || cab.cache.w !== cab.w) {
        ensureCabCache(cab);
        n += 1;
      }
    }
  }

  function warmWithBudget(ms) {
    const list = state.mode === "play" ? cabs : prepared;
    if (!list || !list.length) return;
    const t0 = performance.now();
    const horizon = cacheHorizon();
    for (let i = 0; i < list.length; i++) {
      if (performance.now() - t0 >= ms) return;
      const cab = list[i];
      if (cab.x > horizon) return;
      if (cab.x + cab.w < -80) {
        cab.cache = null;
        continue;
      }
      if (!cab.cache || cab.cache.H !== state.H || cab.cache.w !== cab.w) {
        ensureCabCache(cab);
        return;
      }
    }
  }

  function warmPrepared(n) {
    warmList(prepared, n, cacheHorizon());
  }

  function idleWarm() {
    const ric = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 40));
    const step = () => {
      const list = state.mode === "play" ? cabs : prepared;
      if (!list || !list.length) return;
      warmList(list, qcfg().warmPlay, cacheHorizon());
      const pending = list.some(
        (cab) => cab.x <= cacheHorizon() && (!cab.cache || cab.cache.H !== state.H)
      );
      if (pending && state.mode !== "play") ric(step, { timeout: 180 });
    };
    ric(step, { timeout: 180 });
  }

  function invalidateCabCaches() {
    for (let i = 0; i < cabs.length; i++) cabs[i].cache = null;
    if (prepared) for (let i = 0; i < prepared.length; i++) prepared[i].cache = null;
  }

  function roundRect(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    gfx.beginPath();
    if (gfx.roundRect) gfx.roundRect(x, y, w, h, rad);
    else {
      gfx.moveTo(x + rad, y);
      gfx.arcTo(x + w, y, x + w, y + h, rad);
      gfx.arcTo(x + w, y + h, x, y + h, rad);
      gfx.arcTo(x, y + h, x, y, rad);
      gfx.arcTo(x, y, x + w, y, rad);
      gfx.closePath();
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
    if (state.simple) {
      if (variant === "wood") gfx.fillStyle = woodPat && qcfg().oak ? woodPat : PAL.wood;
      else if (variant === "anthra") gfx.fillStyle = "#3a4047";
      else gfx.fillStyle = "#ece8e0";
      if (variant === "wood" && oakPat && qcfg().oak) gfx.fillStyle = oakPat;
      gfx.fillRect(x, y, w, h);
      gfx.fillStyle = m.hi;
      gfx.fillRect(x, y, 2, h);
      return;
    }
    gfx.save();
    roundRect(x, y, w, h, r);
    gfx.clip();
    if (variant === "wood") {
      if (oakPat && qcfg().oak) {
        gfx.fillStyle = oakPat;
        gfx.fillRect(x, y, w, h);
      } else if (woodPat) {
        gfx.fillStyle = woodPat;
        gfx.fillRect(x, y, w, h);
      } else {
        gfx.fillStyle = PAL.wood;
        gfx.fillRect(x, y, w, h);
      }
      gfx.fillStyle = "rgba(60,36,12,0.1)";
      gfx.fillRect(x, y, w, h);
    } else if (variant === "anthra") {
      const g = gfx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "#2a2e34");
      g.addColorStop(0.45, "#41484f");
      g.addColorStop(1, "#262a2f");
      gfx.fillStyle = g;
      gfx.fillRect(x, y, w, h);
    } else {
      const g = gfx.createLinearGradient(x, y, x + w, y);
      g.addColorStop(0, "#ece8e0");
      g.addColorStop(0.35, "#fffcf7");
      g.addColorStop(1, "#ddd6cb");
      gfx.fillStyle = g;
      gfx.fillRect(x, y, w, h);
    }
    gfx.fillStyle = m.hi;
    gfx.fillRect(x, y, 3, h);
    gfx.fillRect(x, y, w, 2);
    gfx.fillStyle = m.sh;
    gfx.fillRect(x + w - 3, y, 3, h);
    gfx.fillRect(x, y + h - 2, w, 2);
    gfx.restore();
    gfx.strokeStyle = m.edge;
    gfx.lineWidth = 1.15;
    roundRect(x, y, w, h, r);
    gfx.stroke();
  }

  function drawBar(x, y, len, thick, vertical, color, hi) {
    if (len < 8) return;
    gfx.save();
    if (vertical) {
      roundRect(x, y, thick, len, thick / 2);
      const g = gfx.createLinearGradient(x, y, x + thick, y);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, color);
      g.addColorStop(1, color);
      gfx.fillStyle = g;
      gfx.fill();
    } else {
      roundRect(x, y, len, thick, thick / 2);
      const g = gfx.createLinearGradient(x, y, x, y + thick);
      g.addColorStop(0, hi);
      g.addColorStop(0.45, color);
      g.addColorStop(1, color);
      gfx.fillStyle = g;
      gfx.fill();
    }
    gfx.restore();
  }

  function drawShakerDoor(x, y, w, h, variant, handleSide) {
    const m = mat(variant);
    fillFace(x, y, w, h, variant, 3);
    const fr = Math.max(5, Math.min(9, w * 0.15));
    if (h > fr * 2 + 10 && w > fr * 2 + 8) {
      gfx.strokeStyle = m.groove;
      gfx.lineWidth = 1.5;
      roundRect(x + fr, y + fr, w - fr * 2, h - fr * 2, 2);
      gfx.stroke();
      gfx.fillStyle = m.inner;
      gfx.fillRect(x + fr + 1, y + fr + 1, w - fr * 2 - 2, 3);
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
    gfx.fillStyle = "rgba(0,0,0,0.12)";
    gfx.fillRect(x + pad + dw, y + 2, gap, h - 4);
  }

  function drawDrawer(x, y, w, h, variant) {
    const m = mat(variant);
    fillFace(x, y, w, h, variant, 3);
    drawBar(x + w * 0.2, y + h / 2 - 2, w * 0.6, 4, false, m.handle, m.handleHi);
  }

  function drawWorktop(x, y, w, th, variant) {
    const ox = 6;
    gfx.save();
    roundRect(x - ox, y, w + ox * 2, th, 2);
    gfx.clip();
    if (variant === "anthra") {
      const g = gfx.createLinearGradient(x, y, x, y + th);
      g.addColorStop(0, "#6a7078");
      g.addColorStop(0.5, "#3e444c");
      g.addColorStop(1, "#2a2e33");
      gfx.fillStyle = g;
      gfx.fillRect(x - ox, y, w + ox * 2, th);
    } else if (woodPat) {
      gfx.fillStyle = woodPat;
      gfx.fillRect(x - ox, y, w + ox * 2, th);
    } else {
      gfx.fillStyle = PAL.wood;
      gfx.fillRect(x - ox, y, w + ox * 2, th);
    }
    gfx.fillStyle = "rgba(255,255,255,0.28)";
    gfx.fillRect(x - ox, y, w + ox * 2, 3);
    gfx.fillStyle = "rgba(0,0,0,0.3)";
    gfx.fillRect(x - ox, y + th - 4, w + ox * 2, 4);
    gfx.restore();
    gfx.strokeStyle = "rgba(40,24,8,0.35)";
    gfx.lineWidth = 1;
    roundRect(x - ox, y, w + ox * 2, th, 2);
    gfx.stroke();
  }

  function drawPlinth(x, y, w, h) {
    gfx.fillStyle = "#1a1d21";
    gfx.fillRect(x + 5, y, w - 10, h);
    gfx.fillStyle = "rgba(255,255,255,0.06)";
    gfx.fillRect(x + 5, y, w - 10, 2);
  }

  function drawCornice(x, y, w, h, variant) {
    fillFace(x - 3, y, w + 6, h, variant, 1);
    gfx.fillStyle = "rgba(0,0,0,0.16)";
    gfx.fillRect(x - 3, y + h - 2, w + 6, 2);
  }

  function drawLightRail(x, y, w) {
    gfx.fillStyle = "#2a2d32";
    gfx.fillRect(x + 3, y - 4, w - 6, 4);
    const glow = gfx.createLinearGradient(x, y, x, y + 18);
    glow.addColorStop(0, "rgba(232,196,110,0.38)");
    glow.addColorStop(1, "rgba(232,196,110,0)");
    gfx.fillStyle = glow;
    gfx.fillRect(x + 6, y, w - 12, 18);
  }

  function drawShelfBits(x, y, w) {
    gfx.fillStyle = "rgba(255,252,247,0.7)";
    gfx.beginPath();
    gfx.ellipse(x + w * 0.3, y, Math.min(11, w * 0.14), 3.5, 0, 0, Math.PI * 2);
    gfx.fill();
    gfx.strokeStyle = "rgba(80,70,60,0.35)";
    gfx.stroke();
    gfx.fillStyle = "rgba(7,78,162,0.4)";
    roundRect(x + w * 0.62, y - 11, 7, 12, 1.5);
    gfx.fill();
  }

  function drawOpenCarcass(x, y, w, h, variant) {
    const t = Math.max(8, w * 0.12);
    fillFace(x, y, w, h, variant, 4);
    const ih = Math.max(6, h - t * 2);
    gfx.save();
    roundRect(x + t, y + t, w - t * 2, ih, 2);
    gfx.clip();
    gfx.fillStyle = "#d7cbb6";
    gfx.fillRect(x, y, w, h);
    gfx.fillStyle = "rgba(0,0,0,0.14)";
    gfx.fillRect(x + t, y + t, 5, ih);
    const shelves = Math.max(1, Math.floor(ih / 40));
    for (let i = 1; i <= shelves; i++) {
      const sy = y + t + (ih * i) / (shelves + 1);
      gfx.fillStyle = variant === "wood" ? "rgba(90,55,22,0.4)" : "rgba(40,40,40,0.22)";
      gfx.fillRect(x + t, sy, w - t * 2, 4);
      drawShelfBits(x + t, sy - 2, w - t * 2);
    }
    gfx.restore();
    gfx.strokeStyle = "rgba(0,0,0,0.22)";
    gfx.lineWidth = 1.1;
    roundRect(x + t, y + t, w - t * 2, ih, 2);
    gfx.stroke();
  }

  function drawColumnSimple(cab, y, h, isTop) {
    const { x, w, variant } = cab;
    if (h < 8) return;
    const m = mat(variant);
    gfx.fillStyle = m.side;
    gfx.fillRect(x + w - 5, y, 5, h);
    fillFace(x, y, w - 5, h, variant, 2);
    gfx.fillStyle = m.handle;
    if (isTop) gfx.fillRect(x + w - 13, y + 8, 3, Math.max(10, h - 16));
    else {
      gfx.fillStyle = variant === "anthra" ? "#3e444c" : PAL.wood;
      gfx.fillRect(x - 2, y, w + 1, 8);
      gfx.fillStyle = m.handle;
      gfx.fillRect(x + 8, y + 14, w - 22, 3);
    }
  }

  function drawColumn(cab, y, h, isTop) {
    if (state.simple) {
      drawColumnSimple(cab, y, h, isTop);
      return;
    }
    const { x, w, variant, kind } = cab;
    if (h < 8) return;
    const depth = Math.max(7, w * 0.1);
    const frontW = w - depth;

    gfx.fillStyle = "rgba(20,24,30,0.2)";
    gfx.fillRect(x + 6, y + 8, w, Math.max(0, h - 4));

    gfx.fillStyle = mat(variant).side;
    gfx.beginPath();
    gfx.moveTo(x + frontW, y);
    gfx.lineTo(x + w, y + 6);
    gfx.lineTo(x + w, y + h + 6);
    gfx.lineTo(x + frontW, y + h);
    gfx.closePath();
    gfx.fill();

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
    if (cab.x + cab.w < -8 || cab.x > state.W + 8) return;
    if (!cab.cache || cab.cache.H !== state.H || cab.cache.w !== cab.w) {
      ensureCabCache(cab);
    }
    if (cab.cache && cab.cache.H === state.H && cab.cache.w === cab.w) {
      gfx.drawImage(cab.cache.top, cab.x, 0, cab.w, cab.cache.topH + cab.cache.pad);
      gfx.drawImage(cab.cache.bot, cab.x, cab.gapY + cab.gapH, cab.w, cab.cache.botH);
      return;
    }
    const topH = cab.gapY;
    const botY = cab.gapY + cab.gapH;
    const botH = state.H - botY;
    drawColumn(cab, 0, topH, true);
    drawColumn(cab, botY, botH, false);
  }

  function drawWorld() {
    const { W, H, ceilH, groundH } = state;
    gfx.fillStyle = wallGrad || "#e6d9c4";
    gfx.fillRect(0, 0, W, H);

    const q = qcfg();
    if (q.farBg) {
      const far = state.bgX * 0.22;
      gfx.globalAlpha = 0.16;
      gfx.fillStyle = PAL.navyDeep;
      for (let i = 0; i < 8; i++) {
        const fx = ((i * 96 - far) % (W + 200)) - 50;
        const topH = 52 + (i % 3) * 18;
        roundRect(fx, ceilH + 14, 58, topH, 2);
        gfx.fill();
        const botH = 64 + (i % 2) * 22;
        roundRect(fx + 8, H - groundH - botH, 62, botH, 2);
        gfx.fill();
        gfx.fillRect(fx + 5, H - groundH - botH - 6, 68, 6);
      }
      gfx.globalAlpha = 1;
    }

    const overlayOn = !overlay.classList.contains("is-off");
    if (!overlayOn || q.farBg) {
      for (const cab of cabs) drawCabinet(cab);
    }

    gfx.fillStyle = PAL.navyDeep;
    gfx.fillRect(0, 0, W, ceilH);
    gfx.fillStyle = PAL.navy;
    gfx.fillRect(0, ceilH - 4, W, 3);
    gfx.fillStyle = PAL.gold;
    gfx.fillRect(0, ceilH - 1, W, 1.5);

    if (woodPat) {
      gfx.fillStyle = woodPat;
      gfx.fillRect(0, H - groundH, W, groundH);
    } else {
      gfx.fillStyle = PAL.wood;
      gfx.fillRect(0, H - groundH, W, groundH);
    }
    if (!state.simple) {
      gfx.fillStyle = "rgba(0,0,0,0.08)";
      for (let i = 0; i < 6; i++) {
        gfx.fillRect(0, H - groundH + 10 + i * 10, W, 1);
      }
    }
    gfx.fillStyle = PAL.anthra;
    gfx.fillRect(0, H - groundH, W, 7);
    gfx.fillStyle = "rgba(255,255,255,0.18)";
    gfx.fillRect(0, H - groundH + 1, W, 1);
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
    gfx = ctx;
    ctx.save();
    if (state.shake > 0 && qcfg().shake) {
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

  function setQuality(level) {
    if (level === state.quality) return;
    state.quality = level;
    state.simple = qcfg().simple;
    frameSamples.length = 0;
    state.badWindows = 0;
    state.qualityGraceUntil = performance.now() + 1500;
  }

  function noteDraw(drawMs) {
    if (state.mode !== "play") return;
    if (performance.now() < state.qualityGraceUntil) return;
    frameSamples.push(drawMs);
    if (frameSamples.length < DRAW_SAMPLES) return;
    const sorted = frameSamples.slice().sort((a, b) => a - b);
    const stats = {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
    frameSamples.length = 0;
    if (J.shouldDowngrade(stats)) {
      state.badWindows += 1;
      if (state.badWindows >= 2 && state.quality !== "low") {
        setQuality(J.nextQuality(state.quality));
      }
    } else {
      state.badWindows = 0;
      if (J.shouldUpgrade(stats) && state.quality !== "high") {
        setQuality(J.prevQuality(state.quality));
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (state.last || now)) / 1000);
    state.last = now;
    update(dt);
    const minDraw = 1000 / qcfg().fps;
    const due = !state.lastDraw || now - state.lastDraw >= minDraw - 0.5;
    if (due) {
      const t0 = performance.now();
      draw();
      const drawMs = performance.now() - t0;
      state.lastDraw = now;
      noteDraw(drawMs);
      if (drawMs < 10) warmWithBudget(3);
    } else {
      warmWithBudget(4);
    }
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

  let lastInputAt = 0;
  function onInput(e) {
    if (e.target.closest("a, button")) return;
    if (e.cancelable) e.preventDefault();
    const t = typeof e.timeStamp === "number" && e.timeStamp > 0 ? e.timeStamp : performance.now();
    if (J.isDuplicateInput(lastInputAt, t)) return;
    lastInputAt = t;
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
      const oakTile = document.createElement("canvas");
      oakTile.width = 110;
      oakTile.height = 110;
      oakTile.getContext("2d").drawImage(oak, 0, 0, 110, 110);
      oakPat = ctx.createPattern(oakTile, "repeat");
      assets.ready = true;
      invalidateCabCaches();
      if (!prepared) prepareLevel();
      warmUpcoming(true);
      warmPrepared(qcfg().warmStart);
      idleWarm();
    } catch (err) {
      assets.ready = false;
    }
  }

  function onResize() {
    const { W, H } = viewSize();
    if (J.shouldIgnoreResize(state.W, state.H, W, H)) return;
    const yRatio = bird.y / (state.H || 1);
    layout();
    bird.y = yRatio * state.H;
    if (state.mode === "play") warmUpcoming(false);
    else {
      if (!prepared) prepareLevel();
      warmPrepared(qcfg().warmStart);
    }
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onInput, { passive: false });
  window.addEventListener("touchstart", onInput, { passive: false });
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

  window.__hagrobird = () => ({
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
      idx: c.idx,
      cached: !!c.cache,
    })),
    prepared: prepared ? prepared.length : 0,
    quality: state.quality,
    dpr: state.drawDpr,
    simple: !!state.simple,
    canvasW: canvas.width,
    canvasH: canvas.height,
  });

  layout();
  bootUI();
  resetWorld(true);
  prepareLevel();
  loadAssets();
  requestAnimationFrame(frame);
})();
