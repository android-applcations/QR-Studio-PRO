import { useEffect, useState } from "react";
import { getLogoDataUrl } from "../db/db";

/** Resolves logo asset ids to data URLs (cached in the db layer). */
export function useLogoMap(ids: (number | null | undefined)[]): Record<number, string> {
  const [map, setMap] = useState<Record<number, string>>({});
  const key = [...new Set(ids.filter((x): x is number => typeof x === "number"))].sort().join(",");
  useEffect(() => {
    let alive = true;
    const list = key ? key.split(",").map(Number) : [];
    Promise.all(list.map(async (id) => [id, await getLogoDataUrl(id).catch(() => null)] as const)).then((rows) => {
      if (!alive) return;
      const next: Record<number, string> = {};
      for (const [id, url] of rows) if (url) next[id] = url;
      setMap(next);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

/** Loads async data and reloads whenever `version` changes. */
export function useAsyncList<T>(loader: () => Promise<T[]>, version: number): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    loader()
      .then((r) => alive && setData(r))
      .catch(() => alive && setData([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { data, loading };
}
