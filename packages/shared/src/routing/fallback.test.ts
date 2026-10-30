import { describe, expect, it } from "vitest";

import type { GeoJsonPolygon } from "../geo/polygon";
import { buildRoadGraph } from "./build";
import { estimateEta, estimateEtasToMany, straightLineEta } from "./fallback";
import type { LatLng } from "./polyline";
import { loadRoadGraph } from "./route";
import { MINI_OSM } from "./testing/mini-osm";

const box = (west: number, south: number, east: number, north: number): GeoJsonPolygon => ({
  type: "Polygon",
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

// Seeded demo perimeters (see packages/db/src/seed/zones.ts).
const ZONES = [box(3.03, 36.75, 3.08, 36.79), box(3.165, 36.715, 3.205, 36.74)];

const ALGER_CENTRE: LatLng = [36.7538, 3.0588];
const BAB_EZZOUAR: LatLng = [36.725, 3.183];
const ORAN: LatLng = [35.6971, -0.6308];

// Alger-Centre -> Bab Ezzouar is 11521.202 m as the crow flies (computed independently), so x1.4 = 16129.683 m.
const ROAD_FACTORED_M = 11521.202 * 1.4;

describe("straightLineEta (haversine x 1.4)", () => {
  it("uses 50 km/h when the midpoint is inside a city zone", () => {
    // The midpoint of these two points is in the gap between the two zones, so use a pair inside Alger-Centre.
    const a: LatLng = [36.755, 3.05];
    const b: LatLng = [36.77, 3.07]; // both inside Alger-Centre
    const result = straightLineEta(a, b, ZONES);
    expect(result.etaSource).toBe("straight_line");
    expect(result.durationS).toBeCloseTo(result.distanceM / (50 / 3.6), 6);
  });

  it("uses 80 km/h outside the city zones", () => {
    const result = straightLineEta(ALGER_CENTRE, BAB_EZZOUAR, ZONES); // midpoint is between the zones
    expect(result.etaSource).toBe("straight_line");
    expect(result.distanceM).toBeCloseTo(ROAD_FACTORED_M, 0);
    expect(result.durationS).toBeCloseTo(ROAD_FACTORED_M / (80 / 3.6), 0);
  });

  it("lets the midpoint decide: an urban start with a far-away end is still open road", () => {
    const result = straightLineEta(ALGER_CENTRE, ORAN, ZONES);
    expect(result.durationS).toBeCloseTo(result.distanceM / (80 / 3.6), 6);
  });

  it("is open road everywhere when there are no zones", () => {
    const result = straightLineEta(ALGER_CENTRE, BAB_EZZOUAR, []);
    expect(result.durationS).toBeCloseTo(ROAD_FACTORED_M / (80 / 3.6), 0);
  });
});

describe("estimateEta and estimateEtasToMany: road when possible, straight line otherwise", () => {
  const graph = loadRoadGraph(buildRoadGraph(MINI_OSM, { bbox: [36.6, 2.8, 36.85, 3.55] }));
  const N1: LatLng = [36.75, 3.06];
  const N7: LatLng = [36.75, 3.066];
  const N8: LatLng = [36.75, 3.068]; // can only be left, never reached by road

  it("returns the road time when there is a road route", () => {
    const eta = estimateEta(graph, N1, N7, []);
    expect(eta.etaSource).toBe("road");
    expect(eta.distanceM).toBe(534);
  });

  it("falls back to a straight line, flagged, when a position is off the road graph", () => {
    const eta = estimateEta(graph, N1, ORAN, []);
    expect(eta.etaSource).toBe("straight_line");
  });

  it("falls back too when both ends are on the graph but no road route exists", () => {
    expect(estimateEta(graph, N1, N8, []).etaSource).toBe("straight_line");
  });

  it("answers every target in order, mixing road and straight-line estimates", () => {
    const results = estimateEtasToMany(graph, N1, [N7, ORAN, N8], ZONES);
    expect(results.map((r) => r.etaSource)).toEqual(["road", "straight_line", "straight_line"]);
    expect(results[0]!.distanceM).toBe(534);
  });

  it("uses straight lines for every target when the origin is off the road graph", () => {
    const results = estimateEtasToMany(graph, ORAN, [N1, N7], []);
    expect(results.map((r) => r.etaSource)).toEqual(["straight_line", "straight_line"]);
  });
});
