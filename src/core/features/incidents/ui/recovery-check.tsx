import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";

import type { RecoveryCheck } from "../../brief/recovery-check";

/** The server repeats this check at publication; this is the operator's view
 * of the evidence, never permission to bypass a newer failing receipt. */
export function RecoveryCheckPanel({ incidentId, overrideReason, onOverrideReason }: {
  incidentId: string; overrideReason: string; onOverrideReason: (reason: string) => void;
}) {
  const { data, error, loading, refresh } = useAppData<{ recovery: RecoveryCheck }>(`/api/app/incidents/${incidentId}/recovery-check`);
  const time = useOperatorTime();
  const check = data?.recovery;
  return <section className="context-section" aria-labelledby="recovery-check-title">
    <h3 id="recovery-check-title">Recovery check</h3>
    {loading && <p role="status">Checking linked monitors…</p>}
    {error && <FormError>{error}</FormError>}
    {check && <>
      <p role="status">{check.passed ? "Tracked recovery checks pass." : "Recovery needs your review before publishing Resolved."} Checked {time(check.checkedAt)}.</p>
      {check.items.length ? <ul>{check.items.map(item => <li key={`${item.source}:${item.key}`}>
        <strong>{item.source}</strong> · {item.key}: {item.state === "firing" ? "still firing" : item.state === "holding" ? `reported recovery has not held for ${check.holdMinutes} minutes` : "reported recovery held"}. Reported {time(item.evidenceAt)}{item.recoveredAt ? `; recovered ${time(item.recoveredAt)}` : ""}.
      </li>)}</ul> : <p>No linked monitors are tracked for this incident.</p>}
      <p>Not tracked: {check.notTracked.join(", ")}. A recovery alert alone does not prove continued recovery.</p>
      {(!check.passed || overrideReason) && <label className="form-label">Recovery override reason
        <textarea aria-label="Recovery override reason" value={overrideReason} maxLength={1000} onChange={event => onOverrideReason(event.target.value)} />
        <small>Required to publish while a tracked check fails. The reason stays in the private timeline and audit log.</small>
      </label>}
      <p>Scheduled resolutions are checked again when due. An override applies only when you publish now.</p>
    </>}
    <Button type="button" variant="secondary" disabled={loading} onClick={refresh}>Check recovery again</Button>
  </section>;
}
