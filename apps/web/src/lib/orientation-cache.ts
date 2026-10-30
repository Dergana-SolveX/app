import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { trpc } from "@/utils/trpc";

const KEY = "svx.orientation.v1";

type Cached<T> = { savedAt: number; data: T };

function read<T extends { hospitals: unknown[]; zones: unknown[] }>(scope: string): Cached<T> | null {
  try {
    const raw = window.localStorage.getItem(`${KEY}.${scope}`);
    const parsed = raw ? (JSON.parse(raw) as Cached<T>) : null;
    // Something else, or an older shape, is not worth trusting: ask the server instead.
    return parsed && typeof parsed.savedAt === "number" && Array.isArray(parsed.data?.hospitals) && Array.isArray(parsed.data?.zones)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * The hospitals (capabilities, last-known accept/divert status) and city zones the tablet ranks with.
 * Each successful load is kept in the browser for this ambulance. `fromCache` is true only when the server
 * could not be reached (the load failed, or the browser says it is offline): never just because it is still loading.
 */
export function useOrientationData(scope: string) {
  const query = useQuery({ ...trpc.assessments.orientationData.queryOptions(), retry: false, refetchOnWindowFocus: true });
  type Data = NonNullable<typeof query.data>;
  const [cached] = useState(() => read<Data>(scope));

  useEffect(() => {
    if (!query.data) return;
    try {
      window.localStorage.setItem(
        `${KEY}.${scope}`,
        JSON.stringify({ savedAt: query.dataUpdatedAt, data: query.data } satisfies Cached<Data>),
      );
    } catch {
      // Storage full or blocked: the live data still works.
    }
  }, [query.data, query.dataUpdatedAt, scope]);

  if (query.data) return { data: query.data as Data, savedAt: query.dataUpdatedAt, fromCache: false, loading: false };
  if (cached) {
    const unreachable = query.isError || (typeof navigator !== "undefined" && navigator.onLine === false);
    return { data: cached.data, savedAt: cached.savedAt, fromCache: unreachable, loading: query.isPending };
  }
  return { data: undefined, savedAt: null, fromCache: false, loading: query.isPending };
}
