import { describe, expect, it } from "vitest";

import { detectPulses, summarizeImpacts, type SensorSample } from "./detect";

/** Samples at `rateHz`: 1 g of gravity on z, with `blocks` of constant acceleration along x laid over it. */
function samples(
  blocks: { atMs: number; durationMs: number; g: number; axis?: "ax" | "ay" }[],
  { rateHz = 1000, totalMs = 2000 }: { rateHz?: number; totalMs?: number } = {},
): SensorSample[] {
  const step = 1000 / rateHz;
  const out: SensorSample[] = [];
  for (let t = 0; t < totalMs; t += step) {
    const sample: SensorSample = { tMs: t, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, smoke: 0, flame: false };
    for (const block of blocks) {
      if (t >= block.atMs && t < block.atMs + block.durationMs) sample[block.axis ?? "ax"] += block.g;
    }
    out.push(sample);
  }
  return out;
}

describe("detectPulses: |a| above 6 g for at least 3 ms (PRD chip_trigger)", () => {
  it("finds one pulse and measures its peak, duration and Delta-V", () => {
    const { pulses, rejected } = detectPulses(samples([{ atMs: 500, durationMs: 100, g: 30 }]));
    expect(rejected).toEqual([]);
    expect(pulses).toHaveLength(1);
    const [pulse] = pulses;
    expect(pulse!.durationMs).toBe(100);
    expect(pulse!.peakG).toBeCloseTo(30.017, 2); // 30 g along x on top of 1 g of gravity on z
    expect(pulse!.startMs).toBe(500);
    // Delta-V = integral of a dt: ~30 g x 9.80665 m/s2 x 0.1 s = 29.42 m/s = 105.9 km/h (the 1 g of gravity adds a little).
    expect(pulse!.deltaVKmh).toBeGreaterThan(105.8);
    expect(pulse!.deltaVKmh).toBeLessThan(106.2);
    expect(pulse!.saturated).toBe(false);
  });

  it("measures the acceleration along all three axes, not just one", () => {
    const { pulses } = detectPulses(
      samples([
        { atMs: 100, durationMs: 20, g: 6, axis: "ax" },
        { atMs: 100, durationMs: 20, g: 8, axis: "ay" },
      ]),
    );
    // sqrt(6^2 + 8^2 + 1^2) = 10.05 g: above the threshold only because the axes add up.
    expect(pulses).toHaveLength(1);
    expect(pulses[0]!.peakG).toBeCloseTo(Math.sqrt(101), 3);
  });

  it("ignores gravity and ordinary driving", () => {
    expect(detectPulses(samples([{ atMs: 0, durationMs: 2000, g: 0.8 }]))).toEqual({ pulses: [], rejected: [] });
  });

  it("needs MORE than 6 g, not 6 g", () => {
    // sqrt(5.9^2 + 1) = 5.98 g is under; sqrt(6.01^2 + 1) = 6.09 g is over.
    expect(detectPulses(samples([{ atMs: 100, durationMs: 20, g: 5.9 }])).pulses).toHaveLength(0);
    expect(detectPulses(samples([{ atMs: 100, durationMs: 20, g: 6.01 }])).pulses).toHaveLength(1);
  });

  it("treats a magnitude of exactly 6 g as not enough, and a hair above as a crash", () => {
    const at = (g: number): SensorSample[] =>
      Array.from({ length: 10 }, (_, i) => ({ tMs: i, ax: g, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, smoke: 0, flame: false }));
    expect(detectPulses(at(6)).pulses).toHaveLength(0);
    expect(detectPulses(at(6.0001)).pulses).toHaveLength(1);
  });

  it("accepts a pulse of 3 ms and rejects one of 2 ms, saying why", () => {
    const three = detectPulses(samples([{ atMs: 100, durationMs: 3, g: 20 }]));
    expect(three.pulses).toHaveLength(1);
    expect(three.pulses[0]!.durationMs).toBe(3);

    const two = detectPulses(samples([{ atMs: 100, durationMs: 2, g: 20 }]));
    expect(two.pulses).toEqual([]);
    expect(two.rejected).toHaveLength(1);
    expect(two.rejected[0]).toMatchObject({ durationMs: 2, reason: "filtré : durée < 3 ms" });
  });

  it("rejects the pothole: 9 g for 1 ms", () => {
    const { pulses, rejected } = detectPulses(samples([{ atMs: 700, durationMs: 1, g: 9 }]));
    expect(pulses).toEqual([]);
    expect(rejected[0]).toMatchObject({ durationMs: 1, reason: "filtré : durée < 3 ms" });
    expect(rejected[0]!.peakG).toBeGreaterThan(9);
  });

  it("counts time in samples, so a faster sensor sees the same 3 ms", () => {
    const fast = detectPulses(samples([{ atMs: 100, durationMs: 3, g: 20 }], { rateHz: 3200 }), { sampleRateHz: 3200 });
    expect(fast.pulses).toHaveLength(1);
    expect(fast.pulses[0]!.durationMs).toBeCloseTo(3, 0);
    const tooShort = detectPulses(samples([{ atMs: 100, durationMs: 2, g: 20 }], { rateHz: 3200 }), { sampleRateHz: 3200 });
    expect(tooShort.pulses).toEqual([]);
  });

  it("finds each of several pulses separately", () => {
    const { pulses } = detectPulses(
      samples([
        { atMs: 200, durationMs: 50, g: 20 },
        { atMs: 900, durationMs: 40, g: 12 },
      ]),
    );
    expect(pulses.map((p) => [p.startMs, p.durationMs])).toEqual([[200, 50], [900, 40]]);
  });

  it("flags a pulse that hit the sensor limit, and only then", () => {
    const hit = detectPulses(samples([{ atMs: 100, durationMs: 30, g: 250 }]));
    expect(hit.pulses[0]!.saturated).toBe(true);
    const near = detectPulses(samples([{ atMs: 100, durationMs: 30, g: 150 }]));
    expect(near.pulses[0]!.saturated).toBe(false);
  });

  it("handles no samples at all", () => {
    expect(detectPulses([])).toEqual({ pulses: [], rejected: [] });
  });
});

describe("summarizeImpacts: repeated impacts make one event (PRD FR-S8-06)", () => {
  const pulse = (peakG: number, deltaVKmh: number, saturated = false, startMs = 0) => ({
    startMs, durationMs: 50, peakG, deltaVKmh, saturated,
  });

  it("gives the highest peak, the Delta-V added up, and how many impacts there were", () => {
    const summary = summarizeImpacts([pulse(30, 40, false, 0), pulse(55, 25, false, 600), pulse(12, 5, false, 1200)]);
    expect(summary).toMatchObject({ impacts: 3, peakG: 55, deltaVKmh: 70, saturated: false, firstImpactMs: 0 });
  });

  it("is saturated as soon as one impact was", () => {
    expect(summarizeImpacts([pulse(30, 40), pulse(200, 90, true, 500)])!.saturated).toBe(true);
  });

  it("is one impact for a single pulse", () => {
    expect(summarizeImpacts([pulse(30, 40)])).toMatchObject({ impacts: 1, peakG: 30, deltaVKmh: 40 });
  });

  it("is nothing for no pulses", () => {
    expect(summarizeImpacts([])).toBeNull();
  });
});
