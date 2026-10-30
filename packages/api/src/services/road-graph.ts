import { loadRoadGraph, type RoadGraph } from "@solvex-dergana/shared";
import algiersRoads from "@solvex-dergana/shared/routing/algiers-asset";

let graph: RoadGraph | undefined;

/** The committed Algiers road graph, prepared on first use and kept for the life of the server. */
export function algiersRoadGraph(): RoadGraph {
  graph ??= loadRoadGraph(algiersRoads);
  return graph;
}
