import { haversineM } from "../geo/distance";
import { encodePolyline, type LatLng } from "./polyline";

/** Road classes kept in the graph. Every `*_link` road is the class "link". */
export const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "link"] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

/** The part of an Overpass API JSON answer (`out geom`) that we read. */
export type OverpassWay = {
  type: "way";
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};
export type OverpassData = {
  osm3s?: { timestamp_osm_base?: string };
  elements: (OverpassWay | { type: string })[];
};

/** [from node, to node, length in metres, class, name (-1: none), one-way (1: from -> to only), bends]. */
export type RoadEdge = [number, number, number, number, number, 0 | 1, string];

/**
 * The compact road graph that is committed to the repository and loaded by the app.
 * Nodes are junctions and road ends only; the bends of a road are kept as an encoded shape on its edge.
 */
export type RoadGraphAsset = {
  meta: {
    source: "OpenStreetMap";
    license: "ODbL 1.0";
    attribution: "© OpenStreetMap contributors";
    /** When the OpenStreetMap data was current (as reported by the Overpass API). */
    osmTimestamp: string;
    /** [south, west, north, east] of the area that was downloaded. */
    bbox: [number, number, number, number];
  };
  /** Road names, referenced by index from the edges. */
  names: string[];
  /** Flat list [lat, lng, lat, lng, ...] in units of 1e-5 degrees (about 1 m). */
  nodes: number[];
  edges: RoadEdge[];
};

function classOf(highway: string | undefined): number {
  if (highway === undefined) return -1;
  if (highway.endsWith("_link")) return ROAD_CLASSES.indexOf("link");
  return (ROAD_CLASSES as readonly string[]).indexOf(highway);
}

/** 1: only from the first to the last node, -1: only the other way, 0: both ways. */
function directionOf(tags: Record<string, string>, roadClass: number): 0 | 1 | -1 {
  const oneway = tags.oneway;
  if (oneway === "yes" || oneway === "true" || oneway === "1") return 1;
  if (oneway === "-1" || oneway === "reverse") return -1;
  if (oneway === "no" || oneway === "false" || oneway === "0") return 0;
  const implied =
    roadClass === ROAD_CLASSES.indexOf("motorway") ||
    tags.highway === "motorway_link" ||
    tags.junction === "roundabout" ||
    tags.junction === "circular";
  return implied ? 1 : 0;
}

const labelOf = (tags: Record<string, string>) =>
  tags.name && tags.ref ? `${tags.name} (${tags.ref})` : (tags.name ?? tags.ref ?? null);

/** Turns an Overpass answer into the compact graph: wanted road classes only, split at junctions. */
export function buildRoadGraph(
  osm: OverpassData,
  { bbox }: { bbox: [number, number, number, number] },
): RoadGraphAsset {
  const ways = osm.elements.filter(
    (e): e is OverpassWay =>
      e.type === "way" &&
      classOf((e as OverpassWay).tags?.highway) >= 0 &&
      (e as OverpassWay).nodes.length >= 2,
  );

  // A node is a junction when roads meet there or a road ends there.
  const uses = new Map<number, number>();
  for (const way of ways) for (const id of way.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  const isJunction = (way: OverpassWay, i: number) =>
    i === 0 || i === way.nodes.length - 1 || (uses.get(way.nodes[i]!) ?? 0) >= 2;

  const nodes: number[] = [];
  const nodeIndex = new Map<number, number>();
  const indexOf = (way: OverpassWay, i: number) => {
    const id = way.nodes[i]!;
    let index = nodeIndex.get(id);
    if (index === undefined) {
      index = nodes.length / 2;
      nodeIndex.set(id, index);
      const { lat, lon } = way.geometry[i]!;
      nodes.push(Math.round(lat * 1e5), Math.round(lon * 1e5));
    }
    return index;
  };

  const names: string[] = [];
  const nameIndex = (label: string | null) => {
    if (label === null) return -1;
    let index = names.indexOf(label);
    if (index < 0) index = names.push(label) - 1;
    return index;
  };

  const edges: RoadEdge[] = [];
  for (const way of ways) {
    const tags = way.tags!;
    const roadClass = classOf(tags.highway);
    const direction = directionOf(tags, roadClass);
    const name = nameIndex(labelOf(tags));

    let start = 0;
    for (let i = 1; i < way.nodes.length; i++) {
      if (!isJunction(way, i)) continue;
      let lengthM = 0;
      const bends: LatLng[] = [];
      for (let k = start + 1; k <= i; k++) {
        const a = way.geometry[k - 1]!;
        const b = way.geometry[k]!;
        lengthM += haversineM(a.lat, a.lon, b.lat, b.lon);
        if (k < i) bends.push([b.lat, b.lon]);
      }
      const from = indexOf(way, start);
      const to = indexOf(way, i);
      if (direction === -1) {
        edges.push([to, from, Math.round(lengthM), roadClass, name, 1, encodePolyline(bends.reverse())]);
      } else {
        edges.push([from, to, Math.round(lengthM), roadClass, name, direction, encodePolyline(bends)]);
      }
      start = i;
    }
  }

  return {
    meta: {
      source: "OpenStreetMap",
      license: "ODbL 1.0",
      attribution: "© OpenStreetMap contributors",
      osmTimestamp: osm.osm3s?.timestamp_osm_base ?? "unknown",
      bbox,
    },
    names,
    nodes,
    edges,
  };
}
