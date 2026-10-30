import { describe, expect, it } from "vitest";

import type { SensorSample } from "./detect";
import { createFireDebouncer } from "./fire";
import { createOrientationFilter, createRolloverDetector } from "./orientation";
import { generateTrace } from "./traces";

const rest = (over: Partial<SensorSample> = {}): SensorSample => ({
  tMs: 0, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, smoke: 0, flame: false, ...over,
});

/** Runs a whole trace through the filter, returning the angles at each sample. */
function angles(samples: SensorSample[]) {
  const filter = createOrientationFilter();
  return samples.map((s, i) => ({ tMs: s.tMs, ...filter.update(s, i === 0 ? 0.001 : (s.tMs - samples[i - 1]!.tMs) / 1000) }));
}

describe("orientation filter (complementary: gyro for the short term, gravity for the long term)", () => {
  it("reads zero when the car is level", () => {
    const filter = createOrientationFilter();
    let last = { rollDeg: 99, pitchDeg: 99 };
    for (let i = 0; i < 500; i++) last = filter.update(rest({ tMs: i }), 0.001);
    expect(last.rollDeg).toBeCloseTo(0, 1);
    expect(last.pitchDeg).toBeCloseTo(0, 1);
  });

  it("settles on the tilt gravity shows, when the car is tipped and still", () => {
    const filter = createOrientationFilter();
    filter.update(rest(), 0.001);
    const tilt = (30 * Math.PI) / 180;
    let last = { rollDeg: 0, pitchDeg: 0 };
    for (let i = 0; i < 2000; i++) last = filter.update(rest({ tMs: i, ay: Math.sin(tilt), az: Math.cos(tilt) }), 0.001);
    expect(last.rollDeg).toBeGreaterThan(29);
    expect(last.rollDeg).toBeLessThan(31);
    expect(last.pitchDeg).toBeCloseTo(0, 0);
  });

  it("follows the car all the way over in the rollover trace, ending upside down", () => {
    const track = angles(generateTrace("rollover", { seed: 1 }).samples);
    const end = track.at(-1)!;
    expect(Math.abs(end.rollDeg)).toBeGreaterThan(170);
    // Past the half-way point it never slips back towards level: no glitch where the angle wraps at 180.
    const afterTurn = track.filter((p) => p.tMs > 3200);
    expect(Math.min(...afterTurn.map((p) => Math.abs(p.rollDeg)))).toBeGreaterThan(170);
  });

  it("is not fooled by the crash itself: a 30 g spike does not look like the car tipping", () => {
    const track = angles(generateTrace("frontal_40", { seed: 2 }).samples);
    expect(Math.max(...track.map((p) => Math.abs(p.pitchDeg)))).toBeLessThan(10);
    expect(Math.max(...track.map((p) => Math.abs(p.rollDeg)))).toBeLessThan(10);
  });
});

describe("rollover detector: |roll| or |pitch| above 90 degrees held for 2 s (PRD `rollover`)", () => {
  /** Feeds a constant angle for `ms` and returns the last answer. */
  function hold(detector: ReturnType<typeof createRolloverDetector>, rollDeg: number, pitchDeg: number, fromMs: number, ms: number) {
    let last = detector.update({ rollDeg, pitchDeg }, fromMs);
    for (let t = fromMs + 1; t <= fromMs + ms; t++) last = detector.update({ rollDeg, pitchDeg }, t);
    return last;
  }

  it("fires after 2 s, not after 1.9 s", () => {
    expect(hold(createRolloverDetector(), 120, 0, 0, 1900).rollover).toBe(false);
    expect(hold(createRolloverDetector(), 120, 0, 0, 2000).rollover).toBe(true);
  });

  it("counts a pitch as well as a roll, and either side", () => {
    expect(hold(createRolloverDetector(), 0, 100, 0, 2000).rollover).toBe(true);
    expect(hold(createRolloverDetector(), -110, 0, 0, 2000).rollover).toBe(true);
    expect(hold(createRolloverDetector(), 0, -95, 0, 2000).rollover).toBe(true);
  });

  it("needs MORE than 90 degrees", () => {
    expect(hold(createRolloverDetector(), 90, 0, 0, 5000).rollover).toBe(false);
    expect(hold(createRolloverDetector(), 91, 0, 0, 2000).rollover).toBe(true);
  });

  it("starts the count again when the car comes back below 90 degrees", () => {
    const detector = createRolloverDetector();
    hold(detector, 120, 0, 0, 1500);
    detector.update({ rollDeg: 20, pitchDeg: 0 }, 1501);
    expect(hold(detector, 120, 0, 1502, 1500).rollover).toBe(false);
    expect(hold(detector, 120, 0, 3003, 600).rollover).toBe(true);
  });

  it("says since when, once it has fired", () => {
    const detector = createRolloverDetector();
    const answer = hold(detector, 150, 0, 1000, 2500);
    expect(answer.rollover).toBe(true);
    expect(answer.sinceMs).toBe(1000);
  });

  it("fires on the rollover trace about two seconds after the car passes 90 degrees, and on no other trace", () => {
    const fires = (name: "frontal_40" | "rollover" | "fire_parked" | "pothole") => {
      const detector = createRolloverDetector();
      return angles(generateTrace(name, { seed: 1 }).samples)
        .map((p) => ({ tMs: p.tMs, ...detector.update(p, p.tMs) }))
        .find((p) => p.rollover);
    };
    const hit = fires("rollover");
    expect(hit).toBeDefined();
    // The car passes 90 degrees at 1750 ms; 2 s later is 3750 ms.
    expect(hit!.tMs).toBeGreaterThan(3600);
    expect(hit!.tMs).toBeLessThan(4000);
    expect(fires("frontal_40")).toBeUndefined();
    expect(fires("fire_parked")).toBeUndefined();
    expect(fires("pothole")).toBeUndefined();
  });
});

describe("fire debouncer: smoke above the baseline and flame, held for 3 s", () => {
  const burning = rest({ smoke: 0.8, flame: true });
  function hold(debouncer: ReturnType<typeof createFireDebouncer>, sample: SensorSample, fromMs: number, ms: number) {
    let last = false;
    for (let t = fromMs; t <= fromMs + ms; t++) last = debouncer.update({ ...sample, tMs: t });
    return last;
  }

  it("fires after 3 s, not after 2.9 s", () => {
    expect(hold(createFireDebouncer(), burning, 0, 2900)).toBe(false);
    expect(hold(createFireDebouncer(), burning, 0, 3000)).toBe(true);
  });

  it("needs both: flame alone, or smoke alone, is not a fire", () => {
    expect(hold(createFireDebouncer(), rest({ smoke: 0.1, flame: true }), 0, 5000)).toBe(false);
    expect(hold(createFireDebouncer(), rest({ smoke: 0.9, flame: false }), 0, 5000)).toBe(false);
  });

  it("needs MORE smoke than the threshold", () => {
    expect(hold(createFireDebouncer(), rest({ smoke: 0.5, flame: true }), 0, 5000)).toBe(false);
    expect(hold(createFireDebouncer(), rest({ smoke: 0.51, flame: true }), 0, 3000)).toBe(true);
  });

  it("forgets a flicker: the 3 s start again after the flame goes out", () => {
    const debouncer = createFireDebouncer();
    hold(debouncer, burning, 0, 2500);
    debouncer.update({ ...rest({ smoke: 0.8, flame: false }), tMs: 2501 });
    expect(hold(debouncer, burning, 2502, 2500)).toBe(false);
    expect(hold(debouncer, burning, 5003, 600)).toBe(true);
  });

  it("fires on the parked-fire trace about 3 s after smoke and flame are both there, and on no other trace", () => {
    const firstFire = (name: "frontal_40" | "rollover" | "fire_parked" | "pothole") => {
      const debouncer = createFireDebouncer();
      return generateTrace(name, { seed: 1 }).samples.find((s) => debouncer.update(s))?.tMs;
    };
    // Flame from 1000 ms; smoke passes 0.5 at about 2667 ms; so both hold from ~2670 ms, and 3 s later is ~5670 ms.
    const hit = firstFire("fire_parked");
    expect(hit).toBeGreaterThan(5500);
    expect(hit).toBeLessThan(5900);
    expect(firstFire("frontal_40")).toBeUndefined();
    expect(firstFire("rollover")).toBeUndefined();
    expect(firstFire("pothole")).toBeUndefined();
  });
});
