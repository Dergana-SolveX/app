import type { ChipState, Trace } from "@solvex-dergana/shared";

import { CRUISE_KMH, buildMotionTrack, sampleTrack, type MotionFrame, type MotionTrack } from "./motion-track";

/** Car geometry shared with the 3D model, in metres from the car's origin (ground, mid-wheelbase). */
export const CAR_FRONT_X = 2.2;
export const FRONT_AXLE_X = 1.35;
export const BARRIER_HALF_DEPTH_M = 0.35;
/** Obstacles this far behind the car have left the picture. */
const FORGET_BEHIND_M = 60;
/** How fast a pose left over from a recording relaxes back to neutral while cruising. */
const RELAX_S = 0.35;

export type Obstacle = { id: string; kind: "barrier" | "pothole"; worldX: number };

export type TwinInput = { chipState: ChipState; trace: Trace | null; traceStartedAtMs: number | null };

export type TwinPose = {
  /** Metres driven since the page opened: the world scrolls by this much. */
  odometerM: number;
  speedMs: number;
  rollDeg: number;
  pitchDeg: number;
  heaveM: number;
  lateralM: number;
  smoke: number;
  flame: boolean;
  braking: boolean;
  /** The car has hit something: deformed, hazard lights on. */
  crashed: boolean;
  /** 0 to 1, from the chip's Delta-V. */
  crashSeverity: number;
  /** Since the bumper met the obstacle, in ms; null before. */
  impactAgeMs: number | null;
  hazards: boolean;
  parked: boolean;
  /** Positions in odometer metres: the car is at `odometerM`. */
  obstacles: Obstacle[];
};

type Replay = { trace: Trace; track: MotionTrack; startedAtMs: number; startOdo: number; leadSpeed: number };

/**
 * Turns the simulator's state into the pose the 3D scene draws, frame by frame: cruising between scenarios,
 * replaying a recording (with its obstacle placed where the car meets it), then holding the aftermath until
 * the chip reboots. Pure and deterministic: the scene owns no motion logic of its own.
 */
export function createTwinDriver({ cruiseKmh = CRUISE_KMH } = {}) {
  const cruise = cruiseKmh / 3.6;
  const tracks = new WeakMap<Trace, MotionTrack>();
  let lastTrace: Trace | null = null;
  let lastState: ChipState | null = null;
  let replay: Replay | null = null;
  let held: MotionFrame | null = null;
  let heldParked = false;
  let obstacles: Obstacle[] = [];
  let impactAtMs: number | null = null;
  let severity = 0;
  const pose: Omit<TwinPose, "obstacles" | "crashed" | "crashSeverity" | "impactAgeMs" | "hazards" | "parked"> = {
    odometerM: 0,
    speedMs: cruise,
    rollDeg: 0,
    pitchDeg: 0,
    heaveM: 0,
    lateralM: 0,
    smoke: 0,
    flame: false,
    braking: false,
  };

  const trackFor = (trace: Trace) => {
    let track = tracks.get(trace);
    if (!track) {
      track = buildMotionTrack(trace, { cruiseKmh });
      tracks.set(trace, track);
    }
    return track;
  };

  const placeObstacles = (r: Replay): Obstacle[] => [
    ...(r.track.impact
      ? [{ id: `barrier-${r.startedAtMs}`, kind: "barrier" as const, worldX: r.startOdo + r.track.impact.contactDistanceM + CAR_FRONT_X + BARRIER_HALF_DEPTH_M }]
      : []),
    ...r.track.bumps.map((b, i) => ({ id: `pothole-${r.startedAtMs}-${i}`, kind: "pothole" as const, worldX: r.startOdo + b.atDistanceM + FRONT_AXLE_X })),
  ];

  const freshCar = () => {
    replay = null;
    held = null;
    heldParked = false;
    obstacles = [];
    impactAtMs = null;
    severity = 0;
    Object.assign(pose, { speedMs: cruise, rollDeg: 0, pitchDeg: 0, heaveM: 0, lateralM: 0, smoke: 0, flame: false, braking: false });
  };

  const cruiseStep = (dt: number) => {
    const relax = Math.min(1, dt / RELAX_S);
    pose.speedMs += (cruise - pose.speedMs) * Math.min(1, dt / 0.8);
    pose.odometerM += pose.speedMs * dt;
    pose.rollDeg -= pose.rollDeg * relax;
    pose.pitchDeg -= pose.pitchDeg * relax;
    pose.heaveM -= pose.heaveM * relax;
    pose.lateralM -= pose.lateralM * relax;
    pose.smoke -= pose.smoke * relax;
    pose.flame = false;
    pose.braking = false;
  };

  const applyFrame = (frame: MotionFrame) => {
    Object.assign(pose, {
      speedMs: frame.speedMs,
      rollDeg: frame.rollDeg,
      pitchDeg: frame.pitchDeg,
      heaveM: frame.heaveM,
      lateralM: frame.lateralM,
      smoke: frame.smoke,
      flame: frame.flame,
      braking: frame.braking,
    });
  };

  function update(input: TwinInput, nowMs: number, dtMs: number): TwinPose {
    const dt = dtMs / 1000;
    if (input.chipState === "BOOT" && lastState !== "BOOT") freshCar();
    lastState = input.chipState;

    if (input.trace && input.trace !== lastTrace) {
      lastTrace = input.trace;
      if (held || replay || impactAtMs !== null) freshCar();
      const startedAtMs = input.traceStartedAtMs ?? nowMs;
      // Where the car will be when the recording starts, at its current speed: the obstacle waits there.
      const leadS = Math.max(0, startedAtMs - nowMs) / 1000;
      replay = {
        trace: input.trace,
        track: trackFor(input.trace),
        startedAtMs,
        startOdo: pose.odometerM + pose.speedMs * leadS,
        leadSpeed: pose.speedMs,
      };
      obstacles = placeObstacles(replay);
    }

    let parked = heldParked;
    if (replay) {
      const t = nowMs - replay.startedAtMs;
      if (t < 0) {
        // From the clock, not summed per frame: on a slow GPU the car still meets the obstacle on time.
        cruiseStep(dt);
        pose.speedMs = replay.leadSpeed;
        pose.odometerM = replay.startOdo + (replay.leadSpeed * t) / 1000;
      } else {
        const frame = sampleTrack(replay.track, t);
        applyFrame(frame);
        pose.odometerM = replay.startOdo + frame.distanceM;
        parked = replay.track.parked;
        const impact = replay.track.impact;
        if (impact && t >= impact.contactMs && impactAtMs === null) {
          impactAtMs = replay.startedAtMs + impact.contactMs;
          severity = Math.min(1, Math.max(0.15, impact.deltaVKmh / 70));
        }
        if (t >= replay.track.durationMs) {
          // A car still rolling (a pothole) drives on; a stopped one stays as the recording left it.
          if (frame.speedMs > 0.5 && impactAtMs === null) {
            held = null;
          } else {
            held = frame;
            heldParked = replay.track.parked;
          }
          replay = null;
        }
      }
    } else if (held) {
      applyFrame({ ...held, speedMs: 0, braking: false });
    } else {
      cruiseStep(dt);
      obstacles = obstacles.filter((o) => o.worldX > pose.odometerM - FORGET_BEHIND_M);
    }

    const crashed = impactAtMs !== null;
    return {
      ...pose,
      crashed,
      crashSeverity: severity,
      impactAgeMs: impactAtMs === null ? null : Math.max(0, nowMs - impactAtMs),
      hazards: crashed || parked || pose.flame || Math.abs(pose.rollDeg) > 30,
      parked,
      obstacles,
    };
  }

  return { update };
}
