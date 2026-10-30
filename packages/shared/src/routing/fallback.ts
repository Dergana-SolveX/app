import { haversineM } from "../geo/distance";
import { pointInPolygon, type GeoJsonPolygon } from "../geo/polygon";
import { THRESHOLDS } from "../thresholds";
import type { LatLng } from "./polyline";
import { route, travelTimesToMany, type RoadEta, type RoadGraph } from "./route";

/** A rough estimate for positions the road graph cannot serve. Always flagged, so the UI can say so. */
export type StraightLineEta = {
  etaSource: "straight_line";
  durationS: number;
  distanceM: number;
};

export type Eta = RoadEta | StraightLineEta;

/**
 * The fallback estimate (PRD FR-S2-23): straight-line distance x 1.4, driven at 50 km/h in the city
 * and 80 km/h on open road. It is "in the city" when the midpoint of the two positions is inside a zone.
 */
export function straightLineEta(from: LatLng, to: LatLng, zones: readonly GeoJsonPolygon[]): StraightLineEta {
  const { roadFactor, urbanKmh, openKmh } = THRESHOLDS.routing.straightLine;
  const middle: LatLng = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const urban = zones.some((zone) => pointInPolygon(middle[0], middle[1], zone));
  const distanceM = haversineM(from[0], from[1], to[0], to[1]) * roadFactor;
  return { etaSource: "straight_line", distanceM, durationS: distanceM / ((urban ? urbanKmh : openKmh) / 3.6) };
}

/** The road time between two positions, or the straight-line estimate when there is no road route. */
export function estimateEta(graph: RoadGraph, from: LatLng, to: LatLng, zones: readonly GeoJsonPolygon[]): Eta {
  const road = route(graph, from, to);
  return road
    ? { etaSource: "road", durationS: road.durationS, distanceM: road.distanceM, accessM: road.accessM }
    : straightLineEta(from, to, zones);
}

/** `estimateEta` to many targets at once: one road search, with the straight-line fallback where needed. */
export function estimateEtasToMany(
  graph: RoadGraph,
  from: LatLng,
  targets: readonly LatLng[],
  zones: readonly GeoJsonPolygon[],
): Eta[] {
  return travelTimesToMany(graph, from, targets).map(
    (road, i) => road ?? straightLineEta(from, targets[i]!, zones),
  );
}
