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
  // Avoid desynchronized 2D contexts: on several Android Chrome/WebView GPUs the
  // canvas presents as a black/frozen surface even though iOS draws fine.
  const ctx = canvas.getContext("2d", { alpha: false });
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
  let course = null;
  let courseAt = 0;
  let scene = null;
  const canvasPool = [];
  const bitPool = [];
  const CACHE_PAD = 22;
  let lastDrawMs = 0;
  let lastFps = 0;
  let fpsFrames = 0;
  let fpsStamp = 0;

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
    return J.viewSizeFrom(window);
  }

  function qcfg() {
    return J.qualityConfig(state.quality);
  }

  function layout() {
    const q = qcfg();
    const { W, H } = viewSize();
    const dpr = J.backingDpr(W, H, window.devicePixelRatio || 1, q.dprCap, J.PIXEL_BUDGET);
    const pixelW = Math.round(W * dpr);
    const pixelH = Math.round(H * dpr);
    const sameSize =
      canvas.width === pixelW &&
      canvas.height === pixelH &&
      state.W === W &&
      state.H === H &&
      state.drawDpr === dpr;
    state.drawDpr = dpr;
    state.cacheDpr = dpr;
    state.simple = q.simple;
    ctx.imageSmoothingEnabled = false;
    if (sameSize) return;
    canvas.width = pixelW;
    canvas.height = pixelH;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
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
    scene = null;
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

  function spawnY() {
    if (state.ceilH && state.playH) return state.ceilH + state.playH * 0.45;
    return state.H * 0.42;
  }

  function resetBird() {
    bird.y = spawnY();
    bird.vy = 0;
    bird.frame = 1;
    bird.wingT = 0;
    state.score = 0;
    state.bgX = 0;
    state.shake = 0;
    state.flash = 0;
    scoreEl.textContent = "0";
  }

  function recycleCanvas(c) {
    if (!c) return;
    if (canvasPool.length < 24) canvasPool.push(c);
  }

  function releaseCab(cab) {
    if (!cab) return;
    if (cab.cache) {
      recycleCanvas(cab.cache.top);
      recycleCanvas(cab.cache.bot);
      cab.cache = null;
    }
  }

  function clearCabs() {
    for (let i = 0; i < cabs.length; i++) releaseCab(cabs[i]);
    cabs.length = 0;
  }

  function recyclePassed() {
    while (cabs.length && cabs[0].x + cabs[0].w < -48) {
      releaseCab(cabs.shift());
    }
  }

  function ensureLive() {
    const opts = Object.assign(layoutOpts(), { startX: state.W + 36, liveCount: J.LIVE });
    const before = cabs.length;
    courseAt = J.fillLiveCabinets(cabs, course, courseAt, opts);
    // Course items keep generation-time x. fillLiveCabinets rebases each
    // activation onto the current last live x so the next column is already
    // approaching when an earlier one leaves.
    if (cabs.length > before) {
      for (let i = before; i < cabs.length; i++) cabs[i].w = state.cabW;
    }
  }

  function resetWorld() {
    clearCabs();
    while (bits.length) bitPool.push(bits.pop());
    course = null;
    courseAt = 0;
    resetBird();
  }

  function startGame() {
    while (bits.length) bitPool.push(bits.pop());
    overlay.classList.add("is-off");
    hud.classList.add("is-on");
    const prevW = state.W;
    const prevH = state.H;
    layout();
    if (!prepared || prepared.length < J.AHEAD || state.W !== prevW || state.H !== prevH) {
      prepareLevel();
    }
    course = prepared;
    courseAt = 0;
    prepared = null;
    clearCabs();
    ensureLive();
    resetBird();
    bird.y = spawnY();
    bird.vy = -400 * state.vu;
    state.mode = "play";
    state.spawnUntil = performance.now() + 250;
    sfx.flap();
    puff(bird.x - 8, bird.y + 10, 6, PAL.white);
    state.qualityGraceUntil = performance.now() + 1800;
    state.badWindows = 0;
    frameSamples.length = 0;
    warmFirst(cabs, 1);
  }
