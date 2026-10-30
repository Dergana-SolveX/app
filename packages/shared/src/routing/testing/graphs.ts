import { ROAD_CLASSES, type RoadClass, type RoadGraphAsset } from "../build";
import type { LatLng } from "../polyline";

/**
 * Builds a road graph asset directly, for tests. Edge lengths must be at least the straight-line
 * distance between their nodes (as real roads always are).
 * Each edge is [from, to, length in metres, class, oneway (default: two-way)].
 */
export function assetOf(
  nodes: LatLng[],
  edges: [number, number, number, RoadClass, (0 | 1)?][],
): RoadGraphAsset {
  return {
    meta: {
      source: "OpenStreetMap",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      osmTimestamp: "test",
      bbox: [0, 0, 0, 0],
    },
    names: [],
    nodes: nodes.flatMap(([lat, lng]) => [Math.round(lat * 1e5), Math.round(lng * 1e5)]),
    edges: edges.map(([from, to, length, roadClass, oneway]) => [
      from,
      to,
      length,
      ROAD_CLASSES.indexOf(roadClass),
      -1,
      oneway ?? 0,
      "",
    ]),
  };
}
