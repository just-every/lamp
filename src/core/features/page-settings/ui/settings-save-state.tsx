import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";

export function SettingsSaveState({ phase, error, retry }: {
  phase: "saved" | "waiting" | "saving" | "error"; error: string | null; retry: () => void;
}) {
  return <div className="settings-save-state">
    <p className="settings-save-note" role="status" aria-live="polite">
      {phase === "saved" && <Icon name="check" width={16} height={16} />}
      {phase === "error" ? "Changes kept · not live" : phase === "saving" ? "Saving…" : phase === "waiting" ? "Waiting to save…" : "Saved · live"}
    </p>
    {error && <p className="save-message" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={retry}>Retry</Button></p>}
  </div>;
}
