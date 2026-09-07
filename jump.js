(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HagroJump = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PHYS = {
    gravity: 1680,
    flap: -460,
    vyMax: 820,
  };

  const REACTION = 0.12;
  const SKILL = 0.7;
  const AHEAD = 50;

  const QUALITY = {
    high: {
      dprCap: 2,
      cacheDpr: 1,
      farBg: true,
      particles: 1,
      shake: true,
      simple: false,
      fps: 60,
      maxCache: 8,
      warmStart: 5,
      warmPlay: 1,
      horizonPlay: 640,
      horizonPrep: 1400,
      oak: true,
    },
    mid: {
      dprCap: 2,
      cacheDpr: 1,
      farBg: false,
      particles: 0.35,
      shake: false,
      simple: false,
      fps: 60,
      maxCache: 6,
      warmStart: 3,
      warmPlay: 1,
      horizonPlay: 520,
      horizonPrep: 900,
      oak: true,
    },
    low: {
      dprCap: 2,
      cacheDpr: 1,
      farBg: false,
      particles: 0,
      shake: false,
      simple: true,
      fps: 60,
      maxCache: 5,
      warmStart: 2,
      warmPlay: 1,
      horizonPlay: 420,
      horizonPrep: 600,
      oak: false,
    },
  };

  function qualityConfig(level) {
    return QUALITY[level] || QUALITY.high;
  }

  function pickStartQuality(info) {
    const mem = info && info.deviceMemory;
    const save = !!(info && info.saveData);
    if (save || (mem != null && mem <= 2)) return "low";
    if (mem != null && mem <= 4) return "mid";
    return "high";
  }

  function shouldDowngrade(stats) {
    if (!stats || typeof stats !== "object") return false;
    return stats.median > 19 && stats.p95 > 28;
  }

  function shouldUpgrade(stats) {
    if (!stats || typeof stats !== "object") return false;
    return stats.median < 14 && stats.p95 < 18;
  }

  function nextQuality(cur) {
    if (cur === "high") return "mid";
    if (cur === "mid") return "low";
    return "low";
  }

  function prevQuality(cur) {
    if (cur === "low") return "mid";
    if (cur === "mid") return "high";
    return "high";
  }

  function shouldIgnoreResize(prevW, prevH, nextW, nextH) {
    if (nextW === prevW && nextH === prevH) return true;
    if (nextW === prevW && Math.abs(nextH - prevH) < 120) return true;
    return false;
  }

  function isDuplicateInput(prevTs, nextTs) {
    if (!prevTs) return false;
    return nextTs - prevTs < 12;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function difficulty(score, vu, playH) {
    const t = clamp(score / 18, 0, 1);
    return {
      speed: lerp(188, 275, t) * vu,
      gap: lerp(0.34, 0.24, t) * playH,
      spacing: lerp(248, 210, t) * vu,
    };
  }

  function gapRange(H, ceilH, groundH, playH, gapH) {
    const minCab = Math.max(64, playH * 0.12);
    const lo = ceilH + minCab;
    const hi = H - groundH - minCab - gapH;
    return { minCab, lo, hi };
  }

  function maxClimb(T, vu) {
    const g = PHYS.gravity * vu;
    const flap = PHYS.flap * vu;
    const vmax = PHYS.vyMax * vu;
    let y = 0;
    let vy = 0;
    let minY = 0;
    const dt = 1 / 240;
    for (let t = 0; t < T; t += dt) {
      if (vy >= 0) vy = flap;
      vy = Math.min(vy + g * dt, vmax);
      y += vy * dt;
      if (y < minY) minY = y;
    }
    return -minY;
  }

  function maxFall(T, vu) {
    const g = PHYS.gravity * vu;
    const vmax = PHYS.vyMax * vu;
    let y = 0;
    let vy = 0;
    const dt = 1 / 240;
    for (let t = 0; t < T; t += dt) {
      vy = Math.min(vy + g * dt, vmax);
      y += vy * dt;
    }
    return y;
  }

  function pairTravel(prev, next, opts) {
    const d = difficulty(opts.score, opts.vu, opts.playH);
    const dx = next && prev && next.x != null && prev.x != null ? next.x - prev.x : d.spacing;
    return { T: dx / d.speed, speed: d.speed, spacing: d.spacing };
  }

  function physicallyReachable(prev, next, opts) {
    const r = opts.birdR;
    const { T } = pairTravel(prev, next, opts);
    const climb = maxClimb(T, opts.vu);
    const fall = maxFall(T, opts.vu);
    const prevTop = prev.gapY + r;
    const prevBot = prev.gapY + prev.gapH - r;
    const nextTop = next.gapY + r;
    const nextBot = next.gapY + next.gapH - r;
    const reachTop = prevTop - climb;
    const reachBot = prevBot + fall;
    return reachTop <= nextBot && reachBot >= nextTop;
  }

  function steeredReachable(prev, next, opts) {
    const r = opts.birdR;
    const { T } = pairTravel(prev, next, opts);
    const g = PHYS.gravity * opts.vu;
    const flap = PHYS.flap * opts.vu;
    const vmax = PHYS.vyMax * opts.vu;
    const target = next.gapY + next.gapH * 0.5;
    let y = prev.gapY + prev.gapH * 0.5;
    let vy = 0;
    const dt = 1 / 120;
    for (let t = 0; t < T; t += dt) {
      if (y > target) vy = flap;
      vy = Math.min(vy + g * dt, vmax);
      y += vy * dt;
    }
    return y > next.gapY + r && y < next.gapY + next.gapH - r;
  }

  function humanBudget(score, vu, playH) {
    const d = difficulty(score, vu, playH);
    const T = Math.max(0.2, d.spacing / d.speed - REACTION);
    return {
      climb: maxClimb(T, vu) * SKILL,
      fall: maxFall(T, vu) * SKILL,
    };
  }

  function pickGapY(opts) {
    const { prev, gapH, lo, hi, vu, score, playH, birdY } = opts;
    const rand = opts.rand || Math.random;
    if (lo >= hi) return (lo + hi) / 2;
    if (!prev) {
      if (birdY != null) {
        const jitter = (rand() - 0.5) * Math.min(48, gapH * 0.2);
        return clamp(birdY - gapH * 0.5 + jitter, lo, hi);
      }
      return lo + rand() * (hi - lo);
    }
    const { climb, fall } = humanBudget(score, vu, playH);
    const prevCenter = prev.gapY + prev.gapH * 0.5;
    const minC = Math.max(lo + gapH * 0.5, prevCenter - climb);
    const maxC = Math.min(hi + gapH * 0.5, prevCenter + fall);
    const center = minC >= maxC ? (minC + maxC) / 2 : minC + rand() * (maxC - minC);
    return clamp(center - gapH * 0.5, lo, hi);
  }

  function makeCabinet(opts) {
    const rand = opts.rand || Math.random;
    const d = difficulty(opts.score, opts.vu, opts.playH);
    const range = gapRange(opts.H, opts.ceilH, opts.groundH, opts.playH, d.gap);
    const gapY = pickGapY({
      prev: opts.prev,
      gapH: d.gap,
      lo: range.lo,
      hi: range.hi,
      vu: opts.vu,
      score: opts.score,
      playH: opts.playH,
      rand,
      birdY: opts.prev ? undefined : opts.birdY,
    });
    const roll = rand();
    const variant = roll < 0.42 ? "white" : roll < 0.78 ? "wood" : "anthra";
    const kind = rand() < 0.2 ? "frame" : "solid";
    return {
      x: opts.x,
      w: opts.cabW,
      gapY,
      gapH: d.gap,
      variant,
      kind,
      scored: false,
      idx: opts.score,
    };
  }

  function buildCabinets(opts) {
    const count = opts.count == null ? AHEAD : opts.count;
    const cabs = [];
    let x = opts.startX;
    let prev = null;
    for (let i = 0; i < count; i++) {
      const cab = makeCabinet(Object.assign({}, opts, { x, prev, score: i }));
      cabs.push(cab);
      prev = cab;
      x += difficulty(i, opts.vu, opts.playH).spacing;
    }
    return cabs;
  }

  return {
    PHYS,
    AHEAD,
    QUALITY,
    qualityConfig,
    pickStartQuality,
    shouldDowngrade,
    shouldUpgrade,
    nextQuality,
    prevQuality,
    shouldIgnoreResize,
    isDuplicateInput,
    clamp,
    lerp,
    difficulty,
    gapRange,
    maxClimb,
    maxFall,
    physicallyReachable,
    steeredReachable,
    humanBudget,
    pickGapY,
    makeCabinet,
    buildCabinets,
  };
});
