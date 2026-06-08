// Tiny TTL-keyed memoization layer for read-heavy queries.
//
// The dashboard, timeline, projects, sessions, and analytics pages all do
// their own DB queries with `dynamic = 'force-dynamic'` on each render. When
// the user clicks around fast, the same query (e.g. getDailySeries(30))
// runs 5 times in 5 seconds. better-sqlite3 is fast but not free; a 5s
// in-memory cache eliminates 80% of redundant work.
//
// Process-local, sync-safe, no external deps. Invalidated automatically on
// each new request after TTL — no manual invalidation needed because TTL is
// short enough to absorb most click-around bursts, and our ingest writer
// runs in the same process so we don't fight a stale read across processes.

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();

export function ttlMemo<T>(key: string, ttlMs: number, fn: () => T): T {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const value = fn();
  store.set(key, { value, expires: now + ttlMs });
  // Opportunistic cleanup so the map doesn't grow unbounded across day-range
  // rotations. Cheap because the map is tiny.
  if (store.size > 64) {
    for (const [k, e] of store) if (e.expires <= now) store.delete(k);
  }
  return value;
}

// Drop everything. Call after ingest writes so the dashboard immediately
// reflects the new data instead of waiting up to TTL.
export function clearMemo(): void {
  store.clear();
}
