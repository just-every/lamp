import { formatTime } from "../../../features/public-snapshot/format";
import { Icon } from "./icon";
import { usePageTimezone } from "./timezone";
import type { ReactNode } from "react";

// Plain states with no art, safe for modules the server bundle also reaches (session/index.ts re-exports the
// operators panel). The states that draw the lamp are in lit-states.tsx.
export function LoadingState({ children = "Loading current records…" }: { children?: ReactNode }) {
  return <div className="app-state app-state-loading" role="status">{children}</div>;
}

// A failure inside a working page or form (a save that failed, an invalid value): a small inline note.
export function FormError({ children }: { children: ReactNode }) {
  return <div className="form-note" role="alert"><Icon name="warning" /><span>{children}</span></div>;
}

export function formatOperatorTime(iso: string | null, timezone: string) {
  return iso ? formatTime(iso, timezone) : "Not yet";
}

export function useOperatorTime() {
  const timezone = usePageTimezone();
  return (iso: string | null) => formatOperatorTime(iso, timezone);
}
