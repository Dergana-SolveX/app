import { haversineM } from "../geo/distance";
import { THRESHOLDS } from "../thresholds";
import { ROAD_CLASSES, type RoadClass, type RoadGraphAsset } from "./build";
import { MinHeap } from "./heap";
import { decodePolyline, type LatLng } from "./polyline";

/** The road graph ready for searching: directed edges grouped by the node they leave. */
export type RoadGraph = {
  meta: RoadGraphAsset["meta"];
  names: string[];
  lat: Float64Array;
  lng: Float64Array;
  /** Edges leaving node n are numbered outStart[n] to outStart[n + 1] - 1. */
  outStart: Int32Array;
  edgeTo: Int32Array;
  edgeLengthM: Float64Array;
  edgeSeconds: Float64Array;
  edgeClass: Uint8Array;
  edgeName: Int32Array;
  edgeShape: string[];
  /** 1 when the edge is driven against the direction its shape was stored in. */
  edgeReversed: Uint8Array;
  /** The fastest speed any edge can be driven at, in m/s: what keeps the A* estimate from overshooting. */
  maxSpeedMps: number;
};

export type RouteStep = {
  /** The road's name or reference; null for a road without one. */
  name: string | null;
  roadClass: RoadClass;
  distanceM: number;
  durationS: number;
};

export type RouteResult = {
  etaSource: "road";
  durationS: number;
  distanceM: number;
  polyline: LatLng[];
  steps: RouteStep[];
  /** Straight-line metres between the two positions and the road, counted at both ends (already in the totals). */
  accessM: number;
};

const KMH_TO_MPS = 1 / 3.6;

/** How much slower each road class is (2 = twice as slow). Classes that are not listed are not slowed. */
export type RushHour = Partial<Record<RoadClass, number>>;

/** To show next to every road ETA: the times come from road class speeds, never from live traffic. */
export const NO_LIVE_TRAFFIC_NOTICE = "Estimation sans trafic en temps réel : vitesses moyennes par type de route.";

/** Seconds to drive one metre of a road class, slow-down included. */
function secondsPerMetre(roadClass: RoadClass, rushHour: RushHour | undefined): number {
  return (rushHour?.[roadClass] ?? 1) / (THRESHOLDS.routing.speedsKmh[roadClass] * KMH_TO_MPS);
}

/**
 * Prepares the committed asset for searching. `rushHour` slows road classes down (off by default; pass
 * `THRESHOLDS.routing.rushHourMultiplier` for the standard table). There is no live traffic.
 */
export function loadRoadGraph(asset: RoadGraphAsset, { rushHour }: { rushHour?: RushHour } = {}): RoadGraph {
  for (const [roadClass, factor] of Object.entries(rushHour ?? {})) {
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new Error(`Invalid rush-hour multiplier for ${roadClass}: ${factor} (must be a number above 0)`);
    }
  }
  const nodeCount = asset.nodes.length / 2;
  const lat = new Float64Array(nodeCount);
  const lng = new Float64Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    lat[i] = asset.nodes[2 * i]! / 1e5;
    lng[i] = asset.nodes[2 * i + 1]! / 1e5;
  }

  // Directed edges: every road piece forward, and backward too unless it is one-way.
  type Directed = { from: number; to: number; edge: number; reversed: 0 | 1 };
  const directed: Directed[] = [];
  asset.edges.forEach(([from, to, , , , oneway], edge) => {
    directed.push({ from, to, edge, reversed: 0 });
    if (oneway === 0) directed.push({ from: to, to: from, edge, reversed: 1 });
  });
  directed.sort((a, b) => a.from - b.from);

  const m = directed.length;
  const outStart = new Int32Array(nodeCount + 1);
  for (const d of directed) outStart[d.from + 1]!++;
  for (let i = 0; i < nodeCount; i++) outStart[i + 1]! += outStart[i]!;

  const graph: RoadGraph = {
    meta: asset.meta,
    names: asset.names,
    lat,
    lng,
    outStart,
    edgeTo: new Int32Array(m),
    edgeLengthM: new Float64Array(m),
    edgeSeconds: new Float64Array(m),
    edgeClass: new Uint8Array(m),
    edgeName: new Int32Array(m),
    edgeShape: new Array<string>(m),
    edgeReversed: new Uint8Array(m),
    maxSpeedMps: 0,
  };
  directed.forEach((d, i) => {
    const [, , lengthM, classIndex, name, , shape] = asset.edges[d.edge]!;
    const perMetre = secondsPerMetre(ROAD_CLASSES[classIndex]!, rushHour);
    graph.edgeTo[i] = d.to;
    graph.edgeLengthM[i] = lengthM;
    graph.edgeSeconds[i] = lengthM * perMetre;
    graph.edgeClass[i] = classIndex;
    graph.edgeName[i] = name;
    graph.edgeShape[i] = shape;
    graph.edgeReversed[i] = d.reversed;
    graph.maxSpeedMps = Math.max(graph.maxSpeedMps, 1 / perMetre);
  });
  return graph;
}

export type Snapped = { node: number; distanceM: number };

/** The road node nearest to a position, or null when no road is within `maxSnapM`. */
export function snapToGraph(
  graph: RoadGraph,
  [lat, lng]: LatLng,
  maxDistanceM: number = THRESHOLDS.routing.maxSnapM,
): Snapped | null {
  let best: Snapped | null = null;
  for (let node = 0; node < graph.lat.length; node++) {
    const distanceM = haversineM(lat, lng, graph.lat[node]!, graph.lng[node]!);
    if (best === null || distanceM < best.distanceM) best = { node, distanceM };
  }
  return best !== null && best.distanceM <= maxDistanceM ? best : null;
}

type SearchResult = { seconds: Float64Array; arrivedBy: Int32Array; cameFrom: Int32Array };

/**
 * Cheapest-time search from one node. With a `goal` it is A* (guided by the straight-line time to the goal at
 * the fastest possible speed, which never overestimates); with `targets` it is Dijkstra, stopping once every
 * target is settled. Both share this loop, so they can only differ through the guidance.
 */
function search(graph: RoadGraph, source: number, until: { goal: number } | { targets: ReadonlySet<number> }): SearchResult {
  const n = graph.lat.length;
  const seconds = new Float64Array(n).fill(Infinity);
  const arrivedBy = new Int32Array(n).fill(-1);
  const cameFrom = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const goal = "goal" in until ? until.goal : -1;
  const remaining = "targets" in until ? new Set(until.targets) : null;

  const guess = (node: number) =>
    goal < 0
      ? 0
      : haversineM(graph.lat[node]!, graph.lng[node]!, graph.lat[goal]!, graph.lng[goal]!) / graph.maxSpeedMps;

  const heap = new MinHeap();
  seconds[source] = 0;
  heap.push(source, guess(source));

  for (let node = heap.pop(); node !== undefined; node = heap.pop()) {
    if (settled[node]) continue;
    settled[node] = 1;
    if (node === goal) break;
    if (remaining) {
      remaining.delete(node);
      if (remaining.size === 0) break;
    }
    for (let e = graph.outStart[node]!; e < graph.outStart[node + 1]!; e++) {
      const next = graph.edgeTo[e]!;
      const total = seconds[node]! + graph.edgeSeconds[e]!;
      if (total < seconds[next]!) {
        seconds[next] = total;
        arrivedBy[next] = e;
        cameFrom[next] = node;
        heap.push(next, total + guess(next));
      }
    }
  }
  return { seconds, arrivedBy, cameFrom };
}

/** The edges driven to reach `node`, in order. */
function pathTo({ arrivedBy, cameFrom }: SearchResult, source: number, node: number): number[] {
  const edges: number[] = [];
  for (let at = node; at !== source; at = cameFrom[at]!) edges.push(arrivedBy[at]!);
  return edges.reverse();
}

/** The bends of a directed edge in the direction it is driven. */
function bendsOf(graph: RoadGraph, edge: number): LatLng[] {
  const bends = decodePolyline(graph.edgeShape[edge]!);
  return graph.edgeReversed[edge] ? bends.reverse() : bends;
}

/** The fastest road route between two positions. Null when either is off the graph or no route exists. */
export function route(graph: RoadGraph, from: LatLng, to: LatLng): RouteResult | null {
  const start = snapToGraph(graph, from);
  const end = snapToGraph(graph, to);
  if (start === null || end === null) return null;

  const found = search(graph, start.node, { goal: end.node });
  const { seconds } = found;
  if (!Number.isFinite(seconds[end.node]!)) return null;

  const edges = pathTo(found, start.node, end.node);

  const polyline: LatLng[] = [from, [graph.lat[start.node]!, graph.lng[start.node]!]];
  const steps: RouteStep[] = [];
  let distanceM = 0;
  for (const e of edges) {
    polyline.push(...bendsOf(graph, e), [graph.lat[graph.edgeTo[e]!]!, graph.lng[graph.edgeTo[e]!]!]);
    const name = graph.edgeName[e]! >= 0 ? graph.names[graph.edgeName[e]!]! : null;
    const roadClass = ROAD_CLASSES[graph.edgeClass[e]!]!;
    const last = steps[steps.length - 1];
    if (last && last.name === name && last.roadClass === roadClass) {
      last.distanceM += graph.edgeLengthM[e]!;
      last.durationS += graph.edgeSeconds[e]!;
    } else {
      steps.push({ name, roadClass, distanceM: graph.edgeLengthM[e]!, durationS: graph.edgeSeconds[e]! });
    }
    distanceM += graph.edgeLengthM[e]!;
  }
  polyline.push(to);

  // Drop repeated points (a position that sits exactly on a node).
  const shape = polyline.filter((p, i) => i === 0 || p[0] !== polyline[i - 1]![0] || p[1] !== polyline[i - 1]![1]);

  // The legs between the given positions and the road count as straight lines (x1.4), driven at the link speed.
  const accessM = start.distanceM + end.distanceM;
  const approachM = accessM * THRESHOLDS.routing.straightLine.roadFactor;
  const approachS = approachM / (THRESHOLDS.routing.speedsKmh.link * KMH_TO_MPS);
  return {
    etaSource: "road",
    durationS: seconds[end.node]! + approachS,
    distanceM: distanceM + approachM,
    polyline: shape,
    steps,
    accessM,
  };
}

export type RoadEta = {
  etaSource: "road";
  durationS: number;
  distanceM: number;
  /** Straight-line metres between the two positions and the road (already in the totals). */
  accessM: number;
};

/**
 * Road times from one position to many (PRD FR-S2-22: all the hospitals in a single pass).
 * The answers come in the order of `targets`; null where a target is off the graph or cannot be reached.
 */
export function travelTimesToMany(graph: RoadGraph, from: LatLng, targets: readonly LatLng[]): (RoadEta | null)[] {
  const start = snapToGraph(graph, from);
  const snapped = targets.map((target) => (start === null ? null : snapToGraph(graph, target)));
  if (start === null) return targets.map(() => null);

  const wanted = new Set(snapped.flatMap((s) => (s ? [s.node] : [])));
  if (wanted.size === 0) return targets.map(() => null);
  const found = search(graph, start.node, { targets: wanted });

  const { roadFactor } = THRESHOLDS.routing.straightLine;
  const linkMps = THRESHOLDS.routing.speedsKmh.link * KMH_TO_MPS;
  return snapped.map((end) => {
    if (end === null || !Number.isFinite(found.seconds[end.node]!)) return null;
    let roadM = 0;
    for (const e of pathTo(found, start.node, end.node)) roadM += graph.edgeLengthM[e]!;
    const accessM = start.distanceM + end.distanceM;
    return {
      etaSource: "road" as const,
      durationS: found.seconds[end.node]! + (accessM * roadFactor) / linkMps,
      distanceM: roadM + accessM * roadFactor,
      accessM,
    };
  });
}
