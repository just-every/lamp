import { useEffect, useRef } from "react";
import { ApiError } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";

export type SavePhase = "saved" | "waiting" | "saving" | "error";
/** A save that failed, with the way to try it again; the note beside it says only that changes are kept. */
export type SaveFailure = { error: string; retry: () => void };
/** What a card that saves on its own tells the tab's one save note. */
export type CardSave = { phase: SavePhase; error: string | null; retry: () => void };

// A refusal from the server already reads plainly; a lost connection or a server fault does not.
export const saveFailureReason = (cause: unknown) => cause instanceof ApiError ? cause.status >= 500 ? "The server had a problem saving it." : cause.message : "The server could not be reached.";

/** A card reports its phase, failure and Retry through `onSave` as they change, so the tab's one note follows its writes. */
export function useReportSave(onSave: (save: CardSave) => void, phase: SavePhase, error: string | null, retry: () => void) {
  const latest = useRef({ onSave, retry });
  latest.current = { onSave, retry };
  useEffect(() => latest.current.onSave({ phase, error, retry: () => latest.current.retry() }), [phase, error]);
}

export function SettingsSaveState({ phase, failures }: { phase: SavePhase; failures: SaveFailure[] }) {
  return <div className="settings-save-state">
    <p className="settings-save-note" role="status" aria-live="polite">
      {phase === "saved" && <Icon name="check" width={16} height={16} />}
      {phase === "error" ? "Changes kept · not live" : phase === "saving" ? "Saving…" : phase === "waiting" ? "Waiting to save…" : "Saved · live"}
    </p>
    {failures.map(({ error, retry }) => <p className="save-message" role="alert" key={error}>{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>)}
  </div>;
}
