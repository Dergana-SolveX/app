import { describe, expect, it } from "vitest";

import { buildRoadGraph, ROAD_CLASSES, type OverpassData, type OverpassWay } from "./build";
import { encodePolyline } from "./polyline";
import { MINI_OSM } from "./testing/mini-osm";

const BBOX: [number, number, number, number] = [36.6, 2.8, 36.85, 3.55];

describe("buildRoadGraph (OpenStreetMap -> compact graph)", () => {
  const asset = buildRoadGraph(MINI_OSM, { bbox: BBOX });

  it("records where the data comes from, its licence and its date", () => {
    expect(asset.meta).toMatchObject({
      source: "OpenStreetMap",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      osmTimestamp: "2026-10-30T12:57:25Z",
      bbox: BBOX,
    });
  });

  it("keeps only junctions and road ends as nodes, in 1e-5 degree units", () => {
    // Nodes 1, 2, 3, 5, 6, 7, 8. Node 4 is only a bend, node 9 belongs to a road we ignore.
    expect(asset.nodes).toEqual([
      3675000, 306000, // 1
      3675000, 306200, // 2
      3675000, 306400, // 3
      3675200, 306400, // 5
      3674900, 306200, // 6
      3675000, 306600, // 7
      3675000, 306800, // 8
    ]);
  });

  it("splits roads at junctions and records class, name, direction and shape of each piece", () => {
    expect(asset.names).toEqual(["Rue A", "Rue B (R12)", "Rue C"]);

    // [from, to, length in metres, class, name (-1: none), one-way (1: from -> to only), bends]
    expect(asset.edges).toEqual([
      [0, 1, 178, ROAD_CLASSES.indexOf("primary"), 0, 0, ""], // Rue A, 1 -> 2, two-way
      [1, 2, 178, ROAD_CLASSES.indexOf("primary"), 0, 0, ""], // Rue A, 2 -> 3, split at the junction
      [2, 3, 222, ROAD_CLASSES.indexOf("secondary"), 1, 1, encodePolyline([[36.751, 3.064]])], // bend kept as shape
      [1, 4, 111, ROAD_CLASSES.indexOf("link"), -1, 1, ""], // motorway_link: one-way implied
      [2, 5, 178, ROAD_CLASSES.indexOf("motorway"), -1, 1, ""], // motorway: one-way implied
      [6, 5, 178, ROAD_CLASSES.indexOf("tertiary"), 2, 1, ""], // oneway=-1: stored in the direction of travel, 8 -> 7
    ]);
  });
});

const way = (id: number, tags: Record<string, string>, points: [number, number][], nodes?: number[]): OverpassWay => ({
  type: "way",
  id,
  nodes: nodes ?? points.map((_, i) => id * 100 + i),
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
  tags,
});
const data = (...ways: OverpassWay[]): OverpassData => ({
  osm3s: { timestamp_osm_base: "2026-01-01T00:00:00Z" },
  elements: ways,
});

describe("buildRoadGraph: direction of travel", () => {
  const A: [number, number] = [36.75, 3.06];
  const B: [number, number] = [36.75, 3.061];

  it.each([
    ["yes", 1],
    ["true", 1],
    ["1", 1],
    ["no", 0],
    ["false", 0],
    ["0", 0],
  ])("reads oneway=%s as direction %i for a primary road", (value, expected) => {
    const asset = buildRoadGraph(data(way(1, { highway: "primary", oneway: value }, [A, B])), { bbox: [0, 0, 0, 0] });
    expect(asset.edges[0]?.[5]).toBe(expected);
  });

  it("treats a motorway as one-way unless the data says otherwise", () => {
    const implied = buildRoadGraph(data(way(1, { highway: "motorway" }, [A, B])), { bbox: [0, 0, 0, 0] });
    expect(implied.edges[0]?.[5]).toBe(1);
    const explicit = buildRoadGraph(data(way(1, { highway: "motorway", oneway: "no" }, [A, B])), { bbox: [0, 0, 0, 0] });
    expect(explicit.edges[0]?.[5]).toBe(0);
  });

  it("stores a road that runs against its drawing direction from its last node to its first, bends reversed", () => {
    const bend: [number, number] = [36.7505, 3.0605];
    const asset = buildRoadGraph(data(way(1, { highway: "secondary", oneway: "-1" }, [A, bend, B])), {
      bbox: [0, 0, 0, 0],
    });
    // Nodes are numbered in the order they are met: A is 0, B is 1. Traffic runs B -> A.
    expect(asset.edges[0]).toEqual([1, 0, expect.any(Number), ROAD_CLASSES.indexOf("secondary"), -1, 1, encodePolyline([bend])]);
  });

  it("treats a roundabout as one-way, and a ring that closes on itself as a single edge", () => {
    const ring = [A, [36.7502, 3.0603], [36.7504, 3.0601], A] as [number, number][];
    const asset = buildRoadGraph(
      data(way(7, { highway: "tertiary", junction: "roundabout" }, ring, [1, 2, 3, 1])),
      { bbox: [0, 0, 0, 0] },
    );
    expect(asset.nodes).toHaveLength(2); // a single junction: where the ring closes
    expect(asset.edges).toHaveLength(1);
    expect(asset.edges[0]).toMatchObject({ 0: 0, 1: 0, 5: 1 });
    expect(asset.edges[0]?.[6]).toBe(encodePolyline([ring[1]!, ring[2]!]));
  });
});

describe("buildRoadGraph: classes, names and the data around them", () => {
  const A: [number, number] = [36.75, 3.06];
  const B: [number, number] = [36.75, 3.061];
  const build = (tags: Record<string, string>) =>
    buildRoadGraph(data(way(1, tags, [A, B])), { bbox: [0, 0, 0, 0] });

  it.each([
    ["motorway", "motorway"],
    ["trunk", "trunk"],
    ["primary", "primary"],
    ["secondary", "secondary"],
    ["tertiary", "tertiary"],
    ["motorway_link", "link"],
    ["trunk_link", "link"],
    ["primary_link", "link"],
    ["secondary_link", "link"],
    ["tertiary_link", "link"],
  ])("maps highway=%s to the class %s", (highway, roadClass) => {
    expect(build({ highway }).edges[0]?.[3]).toBe(ROAD_CLASSES.indexOf(roadClass as (typeof ROAD_CLASSES)[number]));
  });

  it.each(["residential", "service", "unclassified", "footway", "track", "living_street"])(
    "ignores highway=%s",
    (highway) => {
      const asset = build({ highway });
      expect(asset.edges).toEqual([]);
      expect(asset.nodes).toEqual([]);
      expect(asset.names).toEqual([]);
    },
  );

  it("names a road by its name, its reference, or both", () => {
    expect(build({ highway: "primary", name: "Rue D" }).names).toEqual(["Rue D"]);
    expect(build({ highway: "primary", ref: "N5" }).names).toEqual(["N5"]);
    expect(build({ highway: "primary", name: "Autoroute Est-Ouest", ref: "A1" }).names).toEqual(["Autoroute Est-Ouest (A1)"]);
    expect(build({ highway: "primary" }).edges[0]?.[4]).toBe(-1);
  });

  it("gives roads that share a name the same name entry", () => {
    const asset = buildRoadGraph(
      data(way(1, { highway: "primary", name: "Rue D" }, [A, B]), way(2, { highway: "primary", name: "Rue D" }, [B, [36.75, 3.062]])),
      { bbox: [0, 0, 0, 0] },
    );
    expect(asset.names).toEqual(["Rue D"]);
    expect(asset.edges.map((e) => e[4])).toEqual([0, 0]);
  });

  it("copes with a data set that has no timestamp, no roads and non-way elements", () => {
    const asset = buildRoadGraph({ elements: [{ type: "node" }, { type: "relation" }] }, { bbox: [1, 2, 3, 4] });
    expect(asset).toEqual({
      meta: { source: "OpenStreetMap", license: "ODbL 1.0", attribution: "© OpenStreetMap contributors", osmTimestamp: "unknown", bbox: [1, 2, 3, 4] },
      names: [],
      nodes: [],
      edges: [],
    });
  });
});
