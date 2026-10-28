import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AppDataSnapshot } from "../../page-data";

export const AppDataContext = createContext<AppDataSnapshot>({});
type ResourceState<T> = { path: string | null; snapshot: AppDataSnapshot; data: T | null; error: string | null; loading: boolean };

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export async function appApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `The operator API returned ${response.status}.`;
    const details = body && typeof body === "object" && "details" in body && body.details && typeof body.details === "object" ? body.details as Record<string, unknown> : undefined;
    throw new ApiError(message, response.status, details);
  }
  return body as T;
}

export function useAppData<T>(path: string | null) {
  const snapshot = useContext(AppDataContext);
  const initial = path ? snapshot[path] : undefined;
  const initialState: ResourceState<T> = { path, snapshot, data: initial?.data as T ?? null, error: initial?.error ?? null, loading: Boolean(path && !initial) };
  const [state, setState] = useState(initialState);
  const [revision, setRevision] = useState(0);
  const previous = useRef({ path, snapshot, revision });

  useEffect(() => {
    const controller = new AbortController();
    const refresh = previous.current.path === path && previous.current.snapshot === snapshot && previous.current.revision !== revision;
    previous.current = { path, snapshot, revision };
    if (!path) {
      setState(initialState);
      return;
    }
    if (initial && !refresh) {
      setState(initialState);
      return;
    }
    setState(current => ({ ...current, path, snapshot, loading: true, error: null }));
    appApi<T>(path, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setState({ path, snapshot, data: next, error: null, loading: false });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "The operator API could not be reached." }));
      });
    return () => controller.abort();
  }, [path, snapshot, revision]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  // Until the effect adopts a new snapshot, show what it is about to set: the snapshot's own read, or, when the snapshot
  // lacks it, the data already shown for this path while it is read again. A new visit never blanks a screen for a render.
  const result = state.path === path && state.snapshot === snapshot ? state
    : path && state.path === path && !initial ? { ...state, loading: true, error: null }
    : initialState;
  return { data: result.data, error: result.error, loading: result.loading, refresh };
}
