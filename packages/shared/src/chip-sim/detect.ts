import { THRESHOLDS } from "../thresholds";

/** What the chip's sensors report at one instant. Accelerations in g, rotation rates in degrees per second. */
export type SensorSample = {
  tMs: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  /** Smoke sensor, 0 (clean air) to 1 (dense). */
  smoke: number;
  /** Flame sensor. */
  flame: boolean;
};

export type Pulse = {
  startMs: number;
  durationMs: number;
  /** Highest |a| in g. When `saturated`, a lower bound: the sensor cannot read more. */
  peakG: number;
  /** Integral of |a| dt over the pulse, in km/h. */
  deltaVKmh: number;
  saturated: boolean;
};

export type RejectedPulse = { startMs: number; durationMs: number; peakG: number; reason: string };

const STANDARD_GRAVITY = 9.80665;

const magnitude = (s: SensorSample) => Math.hypot(s.ax, s.ay, s.az);

type Closed = { pulse?: Pulse; rejected?: RejectedPulse };

/**
 * Follows the samples one by one and says when a run above `chipTrigger.peakG` ends: as a pulse if it lasted at
 * least `minDurationMs`, otherwise as rejected with the reason (PRD FR-S8-06). Delta-V is the integral of the
 * acceleration over the pulse. The chip uses this live; `detectPulses` runs it over a whole recording.
 */
export function createPulseTracker({ sampleRateHz = 1000 }: { sampleRateHz?: number } = {}) {
  const { peakG: thresholdG, minDurationMs } = THRESHOLDS.chipTrigger;
  const { saturationG } = THRESHOLDS.chipSim;
  const dtMs = 1000 / sampleRateHz;
  let run: SensorSample[] = [];

  const close = (): Closed => {
    if (run.length === 0) return {};
    const startMs = run[0]!.tMs;
    const durationMs = run.at(-1)!.tMs - startMs + dtMs;
    const peakG = Math.max(...run.map(magnitude));
    const finished = run;
    run = [];
    if (durationMs >= minDurationMs - 1e-9) {
      const deltaVMs = finished.reduce((sum, s) => sum + magnitude(s) * STANDARD_GRAVITY * (dtMs / 1000), 0);
      return { pulse: { startMs, durationMs, peakG, deltaVKmh: deltaVMs * 3.6, saturated: peakG >= saturationG } };
    }
    return { rejected: { startMs, durationMs, peakG, reason: `filtré : durée < ${minDurationMs} ms` } };
  };

  return {
    /** Feeds one sample; returns the pulse (or rejected pulse) that this sample ended, if any. */
    push(sample: SensorSample): Closed {
      if (magnitude(sample) > thresholdG) {
        run.push(sample);
        return {};
      }
      return close();
    },
    /** Ends a run still going at the end of the data. */
    flush: close,
  };
}

/** Finds the crash pulses in a whole recording. */
export function detectPulses(
  samples: readonly SensorSample[],
  options: { sampleRateHz?: number } = {},
): { pulses: Pulse[]; rejected: RejectedPulse[] } {
  const tracker = createPulseTracker(options);
  const pulses: Pulse[] = [];
  const rejected: RejectedPulse[] = [];
  const collect = ({ pulse, rejected: bad }: Closed) => {
    if (pulse) pulses.push(pulse);
    if (bad) rejected.push(bad);
  };
  for (const sample of samples) collect(tracker.push(sample));
  collect(tracker.flush());
  return { pulses, rejected };
}

export type ImpactSummary = {
  /** How many separate pulses were folded into this one event. */
  impacts: number;
  peakG: number;
  deltaVKmh: number;
  saturated: boolean;
  firstImpactMs: number;
};

/** Repeated impacts in one crash make one event: the highest peak, the Delta-V added up, and the count (PRD FR-S8-06). */
export function summarizeImpacts(pulses: readonly Pulse[]): ImpactSummary | null {
  if (pulses.length === 0) return null;
  return {
    impacts: pulses.length,
    peakG: Math.max(...pulses.map((p) => p.peakG)),
    deltaVKmh: pulses.reduce((sum, p) => sum + p.deltaVKmh, 0),
    saturated: pulses.some((p) => p.saturated),
    firstImpactMs: Math.min(...pulses.map((p) => p.startMs)),
  };
}
