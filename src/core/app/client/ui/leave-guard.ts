import { useEffect, useRef } from "react";

// A page holding unsaved work answers before the operator signs out; false keeps them where they are.
const guards = new Set<{ current: () => Promise<boolean> }>();

export function useLeaveGuard(guard: () => Promise<boolean>) {
  const latest = useRef(guard);
  latest.current = guard;
  useEffect(() => {
    guards.add(latest);
    return () => { guards.delete(latest); };
  }, []);
}

export async function mayLeave() {
  for (const guard of guards) if (!await guard.current()) return false;
  return true;
}
