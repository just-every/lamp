import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { appApi, AppDataContext } from "../../../app/client/ui/api";

/** Refreshes only this resource; never invalidates incident/composer page data. */
export function usePanelRead<T>(path: string, publicationKey = "") {
  const snapshot = useContext(AppDataContext);
  const initial = snapshot[path];
  const initialState = { path, snapshot, data: initial?.error ? null : initial?.data as T ?? null, error: initial?.error ?? null, loading: !initial };
  const element = useRef<HTMLElement>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ path: string; snapshot: typeof snapshot; data: T | null; error: string | null; loading: boolean }>(initialState);
  const refresh = useCallback(() => setRevision(current => current + 1), []);
  useEffect(() => {
    let disposed = false, intersecting = false, inFlight = false;
    let controller: AbortController | null = null;
    const read = async () => {
      if (disposed || !intersecting || document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      try {
        const data = await appApi<T>(path, { signal: controller.signal });
        if (!disposed) setState({ path, snapshot, data, error: null, loading: false });
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) setState(current => ({ path, snapshot, data: current.path === path && current.snapshot === snapshot ? current.data : initialState.data, error: cause instanceof Error ? cause.message : "These counts could not be read.", loading: false }));
      } finally { inFlight = false; }
    };
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting);
      if (intersecting) void read();
    });
    if (element.current) observer.observe(element.current);
    const onVisibility = () => { if (document.visibilityState === "visible") void read(); };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => void read(), 15000);
    return () => { disposed = true; controller?.abort(); observer.disconnect(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [path, publicationKey, revision, snapshot]);
  return { element, ...(state.path === path && state.snapshot === snapshot ? state : initialState), refresh };
}
