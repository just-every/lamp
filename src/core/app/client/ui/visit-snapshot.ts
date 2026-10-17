import { useMemo, useRef } from "react";

import type { AppDataSnapshot } from "../../page-data";

// Reads that describe the operator and the page, not one screen.
const SHARED_READS = ["/api/app/session", "/api/app/page-settings", "/api/app/editor-config"];

/**
 * The /app loader's snapshot holds the reads of the visit it was loaded for. The
 * router keeps showing it while the next visit's loader runs, and a navigation
 * that starts meanwhile reuses that load, so a later visit can be handed an
 * earlier visit's snapshot. A snapshot serves only the visit during which it
 * arrived, and only for the path it was loaded for. Any other visit reads its
 * screen from the API, so it never shows what an earlier visit saw.
 */
export function useVisitSnapshot(snapshot: AppDataSnapshot, loadedFor: string, href: string, pathname: string): AppDataSnapshot {
  const visit = useRef({ href, id: 0 });
  if (visit.current.href !== href) visit.current = { href, id: visit.current.id + 1 };
  const arrivals = useRef(new WeakMap<AppDataSnapshot, number>());
  if (!arrivals.current.has(snapshot)) arrivals.current.set(snapshot, visit.current.id);
  const current = arrivals.current.get(snapshot) === visit.current.id && loadedFor === pathname;
  return useMemo(() => current ? snapshot : Object.fromEntries(SHARED_READS.filter((path) => snapshot[path]).map((path) => [path, snapshot[path]])), [snapshot, current]);
}
