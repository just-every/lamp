import type { UpdateChannel } from "../../../shared/domain";
import type { IncidentTemplate } from "../template-repository";
import { TEMPLATE_WORDING_FIELDS, type TemplateWordingField } from "../template-fields";

type ResolvedUpdate = NonNullable<IncidentTemplate["resolvedUpdate"]>;
const CHANNELS: Array<{ value: UpdateChannel; label: string }> = [
  { value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "webhook", label: "Webhook" },
  { value: "chat", label: "Slack and Teams" }, { value: "social", label: "Social accounts" },
];
const blankResolved = (): ResolvedUpdate => ({ affectedAudience: "", customerImpact: "", whatStillWorks: "", details: "" });

/** Prepared communication for AUTO-001: every automatic word and channel is saved by the operator. */
export function TemplateAutomationFields({ channels, resolvedUpdate, disabled, onChannels, onResolved }: {
  channels: UpdateChannel[]; resolvedUpdate: ResolvedUpdate | null; disabled: boolean;
  onChannels: (channels: UpdateChannel[]) => void; onResolved: (resolvedUpdate: ResolvedUpdate | null) => void;
}) {
  return <section className="context-section tool-fields template-automation-fields" aria-label="Template automation settings">
    <h3>Automatic publication</h3>
    <p>Alert rules use these saved channels and this Resolved wording. Changing this template changes what its rules may publish.</p>
    <fieldset className="option-group">
      <legend>Template notification channels</legend>
      <div className="channel-checks">{CHANNELS.map(channel => <label key={channel.value} className="checkbox-label"><input type="checkbox" disabled={disabled} aria-label={`Template ${channel.label.toLowerCase()}`} checked={channels.includes(channel.value)} onChange={() => onChannels(channels.includes(channel.value) ? channels.filter(value => value !== channel.value) : [...channels, channel.value])} />{channel.label}</label>)}</div>
    </fieldset>
    <label className="checkbox-label"><input type="checkbox" disabled={disabled} checked={resolvedUpdate !== null} onChange={event => onResolved(event.target.checked ? blankResolved() : null)} />Save a Resolved update for alert recovery</label>
    {resolvedUpdate ? <div className="tool-fields">{(Object.keys(TEMPLATE_WORDING_FIELDS) as TemplateWordingField[]).map(field => {
      const { label, max } = TEMPLATE_WORDING_FIELDS[field];
      return <label key={field} className="form-label">Resolved {label.toLowerCase()}<textarea aria-label={`Resolved template ${label.toLowerCase()}`} value={resolvedUpdate[field]} disabled={disabled} onChange={event => onResolved({ ...resolvedUpdate, [field]: event.target.value })} aria-invalid={resolvedUpdate[field].length > max} /><span className="character-count">{resolvedUpdate[field].length}/{max}</span></label>;
    })}</div> : null}
  </section>;
}
