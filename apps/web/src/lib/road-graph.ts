import { loadRoadGraph, type RoadGraph } from "@solvex-dergana/shared";
import { useEffect, useState } from "react";

let loading: Promise<RoadGraph> | undefined;

/** The Algiers road graph, fetched as its own chunk the first time it is needed and then kept in memory. */
export function loadAlgiersGraph(): Promise<RoadGraph> {
  loading ??= import("@solvex-dergana/shared/routing/algiers-asset").then((module) => loadRoadGraph(module.default));
  loading.catch(() => {
    loading = undefined; // try again next time
  });
  return loading;
}

/** `null` while it loads, `"error"` if it could not be loaded. */
export function useRoadGraph(): RoadGraph | null | "error" {
  const [graph, setGraph] = useState<RoadGraph | null | "error">(null);
  useEffect(() => {
    let alive = true;
    loadAlgiersGraph().then(
      (loaded) => alive && setGraph(loaded),
      () => alive && setGraph("error"),
    );
    return () => {
      alive = false;
    };
  }, []);
  return graph;
}
