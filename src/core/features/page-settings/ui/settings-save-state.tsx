import { useEffect, useRef } from "react";
import { ApiError } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";

export type SavePhase = "saved" | "waiting" | "saving" | "error";

// A refusal from the server already reads plainly; a lost connection or a server fault does not.
export const saveFailureReason = (cause: unknown) => cause instanceof ApiError ? cause.status >= 500 ? "The server had a problem saving it." : cause.message : "The server could not be reached.";

/** A card that saves on its own tells the pane's one save note its phase as it changes, and nothing once it closes. */
export function useReportPhase(onPhase: (phase: SavePhase) => void, phase: SavePhase) {
  const report = useRef(onPhase);
  report.current = onPhase;
  useEffect(() => { report.current(phase); }, [phase]);
  useEffect(() => () => { report.current("saved"); }, []);
}

export function SettingsSaveState({ phase, error, retry }: {
  phase: SavePhase; error: string | null; retry: () => void;
}) {
  return <div className="settings-save-state">
    <p className="settings-save-note" role="status" aria-live="polite">
      {phase === "saved" && <Icon name="check" width={16} height={16} />}
      {phase === "error" ? "Changes kept · not live" : phase === "saving" ? "Saving…" : phase === "waiting" ? "Waiting to save…" : "Saved · live"}
    </p>
    {error && <p className="save-message" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>}
  </div>;
}
