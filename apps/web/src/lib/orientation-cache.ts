import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { trpc } from "@/utils/trpc";

const KEY = "svx.orientation.v1";

type Cached<T> = { savedAt: number; data: T };

function read<T>(): Cached<T> | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

/**
 * The hospitals (capabilities, last-known accept/divert status) and city zones the tablet ranks with.
 * Each successful load is kept in the browser; with no network, the last one is used and `fromCache` says so.
 */
export function useOrientationData() {
  const query = useQuery({ ...trpc.assessments.orientationData.queryOptions(), retry: false, refetchOnWindowFocus: true });
  type Data = NonNullable<typeof query.data>;
  const [cached] = useState(() => read<Data>());

  useEffect(() => {
    if (!query.data) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), data: query.data } satisfies Cached<Data>));
    } catch {
      // Storage full or blocked: the live data still works.
    }
  }, [query.data]);

  if (query.data) return { data: query.data as Data, savedAt: Date.now(), fromCache: false, loading: false };
  if (cached) return { data: cached.data, savedAt: cached.savedAt, fromCache: true, loading: query.isPending };
  return { data: undefined, savedAt: null, fromCache: false, loading: query.isPending };
}
