import type { GeoJsonPolygon } from "../geo/polygon";
import { estimateEtasToMany } from "../routing/fallback";
import type { LatLng } from "../routing/polyline";
import type { RoadGraph } from "../routing/route";
import { THRESHOLDS } from "../thresholds";
import type { Need, NeedResult } from "./needs";

export type HospitalTier = "chu" | "ehs" | "eph" | "epsp_polyclinic";

export type MatchHospital = {
  id: string;
  name: string;
  shortName: string;
  tier: HospitalTier;
  lat: number;
  lng: number;
  capabilities: Partial<Record<Need, boolean>>;
  /** What the hospital board says it is accepting or diverting, by need. */
  status: Partial<Record<string, "accept" | "divert">>;
  /** A facility that can only stabilise (polyclinics). */
  stabilizationOnly: boolean;
};

export type MatchFlag = "secondary_transfer_risk" | "stabilisation_only";

export type HospitalMatch = {
  hospitalId: string;
  etaMin: number;
  /** "road" when computed on the road graph, "straight_line" for the flagged estimate. */
  etaSource: "road" | "straight_line";
  distanceM: number;
  /** Needed capabilities the hospital has. */
  matched: Need[];
  /** Needed capabilities the hospital lacks. */
  missing: Need[];
  /** Needed capabilities it has but is diverting. */
  diverting: Need[];
  preferredMatched: Need[];
  preferredMissing: Need[];
  score: number;
  scoreBreakdown: { etaMin: number; missingPenaltyMin: number; divertPenaltyMin: number };
  flags: MatchFlag[];
};

export type MatchResult = {
  /** Best first. */
  ranking: HospitalMatch[];
  recommended: HospitalMatch | null;
  /** The nearest stabilisation-only facility, when it matters: no full match, or stabilise first. */
  stabilisation: HospitalMatch | null;
  stabiliseFirst: boolean;
};

/** Ranking groups, best first: everything met with no relevant divert; a partial match; a polyclinic that may not be recommended. */
const FULL_MATCH = 0;
const PARTIAL_MATCH = 1;
const NOT_RECOMMENDABLE = 2;

/**
 * Ranks hospitals for a victim (PRD FR-S2-27/28). `score = ETA (min) + W_missing x missing + W_divert x diverting`.
 * Hospitals with every need met and no relevant divert come first; polyclinics are only recommended for a
 * green victim. All times come from the road graph, with the flagged straight-line fallback off the graph.
 */
export function matchHospitals(input: {
  needs: NeedResult;
  hospitals: readonly MatchHospital[];
  origin: LatLng;
  graph: RoadGraph;
  zones: readonly GeoJsonPolygon[];
  severity: "red" | "yellow" | "green" | "unknown";
  inShock: boolean;
}): MatchResult {
  const { missingCapabilityPenaltyMin, divertPenaltyMin, stabiliseFirstEtaMin } = THRESHOLDS.matcher;
  const { needs, hospitals } = input;
  const etas = estimateEtasToMany(input.graph, input.origin, hospitals.map((h) => [h.lat, h.lng] as LatLng), input.zones);

  const matches = hospitals.map((hospital, i) => {
    const eta = etas[i]!;
    const has = (need: Need) => hospital.capabilities[need] === true;
    const missing = needs.required.filter((need) => !has(need));
    const matched = needs.required.filter(has);
    // A divert only counts on a capability the hospital has: a missing one is already penalised.
    const diverting = matched.filter((need) => hospital.status[need] === "divert");
    const etaMin = eta.durationS / 60;
    const scoreBreakdown = {
      etaMin,
      missingPenaltyMin: missingCapabilityPenaltyMin * missing.length,
      divertPenaltyMin: divertPenaltyMin * diverting.length,
    };
    const result: HospitalMatch = {
      hospitalId: hospital.id,
      etaMin,
      etaSource: eta.etaSource,
      distanceM: eta.distanceM,
      matched,
      missing,
      diverting,
      preferredMatched: needs.preferred.filter(has),
      preferredMissing: needs.preferred.filter((need) => !has(need)),
      score: scoreBreakdown.etaMin + scoreBreakdown.missingPenaltyMin + scoreBreakdown.divertPenaltyMin,
      scoreBreakdown,
      flags: hospital.stabilizationOnly ? ["stabilisation_only"] : [],
    };
    return { hospital, result };
  });

  const group = ({ hospital, result }: (typeof matches)[number]) => {
    if (hospital.stabilizationOnly && input.severity !== "green") return NOT_RECOMMENDABLE;
    return result.missing.length === 0 && result.diverting.length === 0 ? FULL_MATCH : PARTIAL_MATCH;
  };
  const ranked = matches
    .map((entry, index) => ({ entry, index, group: group(entry) }))
    .sort((a, b) => a.group - b.group || a.entry.result.score - b.entry.result.score || a.index - b.index);
  const ranking = ranked.map(({ entry }) => entry.result);

  const best = ranked[0] && ranked[0].group < NOT_RECOMMENDABLE ? ranked[0] : undefined;
  const recommended = best?.entry.result ?? null;
  if (best && best.group === PARTIAL_MATCH) recommended!.flags.push("secondary_transfer_risk");

  const nearestStabilisation = matches
    .filter(({ hospital }) => hospital.stabilizationOnly)
    .map(({ result }) => result)
    .sort((a, b) => a.etaMin - b.etaMin)[0];
  const stabiliseFirst = Boolean(
    input.inShock && recommended && recommended.etaMin > stabiliseFirstEtaMin && nearestStabilisation,
  );
  const stabilisation =
    nearestStabilisation && (stabiliseFirst || recommended?.flags.includes("secondary_transfer_risk"))
      ? nearestStabilisation
      : null;

  return { ranking, recommended, stabilisation, stabiliseFirst };
}

/** The columns of a `hospitals_matrix` row that the matcher reads. */
export type HospitalRow = {
  id: string;
  name: string;
  shortName: string;
  tier: HospitalTier;
  lat: number;
  lng: number;
  capNeurosurgery: boolean;
  capCtScanner: boolean;
  capBurnUnit: boolean;
  capIcu: boolean;
  capTraumaSurgery: boolean;
  capPediatric: boolean;
  capObstetrics: boolean;
  capBloodBank: boolean;
  capStabilizationOnly: boolean;
  status: Partial<Record<string, "accept" | "divert">>;
};

export function hospitalFromRow(row: HospitalRow): MatchHospital {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    tier: row.tier,
    lat: row.lat,
    lng: row.lng,
    capabilities: {
      neurosurgery: row.capNeurosurgery,
      ct_scanner: row.capCtScanner,
      burn_unit: row.capBurnUnit,
      icu: row.capIcu,
      trauma_surgery: row.capTraumaSurgery,
      pediatric: row.capPediatric,
      obstetrics: row.capObstetrics,
      blood_bank: row.capBloodBank,
    },
    status: row.status,
    stabilizationOnly: row.capStabilizationOnly || row.tier === "epsp_polyclinic",
  };
}
