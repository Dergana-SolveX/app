import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { buildRoadGraph, ROAD_CLASSES, type RoadClass } from "./build";
import type { LatLng } from "./polyline";
import { loadRoadGraph, route, travelTimesToMany } from "./route";
import { assetOf } from "./testing/graphs";
import { MINI_OSM } from "./testing/mini-osm";
import { haversineM } from "../geo/distance";
import { THRESHOLDS } from "../thresholds";

const mini = loadRoadGraph(buildRoadGraph(MINI_OSM, { bbox: [36.6, 2.8, 36.85, 3.55] }));
const N1: LatLng = [36.75, 3.06];
const N3: LatLng = [36.75, 3.064];
const N5: LatLng = [36.752, 3.064];
const N7: LatLng = [36.75, 3.066];
const N8: LatLng = [36.75, 3.068];

describe("travelTimesToMany (one Dijkstra pass to many targets)", () => {
  it("gives the road time and distance to each target, in the order asked, with null where there is no road route", () => {
    const oran: LatLng = [35.6971, -0.6308];
    const results = travelTimesToMany(mini, N1, [N7, N5, N8, N3, oran]);

    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({ etaSource: "road", distanceM: 534, accessM: 0 });
    expect(results[0]!.durationS).toBeCloseTo(32.752, 3);
    expect(results[1]!.distanceM).toBe(178 + 178 + 222);
    expect(results[1]!.durationS).toBeCloseTo(2 * 12.816 + 19.98, 3);
    expect(results[2]).toBeNull(); // node 8 can be left but never reached
    expect(results[3]!.durationS).toBeCloseTo(25.632, 3);
    expect(results[4]).toBeNull(); // not near any road
  });

  it("answers 0 for the origin itself and handles a target listed twice", () => {
    const results = travelTimesToMany(mini, N1, [N1, N3, N3]);
    expect(results[0]).toMatchObject({ durationS: 0, distanceM: 0 });
    expect(results[1]).toEqual(results[2]);
  });

  it("counts the approach from a position that is not on a road, at both ends", () => {
    const near: LatLng = [36.75045, 3.06]; // 50 m north of node 1
    const [result] = travelTimesToMany(mini, near, [N7]);
    const direct = route(mini, near, N7)!;
    expect(result!.durationS).toBeCloseTo(direct.durationS, 9);
    expect(result!.accessM).toBeCloseTo(direct.accessM, 9);
  });

  it("returns only nulls when the origin is not near a road", () => {
    expect(travelTimesToMany(mini, [35.6971, -0.6308], [N1, N3])).toEqual([null, null]);
  });

  it("returns an empty list for no targets", () => {
    expect(travelTimesToMany(mini, N1, [])).toEqual([]);
  });
});

// An independent oracle: all-pairs shortest times by Floyd-Warshall over the same road network,
// using only the spec (length / speed of the class), not the search code.
function floydWarshall(nodeCount: number, edges: [number, number, number, RoadClass, 0 | 1][]) {
  const seconds = Array.from({ length: nodeCount }, (_, i) =>
    Array.from({ length: nodeCount }, (_, j) => (i === j ? 0 : Infinity)),
  );
  for (const [from, to, length, roadClass, oneway] of edges) {
    const cost = length / (THRESHOLDS.routing.speedsKmh[roadClass] / 3.6);
    seconds[from]![to] = Math.min(seconds[from]![to]!, cost);
    if (oneway === 0) seconds[to]![from] = Math.min(seconds[to]![from]!, cost);
  }
  for (let k = 0; k < nodeCount; k++)
    for (let i = 0; i < nodeCount; i++)
      for (let j = 0; j < nodeCount; j++)
        if (seconds[i]![k]! + seconds[k]![j]! < seconds[i]![j]!) seconds[i]![j] = seconds[i]![k]! + seconds[k]![j]!;
  return seconds;
}

describe("A* and Dijkstra agree with an independent all-pairs computation (PRD FR-S2-25)", () => {
  // A random small road network: nodes on a jittered grid (distinct, 100+ m apart), random roads between them.
  const network = fc
    .record({
      nodeCount: fc.integer({ min: 2, max: 9 }),
      jitter: fc.array(fc.tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 60 })), { minLength: 9, maxLength: 9 }),
      roads: fc.array(
        fc.record({
          a: fc.integer({ min: 0, max: 8 }),
          b: fc.integer({ min: 0, max: 8 }),
          roadClass: fc.constantFrom(...ROAD_CLASSES),
          oneway: fc.constantFrom(0, 1) as fc.Arbitrary<0 | 1>,
          detourPercent: fc.integer({ min: 0, max: 60 }),
        }),
        { maxLength: 18 },
      ),
    })
    .map(({ nodeCount, jitter, roads }) => {
      // Positions in 1e-5 degree units; the grid step is 200 units (about 220 m by 180 m).
      const positions: LatLng[] = Array.from({ length: nodeCount }, (_, i) => [
        (3675000 + (i % 3) * 200 + jitter[i]![0]) / 1e5,
        (306000 + Math.floor(i / 3) * 200 + jitter[i]![1]) / 1e5,
      ]);
      const edges = roads
        .filter((r) => r.a < nodeCount && r.b < nodeCount && r.a !== r.b)
        .map((r): [number, number, number, RoadClass, 0 | 1] => {
          const straight = haversineM(...positions[r.a]!, ...positions[r.b]!);
          // Never shorter than the straight line, as a real road.
          return [r.a, r.b, Math.ceil(straight * (1 + r.detourPercent / 100)), r.roadClass, r.oneway];
        });
      return { positions, edges };
    });

  it("route() and travelTimesToMany() give the brute-force shortest time between every pair of nodes", () => {
    fc.assert(
      fc.property(network, ({ positions, edges }) => {
        const graph = loadRoadGraph(assetOf(positions, edges));
        const expected = floydWarshall(positions.length, edges);

        for (let i = 0; i < positions.length; i++) {
          const row = travelTimesToMany(graph, positions[i]!, positions);
          for (let j = 0; j < positions.length; j++) {
            const oracle = expected[i]![j]!;
            const manyResult = row[j];
            const single = route(graph, positions[i]!, positions[j]!);
            if (Number.isFinite(oracle)) {
              expect(manyResult?.durationS).toBeCloseTo(oracle, 6);
              expect(single?.durationS).toBeCloseTo(oracle, 6);
            } else {
              expect(manyResult).toBeNull();
              expect(single).toBeNull();
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
