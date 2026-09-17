"use strict";

const assert = require("assert");
const J = require("./public/jump.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error("    ", err.message);
  }
}

const layout = {
  vu: 1,
  W: 390,
  H: 844,
  ceilH: 20,
  groundH: 48,
  playH: 776,
  cabW: 62,
  birdY: 355,
  birdR: 13.4,
};

test("prebuilds 50 cabinets", () => {
  assert.equal(J.AHEAD, 50);
});

test("live world stays small so passed cabinets can despawn", () => {
  assert.equal(J.LIVE, 8);
  assert.ok(J.LIVE < J.AHEAD);
});

test("phone canvas stays 2x; large desktop backing store is pixel-capped", () => {
  assert.equal(J.backingDpr(390, 844, 3, 2), 2);
  assert.equal(J.backingDpr(430, 932, 3, 2), 2);
  const mac = J.backingDpr(1512, 982, 2, 2);
  assert.ok(mac <= 1.5, "mac dpr " + mac);
  assert.ok(mac >= 1, "mac dpr " + mac);
  assert.equal(J.backingDpr(1512, 982, 2, 2), J.backingDpr(1512, 982, 2, J.qualityConfig("low").dprCap));
});

test("low-memory and save-data phones start on low quality", () => {
  assert.equal(J.pickStartQuality({ deviceMemory: 2 }), "low");
  assert.equal(J.pickStartQuality({ saveData: true }), "low");
  assert.equal(J.pickStartQuality({ deviceMemory: 4 }), "mid");
  assert.equal(J.pickStartQuality({ deviceMemory: 8 }), "high");
  assert.equal(J.pickStartQuality({}), "high");
});

test("brief spikes do not drop quality, sustained 50fps does", () => {
  assert.equal(J.shouldDowngrade({ median: 16.7, p95: 27 }), false);
  assert.equal(J.shouldDowngrade({ median: 16.7, p95: 16.8 }), false);
  assert.equal(J.shouldDowngrade({ median: 21, p95: 30 }), true);
  assert.equal(J.shouldUpgrade({ median: 12, p95: 16 }), true);
  assert.equal(J.shouldUpgrade({ median: 17, p95: 20 }), false);
  assert.equal(J.nextQuality("high"), "mid");
  assert.equal(J.prevQuality("low"), "mid");
});

test("tiny mobile viewport height jitter is ignored so a tap does not relayout", () => {
  assert.equal(J.shouldIgnoreResize(390, 844, 390, 844), true);
  assert.equal(J.shouldIgnoreResize(390, 844, 390, 780), true);
  assert.equal(J.shouldIgnoreResize(390, 844, 390, 844 - 80), true);
  assert.equal(J.shouldIgnoreResize(390, 844, 844, 390), false);
  assert.equal(J.shouldIgnoreResize(390, 844, 390, 500), false);
});

test("pointerdown and touchstart of the same tap are treated as one input", () => {
  assert.equal(J.isDuplicateInput(0, 100), false);
  assert.equal(J.isDuplicateInput(100, 100), true);
  assert.equal(J.isDuplicateInput(100, 108), true);
  assert.equal(J.isDuplicateInput(100, 140), false);
});

test("login overlay ignores space/flap until a named account or the guest button", () => {
  assert.equal(J.canStartFromPlayInput({ overlayOn: true, mode: "start", loggedIn: false }), false);
  assert.equal(J.canStartFromPlayInput({ overlayOn: true, mode: "start", loggedIn: true }), true);
  assert.equal(J.canStartFromPlayInput({ overlayOn: true, mode: "dead", loggedIn: false }), true);
  assert.equal(J.canStartFromPlayInput({ overlayOn: false, mode: "play", loggedIn: false }), true);
  assert.equal(J.canStartFromPlayInput({ overlayOn: false, mode: "start", loggedIn: false }), true);
});

test("Android text-node taps do not crash UI hit-testing", () => {
  const btn = {
    nodeType: 1,
    closest: (sel) => (sel.includes("button") ? btn : null),
  };
  const text = { nodeType: 3, parentElement: btn };
  assert.equal(J.isUiControl(btn), true);
  assert.equal(J.isUiControl(text), true);
  assert.equal(J.isUiControl({ nodeType: 3, parentElement: null }), false);
  assert.equal(J.eventElement(text), btn);
});

test("pointer-capable browsers skip the extra touchstart listener", () => {
  assert.equal(J.prefersPointerEvents({ PointerEvent: function PointerEvent() {} }), true);
  assert.equal(J.prefersPointerEvents({}), false);
});

test("view size prefers visualViewport so Android Chrome chrome is included", () => {
  const size = J.viewSizeFrom({
    visualViewport: { width: 360.4, height: 640.6 },
    innerWidth: 412,
    innerHeight: 915,
  });
  assert.equal(size.W, 360);
  assert.equal(size.H, 641);
});

test("all quality levels stay at 60fps and the same canvas resolution", () => {
  const low = J.qualityConfig("low");
  const mid = J.qualityConfig("mid");
  const high = J.qualityConfig("high");
  assert.equal(high.fps, 60);
  assert.equal(mid.fps, 60);
  assert.equal(low.fps, 60);
  assert.equal(mid.dprCap, high.dprCap);
  assert.equal(low.dprCap, high.dprCap);
  assert.equal(low.simple, true);
  assert.equal(high.simple, false);
});

test("difficulty ramps speed up and gap/spacing down", () => {
  const a = J.difficulty(0, 1, 776);
  const b = J.difficulty(18, 1, 776);
  assert.ok(b.speed > a.speed);
  assert.ok(b.gap < a.gap);
  assert.ok(b.spacing < a.spacing);
  assert.ok(Math.abs(a.speed - 188) < 0.01);
  assert.ok(Math.abs(b.speed - 275) < 0.01);
});

test("buildCabinets returns 50 cabinets starting at startX", () => {
  const cabs = J.buildCabinets({ count: 50, startX: 426, ...layout });
  assert.equal(cabs.length, 50);
  assert.equal(cabs[0].x, 426);
  assert.ok(cabs[1].x > cabs[0].x);
  assert.equal(cabs[49].scored, false);
});

test("every gap stays inside the playable column bounds", () => {
  const cabs = J.buildCabinets({ count: 50, startX: 400, ...layout, rand: Math.random });
  for (const cab of cabs) {
    const range = J.gapRange(layout.H, layout.ceilH, layout.groundH, layout.playH, cab.gapH);
    assert.ok(cab.gapY >= range.lo - 0.001, `gapY ${cab.gapY} < lo ${range.lo}`);
    assert.ok(cab.gapY <= range.hi + 0.001, `gapY ${cab.gapY} > hi ${range.hi}`);
    assert.ok(cab.gapH > 100);
  }
});

test("unconstrained random gaps are sometimes physically impossible", () => {
  const d = J.difficulty(18, 1, 776);
  const range = J.gapRange(layout.H, layout.ceilH, layout.groundH, layout.playH, d.gap);
  let impossible = 0;
  for (let i = 0; i < 400; i++) {
    const prev = { gapY: range.lo, gapH: d.gap };
    const next = { gapY: range.hi, gapH: d.gap };
    if (i % 2 === 0) {
      prev.gapY = range.hi;
      next.gapY = range.lo;
    }
    if (!J.physicallyReachable(prev, next, { score: 18, ...layout })) impossible += 1;
  }
  assert.ok(impossible > 0, "expected the old min/max random pairing to be unreachable");
});

test("jumps stay reachable if the whole field later uses max speed", () => {
  const cabs = J.buildCabinets({ count: 50, startX: 400, ...layout });
  for (const score of [0, 9, 18, 40]) {
    for (let i = 1; i < cabs.length; i++) {
      const ok = J.physicallyReachable(cabs[i - 1], cabs[i], { score, ...layout });
      assert.ok(ok, `score ${score} cab ${i}`);
    }
  }
});

test("generated sequences stay physically reachable (perfect play)", () => {
  const rands = [() => 0, () => 1, () => 0.5, () => 0.2, () => 0.8];
  for (let n = 0; n < 8; n++) rands.push(Math.random);
  for (const rand of rands) {
    const cabs = J.buildCabinets({ count: 50, startX: 400, ...layout, rand });
    for (let i = 1; i < cabs.length; i++) {
      const ok = J.physicallyReachable(cabs[i - 1], cabs[i], { score: i, ...layout });
      assert.ok(ok, `physically unreachable jump at cabinet ${i}`);
    }
  }
});

test("a simple aiming bird can thread every generated jump", () => {
  for (let n = 0; n < 20; n++) {
    const cabs = J.buildCabinets({ count: 50, startX: 400, ...layout });
    for (let i = 1; i < cabs.length; i++) {
      const ok = J.steeredReachable(cabs[i - 1], cabs[i], { score: i, ...layout });
      assert.ok(ok, `aiming bird missed cabinet ${i} on run ${n}`);
    }
  }
});

test("first gap opens near the bird so the opening is reachable", () => {
  const cabs = J.buildCabinets({ count: 1, startX: 400, ...layout, rand: () => 0.5 });
  const y = layout.birdY;
  const cab = cabs[0];
  assert.ok(y > cab.gapY && y < cab.gapY + cab.gapH);
});

test("later cabinets use the harder (smaller) gap", () => {
  const cabs = J.buildCabinets({ count: 50, startX: 400, ...layout, rand: () => 0.5 });
  assert.ok(cabs[0].gapH > cabs[18].gapH);
  assert.equal(cabs[18].gapH, cabs[40].gapH);
});

test("activating a course cabinet rebases x onto the live last", () => {
  const course = J.buildCabinets({ count: 12, startX: 426, ...layout });
  const stale = course[8];
  assert.ok(stale.x > 2000, "course item 8 still has generation-time x");
  const last = { x: 80, idx: 7, w: 62 };
  J.placeNextCabinet(stale, last, { startX: 426, ...layout });
  const expected = last.x + J.spacingAfter(last, layout.vu, layout.playH);
  assert.ok(Math.abs(stale.x - expected) < 0.01);
});

test("recycled live window stays continuous past 8 cabinets", () => {
  const course = J.buildCabinets({ count: 50, startX: 426, ...layout });
  const live = [];
  let at = J.fillLiveCabinets(live, course, 0, { startX: 426, liveCount: 8, ...layout });
  assert.equal(live.length, 8);
  let passed = 0;
  for (let step = 0; step < 400; step++) {
    for (let i = 0; i < live.length; i++) live[i].x -= 40;
    passed += J.recyclePassedCabinets(live, -48);
    at = J.fillLiveCabinets(live, course, at, { startX: 426, liveCount: 8, ...layout });
    assert.equal(live.length, 8, "live window stays full");
    const last = live[live.length - 1];
    for (let i = 1; i < live.length; i++) {
      const gap = live[i].x - live[i - 1].x;
      const allowed = J.spacingAfter(live[i - 1], layout.vu, layout.playH) + 0.5;
      assert.ok(gap <= allowed, `empty wave gap ${gap} > ${allowed} at ${i} after ${passed} passed`);
    }
    assert.ok(J.maxLiveGap(live) < 400, "no screen-wide hole after a live batch");
    assert.ok(last.x > 200, "next cabinet already approaching from the right");
    if (passed >= 24) break;
  }
  assert.ok(passed >= 24, `only passed ${passed}`);
  assert.ok(at > 8, "course advanced past the first live batch");
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall tests passed");
