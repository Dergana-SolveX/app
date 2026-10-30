import { haversineM } from "../geo/distance";
import { THRESHOLDS } from "../thresholds";

export type ClusterAlert = {
  lat: number | null;
  lng: number | null;
  /** How far off the position may be, in metres (a geohash of 8 characters is about 19 m). */
  accuracyM: number | null;
  /** When it happened (see `trustedEventTime`). */
  eventAt: Date;
};

export type ClusterIncident = {
  lat: number | null;
  lng: number | null;
  uncertaintyM: number | null;
  lastAlertAt: Date;
};

export type MergeDecision =
  | { merge: false }
  /** `tentative`: it only matched thanks to the uncertainty allowance, so the dispatcher should confirm. */
  | { merge: true; distanceM: number; tentative: boolean };

/**
 * Do an incoming alert and an existing incident describe the same crash? (PRD FR-S2-08)
 * Within 10 minutes of the incident's last alert (either side) and within 200 m plus the smaller of the two
 * accuracies (at most 3000 m). Without a position on either side it never merges.
 */
export function shouldMerge(alert: ClusterAlert, incident: ClusterIncident): MergeDecision {
  const { windowMin, baseDistanceM, uncertaintyCapM } = THRESHOLDS.cluster;
  if (alert.lat === null || alert.lng === null || incident.lat === null || incident.lng === null) {
    return { merge: false };
  }

  const gapMs = Math.abs(alert.eventAt.getTime() - incident.lastAlertAt.getTime());
  if (gapMs > windowMin * 60_000) return { merge: false };

  const known = [alert.accuracyM, incident.uncertaintyM].filter((a): a is number => a !== null);
  const allowanceM = known.length === 0 ? 0 : Math.min(...known, uncertaintyCapM);
  const distanceM = haversineM(alert.lat, alert.lng, incident.lat, incident.lng);
  if (distanceM > baseDistanceM + allowanceM) return { merge: false };

  return { merge: true, distanceM, tentative: distanceM > baseDistanceM };
}

/** Of several matching incidents, the nearest one. Null when there are none. */
export function pickNearest<T extends { distanceM: number }>(matches: readonly T[]): T | null {
  let best: T | null = null;
  for (const match of matches) if (best === null || match.distanceM < best.distanceM) best = match;
  return best;
}

/**
 * The time to use for an alert (PRD FR-S2-10): the device's own event time when it is within 24 hours of
 * the time of receipt, otherwise the time of receipt. A late SMS keeps its true time; a wrong clock is ignored.
 */
export function trustedEventTime(eventAt: Date | null, receivedAt: Date): Date {
  if (eventAt === null || Number.isNaN(eventAt.getTime())) return receivedAt;
  const skewMs = Math.abs(eventAt.getTime() - receivedAt.getTime());
  return skewMs <= THRESHOLDS.eventTime.maxSkewHours * 3_600_000 ? eventAt : receivedAt;
}
