import { describe, expect, it } from "vitest";

import { buildRoadGraph } from "./build";
import { loadRoadGraph, route } from "./route";
import { assetOf } from "./testing/graphs";
import { MINI_OSM } from "./testing/mini-osm";

const graph = loadRoadGraph(buildRoadGraph(MINI_OSM, { bbox: [36.6, 2.8, 36.85, 3.55] }));

// Node positions of the fixture (see testing/mini-osm.ts).
const N1: [number, number] = [36.75, 3.06];
const N3: [number, number] = [36.75, 3.064];
const N5: [number, number] = [36.752, 3.064];
const N7: [number, number] = [36.75, 3.066];
const N8: [number, number] = [36.75, 3.068];

describe("route (A*)", () => {
  it("finds the fastest road route with its time, distance, shape and steps", () => {
    // Worked out by hand: 2 x 178 m of primary road at 50 km/h (12.816 s each) + 178 m of motorway at 90 km/h (7.12 s).
    const result = route(graph, N1, N7);

    expect(result).not.toBeNull();
    expect(result!.etaSource).toBe("road");
    expect(result!.durationS).toBeCloseTo(32.752, 3);
    expect(result!.distanceM).toBe(534);
    expect(result!.polyline).toEqual([
      [36.75, 3.06],
      [36.75, 3.062],
      [36.75, 3.064],
      [36.75, 3.066],
    ]);
    expect(result!.steps).toEqual([
      { name: "Rue A", roadClass: "primary", distanceM: 356, durationS: expect.closeTo(25.632, 3) },
      { name: null, roadClass: "motorway", distanceM: 178, durationS: expect.closeTo(7.12, 3) },
    ]);
  });

  it("respects one-way roads: you can drive the secondary road 3 -> 5 but not back", () => {
    const there = route(graph, N3, N5);
    expect(there).not.toBeNull();
    expect(there!.durationS).toBeCloseTo(222 / (40 / 3.6), 3); // 222 m at 40 km/h
    expect(there!.polyline).toEqual([N3, [36.751, 3.064], N5]); // the bend is part of the route
    expect(there!.steps).toEqual([
      { name: "Rue B (R12)", roadClass: "secondary", distanceM: 222, durationS: expect.closeTo(19.98, 3) },
    ]);
    expect(route(graph, N5, N3)).toBeNull();
  });

  it("respects the direction of a road drawn against its traffic (oneway=-1: 8 -> 7 only)", () => {
    expect(route(graph, N8, N7)).not.toBeNull();
    expect(route(graph, N7, N8)).toBeNull();
    expect(route(graph, N1, N8)).toBeNull(); // 8 can only be left, never reached
  });

  it("drives a two-way road in both directions, with the shape reversed", () => {
    const back = route(graph, N3, N1);
    expect(back!.durationS).toBeCloseTo(25.632, 3);
    expect(back!.polyline).toEqual([N3, [36.75, 3.062], N1]);
  });

  it("adds the straight-line approach when a position is not exactly on a road (x1.4, at the link speed)", () => {
    // 0.00045 degrees of latitude is 50.04 m north of node 1.
    const offRoad: [number, number] = [36.75045, 3.06];
    const result = route(graph, offRoad, N7);
    const approachM = 50.0378; // 0.00045 deg * 111195.08 m
    expect(result!.accessM).toBeCloseTo(approachM, 1);
    expect(result!.distanceM).toBeCloseTo(534 + approachM * 1.4, 1);
    expect(result!.durationS).toBeCloseTo(32.752 + (approachM * 1.4) / (30 / 3.6), 2);
    expect(result!.polyline[0]).toEqual(offRoad);
    expect(result!.polyline[1]).toEqual(N1);
  });

  it("returns null for a position that is not near any road (the caller falls back to a straight-line estimate)", () => {
    expect(route(graph, [35.6971, -0.6308], N1)).toBeNull(); // Oran
    expect(route(graph, N1, [36.9, 3.06])).toBeNull(); // 16 km north of the fixture
  });
});

describe("route: fastest, not shortest, and the optional rush-hour slow-down", () => {
  // From node 0 to node 1: a direct 1000 m tertiary road (35 km/h), or 1400 m of motorway via node 2 (90 km/h).
  // Straight-line distances are 990 m and 662 m + 662 m, so both lengths are realistic.
  const nodes: [number, number][] = [
    [36.7, 3.0],
    [36.7, 3.011],
    [36.704, 3.0055],
  ];
  const edges: [number, number, number, "tertiary" | "motorway"][] = [
    [0, 1, 1000, "tertiary"],
    [0, 2, 700, "motorway"],
    [2, 1, 700, "motorway"],
  ];

  it("takes the longer motorway route because it is faster", () => {
    const g = loadRoadGraph(assetOf(nodes, edges));
    const result = route(g, nodes[0]!, nodes[1]!);
    expect(result!.distanceM).toBe(1400);
    expect(result!.durationS).toBeCloseTo(1400 / 25, 6); // 90 km/h is 25 m/s: 56 s, against 102.9 s for the direct road
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]).toMatchObject({ roadClass: "motorway", distanceM: 1400 });
  });

  it("applies a per-class slow-down only when asked, and the route can change because of it", () => {
    const off = loadRoadGraph(assetOf(nodes, edges));
    const on = loadRoadGraph(assetOf(nodes, edges), { rushHour: { motorway: 2.5 } }); // motorway at 36 km/h
    expect(route(off, nodes[0]!, nodes[1]!)!.durationS).toBeCloseTo(56, 6);
    // 1400 m at 90 km/h / 2.5 = 140 s, so the direct tertiary road (1000 m at 35 km/h = 102.857 s) wins now.
    const rush = route(on, nodes[0]!, nodes[1]!);
    expect(rush!.distanceM).toBe(1000);
    expect(rush!.durationS).toBeCloseTo(1000 / (35 / 3.6), 6);
  });

  it("leaves the classes that are not listed at their normal speed", () => {
    const g = loadRoadGraph(assetOf(nodes, edges), { rushHour: { tertiary: 3 } });
    expect(route(g, nodes[0]!, nodes[1]!)!.durationS).toBeCloseTo(56, 6);
  });
});

describe("route: a two-way road with bends is drawn correctly in both directions", () => {
  const A: [number, number] = [36.75, 3.06];
  const BEND1: [number, number] = [36.7505, 3.0605];
  const BEND2: [number, number] = [36.7503, 3.0612];
  const B: [number, number] = [36.75, 3.062];
  const bendy = loadRoadGraph(
    buildRoadGraph(
      {
        elements: [
          { type: "way", id: 1, nodes: [1, 2, 3, 4], geometry: [A, BEND1, BEND2, B].map(([lat, lon]) => ({ lat, lon })), tags: { highway: "tertiary" } },
        ],
      },
      { bbox: [0, 0, 0, 0] },
    ),
  );

  it("follows the bends from one end to the other", () => {
    expect(route(bendy, A, B)!.polyline).toEqual([A, BEND1, BEND2, B]);
  });

  it("follows the same bends in the opposite order when driven the other way", () => {
    expect(route(bendy, B, A)!.polyline).toEqual([B, BEND2, BEND1, A]);
  });
});
