"use strict";

const assert = require("assert");
const J = require("./jump.js");

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

test("low-memory and save-data phones start on low quality", () => {
  assert.equal(J.pickStartQuality({ deviceMemory: 2 }), "low");
  assert.equal(J.pickStartQuality({ saveData: true }), "low");
  assert.equal(J.pickStartQuality({ deviceMemory: 4 }), "mid");
  assert.equal(J.pickStartQuality({ deviceMemory: 8 }), "high");
  assert.equal(J.pickStartQuality({}), "high");
});

test("frame-time p95 above 26ms drops one quality step", () => {
  assert.equal(J.shouldDowngrade(16.7), false);
  assert.equal(J.shouldDowngrade(27), true);
  assert.equal(J.nextQuality("high"), "mid");
  assert.equal(J.nextQuality("mid"), "low");
  assert.equal(J.nextQuality("low"), "low");
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

test("low quality uses 1x pixels and 30fps", () => {
  const low = J.qualityConfig("low");
  const high = J.qualityConfig("high");
  assert.ok(low.dprCap <= 1);
  assert.equal(low.fps, 30);
  assert.equal(low.simple, true);
  assert.ok(low.maxCache < high.maxCache);
  assert.ok(high.dprCap >= 1.5);
  assert.equal(high.fps, 60);
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

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall tests passed");
