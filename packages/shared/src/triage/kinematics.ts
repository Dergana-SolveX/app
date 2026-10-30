import { THRESHOLDS } from "../thresholds";

/** High-energy impact per `vittel_l2_high_energy`: both the g and the speed change must reach the threshold. */
export function isHighEnergy(facts: { gForce?: number | null; deltaVKmh?: number | null }): boolean {
  const { peakG, deltaVKmh } = THRESHOLDS.vittelL2HighEnergy;
  return (facts.gForce ?? 0) >= peakG && (facts.deltaVKmh ?? 0) >= deltaVKmh;
}
