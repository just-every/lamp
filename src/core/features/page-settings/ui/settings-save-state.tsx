import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";

/** A save that failed, with the way to try it again; the note beside it says only that changes are kept. */
export type SaveFailure = { error: string; retry: () => void };

export function SettingsSaveState({ phase, failures }: {
  phase: "saved" | "waiting" | "saving" | "error"; failures: SaveFailure[];
}) {
  return <div className="settings-save-state">
    <p className="settings-save-note" role="status" aria-live="polite">
      {phase === "saved" && <Icon name="check" width={16} height={16} />}
      {phase === "error" ? "Changes kept · not live" : phase === "saving" ? "Saving…" : phase === "waiting" ? "Waiting to save…" : "Saved · live"}
    </p>
    {failures.map(({ error, retry }) => <p className="save-message" role="alert" key={error}>{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>)}
  </div>;
}

/** The quiet word a card that saves as it changes shows once its write has landed. */
export function CardSaveNote({ saving, saved }: { saving: boolean; saved: boolean }) {
  if (!saving && !saved) return null;
  return <p className="settings-save-note" role="status">
    {saved && !saving && <Icon name="check" width={16} height={16} />}
    {saving ? "Saving…" : "Saved"}
  </p>;
}
