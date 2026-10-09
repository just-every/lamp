import { Icon } from "../../../app/client/ui/icon";

export function AiAssistanceCard({
  toneInstructions,
  configured,
  loading,
  error,
  onToneInstructionsChange,
}: {
  toneInstructions: string;
  configured: boolean | null;
  loading: boolean;
  error: string | null;
  onToneInstructionsChange: (value: string) => void;
}) {
  const availability = error
    ? { label: "Availability unavailable", className: "state-failed", detail: error }
    : loading || configured === null
      ? { label: "Checking provider…", className: "state-pending", detail: "Lamp is reading the configured AI adapter." }
      : configured
        ? { label: "Provider configured", className: "state-active", detail: "Suggestions use the configured provider and these saved tone instructions." }
        : { label: "No provider configured", className: "state-pending", detail: "Tone instructions are saved now and used when an AI provider is configured." };

  return <section className="data-card ai-assistance-card" aria-labelledby="ai-assistance-title">
    <div className="card-heading"><div><p className="card-kicker">Draft assistance</p><h2 id="ai-assistance-title"><Icon name="settings" width={17} height={17} />AI assistance</h2></div><span className={`state-pill ${availability.className}`}>{availability.label}</span></div>
    <p className="card-support">{availability.detail}</p>
    <label className="form-label" htmlFor="ai-tone-instructions">Tone instructions<textarea id="ai-tone-instructions" maxLength={2000} value={toneInstructions} placeholder="For example: lead with customer impact, use concise factual language, and state the next update time." onChange={(event) => onToneInstructionsChange(event.target.value)} /></label>
    <small className="field-note">These instructions are provided with the incident’s current public context. Internal notes are excluded.</small>
  </section>;
}
