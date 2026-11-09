import { useEffect, useRef, useState } from "react";
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

/**
 * Loads async data and reloads whenever `version` changes.
 *
 * Two reads can be in flight at once when something writes twice quickly (an
 * autosave that lands while the list is still loading, for instance), and they
 * do not come back in the order they were asked for. Without the ticket below,
 * the slower older read lands last and the screen shows stale rows over fresh
 * ones. Only the newest read is allowed to write state.
 */
export function useAsyncList<T>(loader: () => Promise<T[]>, version: number): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  useEffect(() => {
    const mine = ++ticket.current;
    setLoading(true);
    loader()
      .then((r) => {
        if (mine === ticket.current) setData(r);
      })
      .catch(() => {
        if (mine === ticket.current) setData([]);
      })
      .finally(() => {
        if (mine === ticket.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  return { data, loading };
}
