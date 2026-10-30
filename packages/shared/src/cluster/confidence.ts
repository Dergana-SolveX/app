import { THRESHOLDS } from "../thresholds";

export type ConfidenceAlert = {
  source: "iot" | "app_auto" | "app_witness" | "ussd";
  /** False when the SMS checksum did not match. */
  crcValid: boolean;
  /** False when a chip signature failed; null when there was none to check. */
  authenticated: boolean | null;
};

/** The three independent ways an alert can reach us: the chip, the phone app, the phone network. */
const layerOf = (source: ConfidenceAlert["source"]) =>
  source === "iot" ? 1 : source === "ussd" ? 3 : 2;

/**
 * How much to trust an incident, from 0 to `max` (PRD FR-S2-09).
 * 1 - product(1 - weight), where an alert with a bad checksum or a failed signature counts half,
 * plus a bonus when at least two different layers confirm each other.
 */
export function confidence(alerts: readonly ConfidenceAlert[]): number {
  if (alerts.length === 0) return 0;
  const { weights, independentBonus, max, downgradeFactor } = THRESHOLDS.confidence;

  let doubt = 1;
  for (const alert of alerts) {
    const downgraded = !alert.crcValid || alert.authenticated === false;
    doubt *= 1 - weights[alert.source] * (downgraded ? downgradeFactor : 1);
  }
  const independent = new Set(alerts.map((a) => layerOf(a.source))).size >= 2;
  return Math.min(max, 1 - doubt + (independent ? independentBonus : 0));
}
