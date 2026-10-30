import type { GeoJsonPolygon } from "../geo/polygon";
import type { LatLng } from "../routing/polyline";
import type { RoadGraph } from "../routing/route";
import { matchHospitals, type MatchHospital, type MatchResult } from "./match";
import { deriveNeeds, isInShock, needFacts, type NeedResult } from "./needs";

export type Severity = "red" | "yellow" | "green" | "unknown";

export type Recommendation = MatchResult & { needs: NeedResult };

/**
 * From the bilan to a ranked list: the needs, then the hospitals. The tablet and the server both call this, so
 * what the medic sees and what is stored come from the same rules.
 */
export function recommendForBilan(input: {
  bilan: Parameters<typeof needFacts>[0];
  hospitals: readonly MatchHospital[];
  origin: LatLng;
  graph: RoadGraph;
  zones: readonly GeoJsonPolygon[];
  severity: Severity;
}): Recommendation {
  const facts = needFacts(input.bilan);
  const needs = deriveNeeds(facts);
  return {
    needs,
    ...matchHospitals({
      needs,
      hospitals: input.hospitals,
      origin: input.origin,
      graph: input.graph,
      zones: input.zones,
      severity: input.severity,
      inShock: isInShock(facts),
    }),
  };
}
