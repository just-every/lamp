import { useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
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
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function useAppData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    appApi<T>(path)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "The operator API could not be reached.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, revision]);

  return { data, error, loading, refresh: () => setRevision((current) => current + 1) };
}
