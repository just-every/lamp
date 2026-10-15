import type { IncidentComponentChange, IncidentComponentChangePreview } from "../service";
import { Button } from "../../../app/client/ui/button";
import { Drawer } from "../../../app/client/ui/drawer";
import { FormError } from "../../../app/client/ui/states";

export function IncidentComponentConfirmation({ change, preview, saving, error, onCancel, onConfirm }: {
  change: IncidentComponentChange;
  preview: IncidentComponentChangePreview;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const action = change.action === "attach" ? "Attach" : "Detach";
  const status = preview.internal ? "This component is internal; its status is not shown publicly." : preview.previousState === preview.nextState
    ? `The public status of ${preview.componentName} will remain ${preview.nextState}.`
    : `The public status of ${preview.componentName} will change from ${preview.previousState} to ${preview.nextState}.`;
  return <Drawer eyebrow="Published incident" title={`${action} ${preview.componentName}?`} onClose={() => { if (!saving) onCancel(); }}>
    <p className="drawer-copy">{status}</p>
    <p>{change.action === "detach" ? "No email or subscriber notification will be sent." :
      `The latest published update will be emailed to ${preview.emailRecipients} subscriber${preview.emailRecipients === 1 ? "" : "s"} and sent to ${preview.webhookRecipients} webhook subscriber${preview.webhookRecipients === 1 ? "" : "s"}.`}</p>
    {change.action === "attach" && <p>These counts reflect current eligibility. Subscriber changes before confirmation can change the final recipients.</p>}
    {error && <FormError>{error}</FormError>}
    <div className="drawer-actions"><Button type="button" variant="secondary" autoFocus disabled={saving} onClick={onCancel}>Cancel</Button><Button type="button" disabled={saving} onClick={onConfirm}>{saving ? "Applying…" : `Confirm ${change.action}`}</Button></div>
  </Drawer>;
}
