import { describe, expect, it } from "vitest";

import { detectPulses, type SensorSample } from "./detect";
import { createRng } from "./rng";
import { customTrace, generateTrace, TRACE_LABEL, type TraceName } from "./traces";

const NAMES: TraceName[] = ["frontal_40", "rollover", "fire_parked", "pothole"];

/** Roll angle reached at the end, from the gyro alone (degrees). */
const finalRoll = (samples: SensorSample[]) => samples.reduce((sum, s, i) => sum + (i === 0 ? 0 : s.gx * ((s.tMs - samples[i - 1]!.tMs) / 1000)), 0);

describe("createRng: the seeded source every simulation uses", () => {
  it("gives the same sequence for the same seed, and another for another seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(first);
  });

  it("stays in [0, 1) and spreads out", () => {
    const rng = createRng(7);
    const values = Array.from({ length: 2000 }, () => rng.next());
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("can give a number in a range", () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const v = rng.between(25, 35);
      expect(v).toBeGreaterThanOrEqual(25);
      expect(v).toBeLessThan(35);
    }
  });
});

describe("synthetic traces (PRD FR-S8-04)", () => {
  it.each(NAMES)("%s is always labelled TRACE SYNTHÉTIQUE", (name) => {
    const trace = generateTrace(name, { seed: 1 });
    expect(trace.label).toBe("TRACE SYNTHÉTIQUE");
    expect(TRACE_LABEL).toBe("TRACE SYNTHÉTIQUE");
    expect(trace.name).toBe(name);
  });

  it.each(NAMES)("%s is the same for the same seed and different for another", (name) => {
    const a = generateTrace(name, { seed: 5 }).samples;
    expect(generateTrace(name, { seed: 5 }).samples).toEqual(a);
    expect(generateTrace(name, { seed: 6 }).samples).not.toEqual(a);
  });

  it.each(NAMES)("%s is sampled at 1 kHz by default, over a few seconds, in time order", (name) => {
    const { samples, sampleRateHz } = generateTrace(name, { seed: 1 });
    expect(sampleRateHz).toBe(1000);
    expect(samples[1]!.tMs - samples[0]!.tMs).toBe(1);
    expect(samples.at(-1)!.tMs).toBeGreaterThan(2000);
    expect(samples.every((s, i) => i === 0 || s.tMs > samples[i - 1]!.tMs)).toBe(true);
  });

  it("starts every trace at rest: about 1 g of gravity and no flame", () => {
    for (const name of NAMES) {
      const rest = generateTrace(name, { seed: 3 }).samples.slice(0, 200);
      const magnitudes = rest.map((s) => Math.hypot(s.ax, s.ay, s.az));
      expect(Math.max(...magnitudes)).toBeLessThan(1.2);
      expect(Math.min(...magnitudes)).toBeGreaterThan(0.8);
      expect(rest.some((s) => s.flame)).toBe(false);
    }
  });

  it("frontal_40: one crash pulse of 25-35 g over 80-120 ms", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const trace = generateTrace("frontal_40", { seed });
      const { peakG, durationMs } = trace.meta;
      expect(peakG).toBeGreaterThanOrEqual(25);
      expect(peakG).toBeLessThanOrEqual(35);
      expect(durationMs).toBeGreaterThanOrEqual(80);
      expect(durationMs).toBeLessThanOrEqual(120);

      const { pulses, rejected } = detectPulses(trace.samples);
      expect(rejected).toEqual([]);
      expect(pulses).toHaveLength(1);
      expect(pulses[0]!.peakG).toBeGreaterThan(peakG * 0.95);
      expect(pulses[0]!.peakG).toBeLessThan(peakG * 1.1);
      // The part of the half-sine above 6 g is most of it.
      expect(pulses[0]!.durationMs).toBeGreaterThan(durationMs * 0.75);
      expect(pulses[0]!.durationMs).toBeLessThanOrEqual(durationMs);
    }
  });

  it("frontal_40: the Delta-V matches a half-sine pulse (2/pi x peak x duration)", () => {
    const trace = generateTrace("frontal_40", { seed: 4 });
    const expectedKmh = (2 / Math.PI) * trace.meta.peakG * 9.80665 * (trace.meta.durationMs / 1000) * 3.6;
    const [pulse] = detectPulses(trace.samples).pulses;
    // Gravity and the part under 6 g shift it a little: within 15 %.
    expect(pulse!.deltaVKmh).toBeGreaterThan(expectedKmh * 0.85);
    expect(pulse!.deltaVKmh).toBeLessThan(expectedKmh * 1.15);
  });

  it("pothole: 9 g for 1 ms, rejected as too short", () => {
    const { pulses, rejected } = detectPulses(generateTrace("pothole", { seed: 1 }).samples);
    expect(pulses).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe("filtré : durée < 3 ms");
    expect(rejected[0]!.durationMs).toBe(1);
    expect(rejected[0]!.peakG).toBeGreaterThan(9);
    expect(rejected[0]!.peakG).toBeLessThan(10.5);
  });

  it("rollover: turns the car over without any crash spike, ending upside down", () => {
    const { samples, meta } = generateTrace("rollover", { seed: 1 });
    expect(detectPulses(samples).pulses).toEqual([]);
    expect(Math.abs(finalRoll(samples))).toBeGreaterThan(170);
    expect(Math.abs(finalRoll(samples))).toBeLessThan(190);
    expect(meta.rollDeg).toBeGreaterThanOrEqual(170);
    // Upside down, gravity points the other way along z.
    const last = samples.slice(-200);
    expect(last.reduce((sum, s) => sum + s.az, 0) / last.length).toBeLessThan(-0.8);
  });

  it("fire_parked: no impact, smoke rising, flame held for several seconds", () => {
    const { samples } = generateTrace("fire_parked", { seed: 1 });
    expect(detectPulses(samples).pulses).toEqual([]);
    expect(Math.max(...samples.map((s) => s.smoke))).toBeGreaterThan(0.5);
    const flameMs = samples.filter((s) => s.flame).length; // 1 ms a sample
    expect(flameMs).toBeGreaterThan(4000);
  });
});

describe("customTrace: the jury's own impact (PRD FR-S8-05)", () => {
  it("makes a pulse of the asked peak and duration", () => {
    const trace = customTrace({ peakG: 40, durationMs: 60, rollDeg: 0, fire: false }, { seed: 1 });
    const { pulses } = detectPulses(trace.samples);
    expect(pulses).toHaveLength(1);
    expect(pulses[0]!.peakG).toBeGreaterThan(38);
    expect(pulses[0]!.peakG).toBeLessThan(44);
    expect(pulses[0]!.durationMs).toBeGreaterThan(60 * 0.7);
    expect(trace.label).toBe("TRACE SYNTHÉTIQUE");
  });

  it("makes a short pulse that gets filtered, like a pothole", () => {
    const trace = customTrace({ peakG: 50, durationMs: 2, rollDeg: 0, fire: false }, { seed: 1 });
    expect(detectPulses(trace.samples).pulses).toEqual([]);
    expect(detectPulses(trace.samples).rejected).toHaveLength(1);
  });

  it("turns the car by the asked angle", () => {
    const trace = customTrace({ peakG: 0, durationMs: 0, rollDeg: 120, fire: false }, { seed: 1 });
    expect(finalRoll(trace.samples)).toBeGreaterThan(115);
    expect(finalRoll(trace.samples)).toBeLessThan(125);
    expect(customTrace({ peakG: 0, durationMs: 0, rollDeg: 0, fire: false }, { seed: 1 }).samples.every((s) => Math.abs(s.gx) < 1)).toBe(true);
  });

  it("starts a fire only when asked", () => {
    expect(customTrace({ peakG: 0, durationMs: 0, rollDeg: 0, fire: true }, { seed: 1 }).samples.some((s) => s.flame)).toBe(true);
    expect(customTrace({ peakG: 0, durationMs: 0, rollDeg: 0, fire: false }, { seed: 1 }).samples.some((s) => s.flame)).toBe(false);
  });

  it("clamps at what the sensor can read, and the pulse is flagged saturated", () => {
    const trace = customTrace({ peakG: 400, durationMs: 40, rollDeg: 0, fire: false }, { seed: 1 });
    expect(Math.max(...trace.samples.map((s) => Math.abs(s.ax)))).toBeLessThanOrEqual(200);
    const [pulse] = detectPulses(trace.samples).pulses;
    expect(pulse!.saturated).toBe(true);
    expect(pulse!.peakG).toBeGreaterThanOrEqual(200);
  });

  it("has no pulse at all when no peak is asked for", () => {
    const trace = customTrace({ peakG: 0, durationMs: 0, rollDeg: 0, fire: false }, { seed: 1 });
    expect(detectPulses(trace.samples)).toEqual({ pulses: [], rejected: [] });
  });
});
