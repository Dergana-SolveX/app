import { generateTrace, type ChipState, type Trace } from "@solvex-dergana/shared";
import { describe, expect, it } from "vitest";

import { CRUISE_KMH, PULL_OVER_M, buildMotionTrack } from "./motion-track";
import { BARRIER_HALF_DEPTH_M, CAR_FRONT_X, FRONT_AXLE_X, createTwinDriver, type TwinPose } from "./twin-driver";

const cruise = CRUISE_KMH / 3.6;
const FRAME_MS = 16;

function rig() {
  const driver = createTwinDriver();
  let now = 0;
  let pose: TwinPose = driver.update({ chipState: "IDLE", trace: null, traceStartedAtMs: null }, now, 0);
  const run = (input: { chipState: ChipState; trace: Trace | null; traceStartedAtMs: number | null }, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
      now += FRAME_MS;
      pose = driver.update(input, now, FRAME_MS);
    }
    return pose;
  };
  return { run, now: () => now };
}

describe("twin driver: what the 3D scene shows at each frame", () => {
  it("cruises to the right at cruise speed while nothing plays", () => {
    const { run } = rig();
    const pose = run({ chipState: "ARMED", trace: null, traceStartedAtMs: null }, 1000);
    expect(pose.speedMs).toBeCloseTo(cruise, 1);
    expect(pose.odometerM).toBeGreaterThan(cruise * 0.9);
    expect(pose.obstacles).toHaveLength(0);
  });

  it("frontal crash: the barrier drives into view during the lead-in and touches the bumper at the pulse", () => {
    const { run, now } = rig();
    const trace = generateTrace("frontal_40", { seed: 1 });
    const contactMs = buildMotionTrack(trace).impact!.contactMs;
    const startedAt = now() + 1500;
    const playing = { chipState: "ARMED" as const, trace, traceStartedAtMs: startedAt };

    const lead = run(playing, FRAME_MS);
    const barrier = lead.obstacles.find((o) => o.kind === "barrier")!;
    expect(barrier.worldX - lead.odometerM).toBeGreaterThan(20);
    expect(lead.speedMs).toBeCloseTo(cruise, 1);

    const atContact = run(playing, startedAt + contactMs - now());
    const gap = barrier.worldX - BARRIER_HALF_DEPTH_M - (atContact.odometerM + CAR_FRONT_X);
    expect(Math.abs(gap)).toBeLessThan(0.3);

    const after = run(playing, trace.samples.length + 500);
    expect(after.crashed).toBe(true);
    expect(after.speedMs).toBe(0);
    expect(after.crashSeverity).toBeGreaterThan(0.5);
    expect(after.hazards).toBe(true);

    // The recording ends: the car stays where it crashed.
    const held = run({ chipState: "CONFIRM", trace: null, traceStartedAtMs: null }, 2000);
    expect(held.odometerM).toBeCloseTo(after.odometerM, 3);
    expect(held.crashed).toBe(true);
  });

  it("pothole: it passes under the front axle at the jolt, then the car keeps driving", () => {
    const { run, now } = rig();
    const trace = generateTrace("pothole", { seed: 2 });
    const bumpMs = buildMotionTrack(trace).bumps[0]!.atMs;
    const startedAt = now() + 1500;
    const playing = { chipState: "ARMED" as const, trace, traceStartedAtMs: startedAt };

    const atBump = run(playing, startedAt + bumpMs - now());
    const pothole = atBump.obstacles.find((o) => o.kind === "pothole")!;
    expect(Math.abs(pothole.worldX - (atBump.odometerM + FRONT_AXLE_X))).toBeLessThan(0.3);

    run(playing, trace.samples.length);
    const later = run({ chipState: "ARMED", trace: null, traceStartedAtMs: null }, 1000);
    expect(later.crashed).toBe(false);
    expect(later.speedMs).toBeCloseTo(cruise, 1);
  });

  it("parked fire: pulls over to the shoulder, and burns", () => {
    const { run, now } = rig();
    const trace = generateTrace("fire_parked", { seed: 4 });
    const startedAt = now() + 1500;
    const pose = run({ chipState: "ARMED", trace, traceStartedAtMs: startedAt }, 1500 + 3000);
    expect(pose.speedMs).toBe(0);
    expect(pose.lateralM).toBeCloseTo(PULL_OVER_M, 1);
    expect(pose.flame).toBe(true);
    expect(pose.parked).toBe(true);
  });

  it("a reboot gives a fresh car: no damage, no obstacle, cruising again", () => {
    const { run, now } = rig();
    const trace = generateTrace("frontal_40", { seed: 1 });
    run({ chipState: "ARMED", trace, traceStartedAtMs: now() + 1500 }, 1500 + trace.samples.length + 200);
    const fresh = run({ chipState: "BOOT", trace: null, traceStartedAtMs: null }, 100);
    expect(fresh.crashed).toBe(false);
    expect(fresh.obstacles).toHaveLength(0);
    expect(fresh.speedMs).toBeCloseTo(cruise, 1);
    expect(fresh.rollDeg).toBe(0);
  });
});
