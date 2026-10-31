import { detectPulses, type Trace } from "@solvex-dergana/shared";

/**
 * The 3D twin replays the chip's own sensor recording as motion (PRD FR-S8-08): speed is the integral of the
 * longitudinal acceleration, roll the integral of the gyroscope, and the crash pulses come from the same
 * detector the chip runs. Only what a sensor cannot see is modelled: the cruise speed before the event, the
 * suspension's visible bounce, and the driver pulling over before a parked-car fire.
 */

/** Speed the car drives at before anything happens (urban road). */
export const CRUISE_KMH = 50;
/** Sideways distance to the hard shoulder when the driver pulls over. */
export const PULL_OVER_M = 2.4;
/** Front to rear axle: the rear wheels meet a bump this far after the front ones. */
export const WHEELBASE_M = 2.65;

const G = 9.80665;
/** Longitudinal or vertical accelerations above this are an event, not sensor noise (noise is ~0.02 g). */
const EVENT_G = 0.5;
/** After a detected collision the car brakes to a stop; a car on its side or roof slides to a stop. */
const POST_CRASH_BRAKE_MS2 = 7;
const SLIDE_MS2 = 6;
const SLIDE_FROM_DEG = 12;
/** A real crash throws the car back a little: at most this share of the cruise speed. */
const REBOUND_SHARE = 0.12;
/** A roll this large is no parked-car fire: the car stays where it rolled. */
const ROLLED_DEG = 30;

/** Visible suspension, tuned so the bounce reads on screen. Pitch in degrees (+ nose up), heave in metres. */
const PITCH_HZ = 1.3;
const PITCH_DAMPING = 0.32;
const HEAVE_HZ = 1.7;
const HEAVE_DAMPING = 0.3;
const PITCH_PER_MS = 3.3; // deg/s of pitch rate per m/s of longitudinal velocity change
const BRAKE_PITCH_PER_MS2 = 0.22; // steady nose-dive per m/s² of braking
const HEAVE_PER_MS = 11; // m/s of heave rate per m/s of vertical velocity change
const BUMP_PITCH_PER_MS = 480; // deg/s of pitch rate per m/s of vertical velocity change at one axle
const MAX_PITCH_DEG = 12;
const MAX_HEAVE_M = 0.15;

export type MotionTrack = {
  durationMs: number;
  stepMs: number;
  speed: Float32Array;
  distance: Float32Array;
  roll: Float32Array;
  pitch: Float32Array;
  heave: Float32Array;
  lateral: Float32Array;
  smoke: Float32Array;
  flame: Uint8Array;
  /** The first collision the chip detects, with where the car's front meets the obstacle. */
  impact: { contactMs: number; contactDistanceM: number; peakG: number; deltaVKmh: number } | null;
  /** Jolts the chip filters out (a pothole), with where the front wheels meet them. */
  bumps: { atMs: number; atDistanceM: number; peakG: number }[];
  rollStartMs: number | null;
  fireAtMs: number | null;
  /** The driver pulled over and stopped before a fire. */
  parked: boolean;
};

export type MotionFrame = {
  speedMs: number;
  distanceM: number;
  rollDeg: number;
  pitchDeg: number;
  heaveM: number;
  lateralM: number;
  smoke: number;
  flame: boolean;
  braking: boolean;
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, limit: number) => Math.max(-limit, Math.min(limit, x));
const towardZero = (v: number, amount: number) => (v > 0 ? Math.max(0, v - amount) : Math.min(0, v + amount));

export function buildMotionTrack(trace: Trace, { cruiseKmh = CRUISE_KMH, stepMs = 10 } = {}): MotionTrack {
  const samples = trace.samples;
  const dtMs = 1000 / trace.sampleRateHz;
  const dt = dtMs / 1000;
  const durationMs = samples.length * dtMs;
  const steps = Math.round(durationMs / stepMs);
  const recordEvery = Math.max(1, Math.round(stepMs / dtMs));
  const cruise = cruiseKmh / 3.6;

  const { pulses, rejected } = detectPulses(samples, { sampleRateHz: trace.sampleRateHz });
  const firstPulse = pulses[0] ?? null;

  // A pre-pass: the largest roll and the first flame decide whether this is a parked-car fire.
  let rollProbe = 0;
  let maxRoll = 0;
  let fireAtMs: number | null = null;
  for (const s of samples) {
    rollProbe += s.gx * dt;
    maxRoll = Math.max(maxRoll, Math.abs(rollProbe));
    if (fireAtMs === null && s.flame) fireAtMs = s.tMs;
  }
  const parked = fireAtMs !== null && pulses.length === 0 && maxRoll < ROLLED_DEG;
  const stopMs = parked ? Math.max(300, fireAtMs! - 100) : 0;

  const track: MotionTrack = {
    durationMs,
    stepMs,
    speed: new Float32Array(steps + 1),
    distance: new Float32Array(steps + 1),
    roll: new Float32Array(steps + 1),
    pitch: new Float32Array(steps + 1),
    heave: new Float32Array(steps + 1),
    lateral: new Float32Array(steps + 1),
    smoke: new Float32Array(steps + 1),
    flame: new Uint8Array(steps + 1),
    impact: null,
    bumps: [],
    rollStartMs: null,
    fireAtMs,
    parked,
  };

  let v = cruise;
  let distance = 0;
  let roll = 0;
  let pitch = 0;
  let pitchRate = 0;
  let heave = 0;
  let heaveRate = 0;
  let lateral = 0;
  let smoke = 0;
  let flame = false;
  let xRunOnsetMs: number | null = null;
  let xRunOnsetDistance = 0;
  let zImpulse = 0;
  const rearEchoes: { atMs: number; impulse: number }[] = [];
  const pitchW = 2 * Math.PI * PITCH_HZ;
  const heaveW = 2 * Math.PI * HEAVE_HZ;

  const record = (k: number) => {
    track.speed[k] = v;
    track.distance[k] = distance;
    track.roll[k] = roll;
    track.pitch[k] = pitch;
    track.heave[k] = heave;
    track.lateral[k] = lateral;
    track.smoke[k] = smoke;
    track.flame[k] = flame ? 1 : 0;
  };
  record(0);

  const bump = (impulse: number, pitchSign: 1 | -1) => {
    heaveRate += HEAVE_PER_MS * impulse;
    pitchRate += pitchSign * BUMP_PITCH_PER_MS * impulse;
  };

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const t = s.tMs + dtMs; // the state below is the state at the end of this sample
    const before = v;

    // Roll: the integral of the gyroscope's roll rate.
    roll += s.gx * dt;
    if (track.rollStartMs === null && Math.abs(roll) > 2) track.rollStartMs = s.tMs;

    // Longitudinal: the integral of the deceleration pulse, capped at a small rebound.
    const inXRun = Math.abs(s.ax) > EVENT_G;
    if (inXRun) {
      if (xRunOnsetMs === null) {
        xRunOnsetMs = s.tMs;
        xRunOnsetDistance = distance;
      }
      v = Math.max(-REBOUND_SHARE * cruise, v + s.ax * G * dt);
      pitchRate += PITCH_PER_MS * s.ax * G * dt;
    } else {
      xRunOnsetMs = null;
    }
    if (firstPulse && track.impact === null && s.tMs >= firstPulse.startMs) {
      track.impact = {
        contactMs: xRunOnsetMs ?? firstPulse.startMs,
        contactDistanceM: xRunOnsetMs === null ? distance : xRunOnsetDistance,
        peakG: firstPulse.peakG,
        deltaVKmh: firstPulse.deltaVKmh,
      };
    }
    const afterImpact = firstPulse !== null && s.tMs >= firstPulse.startMs + firstPulse.durationMs;
    if (!inXRun && afterImpact) v = towardZero(v, POST_CRASH_BRAKE_MS2 * dt);
    if (Math.abs(roll) > SLIDE_FROM_DEG) v = towardZero(v, SLIDE_MS2 * dt);
    if (parked) {
      v = cruise * (1 - smoothstep(0, stopMs, t));
      lateral = PULL_OVER_M * smoothstep(0, stopMs, t);
    }
    distance += v * dt;

    // Vertical: a jolt beyond gravity (as the sensor feels it, turned with the car) lifts the front axle,
    // and the rear axle meets the same bump one wheelbase later.
    const dz = s.az - Math.cos((roll * Math.PI) / 180);
    if (Math.abs(dz) > EVENT_G) {
      const impulse = dz * G * dt;
      zImpulse += impulse;
      bump(impulse, 1);
    } else if (zImpulse !== 0) {
      if (v > 1) rearEchoes.push({ atMs: s.tMs + (WHEELBASE_M / v) * 1000, impulse: zImpulse });
      zImpulse = 0;
    }
    for (let e = rearEchoes.length - 1; e >= 0; e--) {
      if (rearEchoes[e]!.atMs <= s.tMs) {
        bump(rearEchoes[e]!.impulse, -1);
        rearEchoes.splice(e, 1);
      }
    }

    // Suspension springs: the pulses above kick them; steady braking holds the nose down.
    const accel = (v - before) / dt;
    const pitchTarget = inXRun ? 0 : clamp(BRAKE_PITCH_PER_MS2 * accel, 3);
    pitchRate += (-pitchW * pitchW * (pitch - pitchTarget) - 2 * PITCH_DAMPING * pitchW * pitchRate) * dt;
    pitch = clamp(pitch + pitchRate * dt, MAX_PITCH_DEG);
    heaveRate += (-heaveW * heaveW * heave - 2 * HEAVE_DAMPING * heaveW * heaveRate) * dt;
    heave = clamp(heave + heaveRate * dt, MAX_HEAVE_M);

    // Fire: the smoke sensor (lightly smoothed for the particles) and the flame sensor.
    smoke += (s.smoke - smoke) * Math.min(1, dt / 0.15);
    flame = s.flame;

    if ((i + 1) % recordEvery === 0) record(Math.min(steps, (i + 1) / recordEvery));
  }
  record(steps);

  track.bumps = rejected.map((r) => ({
    atMs: r.startMs,
    atDistanceM: track.distance[Math.min(steps, Math.round(r.startMs / stepMs))]!,
    peakG: r.peakG,
  }));
  return track;
}

/** The car's pose at `tMs` into the recording: interpolated, and held at the last pose once it is over. */
export function sampleTrack(track: MotionTrack, tMs: number): MotionFrame {
  const last = track.speed.length - 1;
  const x = Math.min(last, Math.max(0, tMs / track.stepMs));
  const i = Math.min(last - 1, Math.floor(x));
  const f = x - i;
  const lerp = (a: Float32Array) => a[i]! + (a[i + 1]! - a[i]!) * f;
  return {
    speedMs: lerp(track.speed),
    distanceM: lerp(track.distance),
    rollDeg: lerp(track.roll),
    pitchDeg: lerp(track.pitch),
    heaveM: lerp(track.heave),
    lateralM: lerp(track.lateral),
    smoke: lerp(track.smoke),
    flame: track.flame[f < 0.5 ? i : i + 1] === 1,
    braking: track.speed[i + 1]! < track.speed[i]! - 1e-3,
  };
}
