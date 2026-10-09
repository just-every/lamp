import type { ReactNode } from "react";

export function LoadingState({ children = "Loading current records…" }: { children?: ReactNode }) {
  return <div className="app-state" role="status">{children}</div>;
}

export function ErrorState({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <div className="app-state app-state-error" role="alert"><span>{children}</span>{onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Reload page</button>}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="app-state app-state-empty">{children}</div>;
}

export function formatOperatorTime(iso: string | null, timezone?: string) {
  if (!iso) return "Not recorded";
  const instant = new Date(iso);
  if (!Number.isFinite(instant.getTime())) throw new Error(`Lamp received an invalid persisted timestamp: ${iso}`);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(instant);
}
