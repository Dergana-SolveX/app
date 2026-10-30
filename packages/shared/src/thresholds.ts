/**
 * The one table of detection and decision thresholds (PRD FR-S2-01).
 * The phone, the simulated chip and the server all read these numbers.
 * The same values are mirrored in `test-vectors/svx.json` so a real firmware can be checked against them.
 */
export const THRESHOLDS = {
  /** Phone crash filter: a hard hit while driving, then stopped. A dropped phone fails the speed test. */
  phoneTrigger: { peakG: 4, speedBeforeKmh: 25, speedBeforeWindowS: 10, speedAfterKmh: 5 },
  /** Chip impact: more than `peakG` for at least `minDurationMs`, only while ARMED. */
  chipTrigger: { peakG: 6, minDurationMs: 3, requiresArmed: true },
  /** Vittel level 2 "high-energy impact" prefill. */
  vittelL2HighEnergy: { peakG: 4, deltaVKmh: 30 },
  /** Rollover: roll or pitch beyond `angleDeg`, held for `minDurationS`. */
  rollover: { angleDeg: 90, minDurationS: 2 },
  /** Clustering: sliding time window and distance (plus location uncertainty, capped). */
  cluster: { windowMin: 10, baseDistanceM: 200, uncertaintyCapM: 3000 },
  /** Hospital ranking penalties, in minutes added to the travel time (tunable). */
  matcher: { missingCapabilityPenaltyMin: 30, divertPenaltyMin: 60 },
} as const;
