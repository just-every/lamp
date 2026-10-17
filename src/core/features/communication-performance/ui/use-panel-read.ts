import { useCallback, useEffect, useRef, useState } from "react";
import { appApi } from "../../../app/client/ui/api";

/** Refreshes only this resource; never invalidates incident/composer page data. */
export function usePanelRead<T>(path: string, publicationKey = "") {
  const element = useRef<HTMLElement>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ path: string; data: T | null; error: string | null; loading: boolean }>({ path, data: null, error: null, loading: true });
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
        if (!disposed) setState({ path, data, error: null, loading: false });
      } catch (cause) {
        if (!disposed && !controller.signal.aborted) setState(current => ({ path, data: current.path === path ? current.data : null, error: cause instanceof Error ? cause.message : "These counts could not be read.", loading: false }));
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
  }, [path, publicationKey, revision]);
  return { element, ...(state.path === path ? state : { data: null, error: null, loading: true }), refresh };
}
