import { THRESHOLDS } from "../thresholds";
import type { SensorSample } from "./detect";
import { createRng } from "./rng";

/** Every simulated trace carries this label, so nothing synthetic can pass for a recording (PRD NFR-P5). */
export const TRACE_LABEL = "TRACE SYNTHÉTIQUE" as const;

export type TraceName = "frontal_40" | "rollover" | "fire_parked" | "pothole";

export type Trace = {
  name: TraceName | "custom";
  label: typeof TRACE_LABEL;
  sampleRateHz: number;
  samples: SensorSample[];
  /** What the generator was asked to produce, for the screens and the tests. */
  meta: { peakG: number; durationMs: number; rollDeg: number; fire: boolean };
};

type Options = { seed: number; sampleRateHz?: number };

type Recipe = {
  totalMs: number;
  /** A half-sine pulse of acceleration. `axis` z adds to gravity; x is the direction of travel. */
  pulse?: { atMs: number; peakG: number; durationMs: number; axis: "x" | "z"; sign: 1 | -1 };
  /** The car turns about its long axis by `deg`, starting at `atMs` and taking `durationMs`. */
  roll?: { atMs: number; durationMs: number; deg: number };
  /** Flame and rising smoke from `atMs` for `durationMs`. */
  fire?: { atMs: number; durationMs: number };
};

const NOISE_G = 0.02;
const NOISE_DEG_S = 0.2;

function build(name: Trace["name"], recipe: Recipe, { seed, sampleRateHz = 1000 }: Options, meta: Trace["meta"]): Trace {
  const rng = createRng(seed);
  const { saturationG } = THRESHOLDS.chipSim;
  const stepMs = 1000 / sampleRateHz;
  const count = Math.round(recipe.totalMs / stepMs);
  const clamp = (g: number) => Math.max(-saturationG, Math.min(saturationG, g));

  const rollAt = (tMs: number) => {
    const roll = recipe.roll;
    if (!roll || tMs < roll.atMs) return 0;
    return roll.deg * Math.min(1, (tMs - roll.atMs) / roll.durationMs);
  };

  const samples: SensorSample[] = [];
  let previousRoll = 0;
  for (let i = 0; i < count; i++) {
    const tMs = i * stepMs;
    const roll = rollAt(tMs);
    const rad = (roll * Math.PI) / 180;

    // Gravity as the sensor feels it, turning with the car.
    let ax = 0;
    let ay = Math.sin(rad);
    let az = Math.cos(rad);

    const pulse = recipe.pulse;
    if (pulse && tMs >= pulse.atMs && tMs < pulse.atMs + pulse.durationMs) {
      const samplesInPulse = Math.max(1, Math.round((pulse.durationMs * sampleRateHz) / 1000));
      const index = Math.round((tMs - pulse.atMs) / stepMs);
      const g = pulse.sign * pulse.peakG * Math.sin((Math.PI * (index + 0.5)) / samplesInPulse);
      if (pulse.axis === "x") ax += g;
      else az += g;
    }

    const fire = recipe.fire;
    const burning = Boolean(fire && tMs >= fire.atMs && tMs < fire.atMs + fire.durationMs);
    const smoke = fire && tMs >= fire.atMs ? Math.min(0.9, (0.9 * (tMs - fire.atMs)) / 3000) : 0;

    samples.push({
      tMs,
      ax: clamp(ax + rng.gaussian(NOISE_G)),
      ay: clamp(ay + rng.gaussian(NOISE_G)),
      az: clamp(az + rng.gaussian(NOISE_G)),
      // The turning rate is the change of angle, so it adds up to exactly the angle reached.
      gx: i === 0 ? 0 : (roll - previousRoll) / (stepMs / 1000) + rng.gaussian(NOISE_DEG_S),
      gy: rng.gaussian(NOISE_DEG_S),
      gz: rng.gaussian(NOISE_DEG_S),
      smoke: Math.max(0, smoke + (smoke > 0 ? rng.gaussian(0.01) : 0)),
      flame: burning,
    });
    previousRoll = roll;
  }
  return { name, label: TRACE_LABEL, sampleRateHz, samples, meta };
}

/**
 * The scenarios of PRD FR-S8-04, from a physics model. The same seed always gives the same samples.
 * - frontal_40: a head-on crash, 25-35 g over 80-120 ms.
 * - rollover: the car turns over slowly, with no crash spike.
 * - fire_parked: a fire in a parked car, no impact.
 * - pothole: 9 g for 1 ms, which the detector must filter out.
 */
export function generateTrace(name: TraceName, options: Options): Trace {
  const rng = createRng(options.seed ^ 0x5eed);
  switch (name) {
    case "frontal_40": {
      const peakG = rng.between(25, 35);
      const durationMs = Math.round(rng.between(80, 120));
      return build(name, { totalMs: 2500, pulse: { atMs: 500, peakG, durationMs, axis: "x", sign: -1 } }, options, { peakG, durationMs, rollDeg: 0, fire: false });
    }
    case "pothole":
      return build(name, { totalMs: 2500, pulse: { atMs: 700, peakG: 9, durationMs: 1, axis: "z", sign: 1 } }, options, { peakG: 9, durationMs: 1, rollDeg: 0, fire: false });
    case "rollover":
      return build(name, { totalMs: 8000, roll: { atMs: 500, durationMs: 2500, deg: 180 } }, options, { peakG: 0, durationMs: 0, rollDeg: 180, fire: false });
    case "fire_parked":
      return build(name, { totalMs: 8000, fire: { atMs: 1000, durationMs: 6000 } }, options, { peakG: 0, durationMs: 0, rollDeg: 0, fire: true });
  }
}

/** The jury's own scenario (PRD FR-S8-05): a pulse of the asked peak and duration, a turn, a fire, in any mix. */
export function customTrace(
  { peakG, durationMs, rollDeg, fire }: { peakG: number; durationMs: number; rollDeg: number; fire: boolean },
  options: Options,
): Trace {
  const hasPulse = peakG > 0 && durationMs > 0;
  const recipe: Recipe = {
    totalMs: fire || rollDeg !== 0 ? 8000 : 2500,
    ...(hasPulse ? { pulse: { atMs: 500, peakG, durationMs, axis: "x" as const, sign: -1 as const } } : {}),
    ...(rollDeg !== 0 ? { roll: { atMs: 1000, durationMs: 2000, deg: rollDeg } } : {}),
    ...(fire ? { fire: { atMs: 1000, durationMs: 6000 } } : {}),
  };
  return build("custom", recipe, options, { peakG, durationMs, rollDeg, fire });
}
