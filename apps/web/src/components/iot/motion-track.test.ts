import { customTrace, generateTrace } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { CRUISE_KMH, PULL_OVER_M, buildMotionTrack, sampleTrack } from "./motion-track";

const cruise = CRUISE_KMH / 3.6;

describe("buildMotionTrack: the 3D car replays the chip's own sensor data", () => {
  it("frontal crash: cruises, meets the barrier when the deceleration pulse starts, dives, then stays stopped", () => {
    const track = buildMotionTrack(generateTrace("frontal_40", { seed: 1 }));

    expect(track.impact).not.toBeNull();
    const { contactMs, contactDistanceM, deltaVKmh } = track.impact!;
    expect(contactMs).toBeGreaterThan(450);
    expect(contactMs).toBeLessThan(520);
    expect(deltaVKmh).toBeGreaterThan(40);
    // Before the pulse the car drives at cruise speed, so it reaches the barrier exactly where it should.
    expect(sampleTrack(track, 300).speedMs).toBeCloseTo(cruise, 1);
    expect(contactDistanceM).toBeCloseTo((cruise * contactMs) / 1000, 0);
    // The pulse takes all the speed away; the car does not drive on.
    expect(Math.abs(sampleTrack(track, contactMs + 400).speedMs)).toBeLessThan(1);
    expect(sampleTrack(track, track.durationMs).speedMs).toBe(0);
    const end = sampleTrack(track, track.durationMs).distanceM;
    expect(end - sampleTrack(track, contactMs + 900).distanceM).toBeLessThan(0.3);
    // The deceleration pitches the nose down.
    const dive = Math.min(...[50, 100, 150, 200, 250].map((dt) => sampleTrack(track, contactMs + dt).pitchDeg));
    expect(dive).toBeLessThan(-3);
  });

  it("pothole: the chip rejects the 1 ms jolt, the car bounces and drives on at the same speed", () => {
    const track = buildMotionTrack(generateTrace("pothole", { seed: 2 }));

    expect(track.impact).toBeNull();
    expect(track.bumps).toHaveLength(1);
    expect(track.bumps[0]!.atMs).toBeGreaterThan(650);
    expect(track.bumps[0]!.atMs).toBeLessThan(750);
    const peakHeave = Math.max(...[20, 40, 60, 80, 100, 140].map((dt) => Math.abs(sampleTrack(track, track.bumps[0]!.atMs + dt).heaveM)));
    expect(peakHeave).toBeGreaterThan(0.02);
    const end = sampleTrack(track, track.durationMs);
    expect(end.speedMs).toBeCloseTo(cruise, 2);
    expect(Math.abs(end.heaveM)).toBeLessThan(0.005);
    expect(end.distanceM).toBeCloseTo((cruise * track.durationMs) / 1000, 0);
  });

  it("rollover: the roll is the integral of the gyroscope, the car turns over and slides to a stop", () => {
    const track = buildMotionTrack(generateTrace("rollover", { seed: 3 }));

    expect(track.impact).toBeNull();
    expect(track.rollStartMs).toBeGreaterThan(450);
    expect(track.rollStartMs).toBeLessThan(700);
    const end = sampleTrack(track, track.durationMs);
    expect(Math.abs(end.rollDeg)).toBeGreaterThan(170);
    expect(Math.abs(end.rollDeg)).toBeLessThan(190);
    expect(end.speedMs).toBe(0);
  });

  it("parked fire: the car pulls over and stops before the flame, then smoke builds up", () => {
    const track = buildMotionTrack(generateTrace("fire_parked", { seed: 4 }));

    expect(track.parked).toBe(true);
    expect(track.fireAtMs).toBeGreaterThan(900);
    expect(track.fireAtMs).toBeLessThan(1100);
    expect(sampleTrack(track, track.fireAtMs!).speedMs).toBeLessThan(0.05);
    expect(sampleTrack(track, track.fireAtMs!).lateralM).toBeCloseTo(PULL_OVER_M, 1);
    expect(sampleTrack(track, 3000).flame).toBe(true);
    expect(sampleTrack(track, 7500).flame).toBe(false);
    expect(sampleTrack(track, track.durationMs).smoke).toBeGreaterThan(0.5);
  });

  it("custom impact below a real crash still stops the car: the driver brakes after any detected collision", () => {
    const track = buildMotionTrack(customTrace({ peakG: 10, durationMs: 50, rollDeg: 0, fire: false }, { seed: 5 }));

    expect(track.impact).not.toBeNull();
    expect(sampleTrack(track, track.impact!.contactMs + 100).speedMs).toBeGreaterThan(5);
    expect(sampleTrack(track, track.durationMs).speedMs).toBe(0);
  });

  it("custom roll with fire: rolls onto its side and burns where it stops, without pulling over", () => {
    const track = buildMotionTrack(customTrace({ peakG: 0, durationMs: 0, rollDeg: 90, fire: true }, { seed: 6 }));

    expect(track.parked).toBe(false);
    const end = sampleTrack(track, track.durationMs);
    expect(Math.abs(end.rollDeg)).toBeGreaterThan(85);
    expect(end.speedMs).toBe(0);
    expect(sampleTrack(track, 2000).flame).toBe(true);
  });
});

describe("sampleTrack", () => {
  it("interpolates between stored steps and holds the last pose after the recording", () => {
    const track = buildMotionTrack(generateTrace("pothole", { seed: 7 }));
    const a = sampleTrack(track, 100);
    const b = sampleTrack(track, 110);
    expect(sampleTrack(track, 105).distanceM).toBeCloseTo((a.distanceM + b.distanceM) / 2, 4);
    expect(sampleTrack(track, track.durationMs + 5_000)).toEqual(sampleTrack(track, track.durationMs));
    expect(sampleTrack(track, -50)).toEqual(sampleTrack(track, 0));
  });
});
