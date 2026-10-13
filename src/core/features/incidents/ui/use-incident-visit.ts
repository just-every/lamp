import { useCallback, useLayoutEffect, useRef } from "react";

// Capture authority when work starts, and revoke it at unmount. A fresh visit
// to the same incident (or an effect replay) never revives an old completion.
export function useIncidentVisit() {
  const current = useRef<object | null>(null);
  useLayoutEffect(() => {
    current.current = {};
    return () => { current.current = null; };
  }, []);
  return useCallback(() => {
    const visit = current.current;
    return () => visit !== null && current.current === visit;
  }, []);
}
