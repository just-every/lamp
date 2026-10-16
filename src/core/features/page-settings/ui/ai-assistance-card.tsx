import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { CopyBlock } from "../../../app/client/ui/copy-button";
import { Icon } from "../../../app/client/ui/icon";

export type AiStatus = { configured: boolean; unavailable: string | null; local: boolean };

const providerLines = "AI_PROVIDER_URL=https://api.openai.com/v1/chat/completions\nAI_PROVIDER_MODEL=paste-the-model-name-here\nAI_PROVIDER_API_KEY=paste-your-api-key-here";
const deployCommand = "rer deploy --environment production --env-file \"$HOME/.config/lamp/production.env\"";

function ConnectSteps({ local }: { local: boolean }) {
  return <details className="setup-guide">
    <summary>Connect an AI provider</summary>
    <ol>
      <li>Create an API key with your provider. For OpenAI, open <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">API keys</a> and choose <strong>Create new secret key</strong>, and pick a model name from its <a href="https://platform.openai.com/docs/models" target="_blank" rel="noreferrer">models list</a>. Any provider with an OpenAI-compatible Chat Completions endpoint and JSON responses works; use its endpoint and model name instead.</li>
      <li>{local
        ? <>Stop <code>rer dev</code>, then add these three lines to the <code>.dev.vars</code> file in your Lamp folder, with your model name and key:</>
        : <>Add these three lines, with your model name and key, to the private settings file you deploy Lamp with:</>}
        <CopyBlock text={providerLines} label="Copy the three lines" /></li>
      <li>{local
        ? <>Start <code>rer dev</code> again and reload this page.</>
        : <>Deploy again from your Lamp folder, using your own environment name and file, then reload this page:<CopyBlock text={deployCommand} label="Copy the deploy command" /></>}</li>
      <li>When this card says <strong>Provider configured</strong>, choose <strong>Test the provider</strong> below.</li>
    </ol>
    <p>Saving this page never stores an API key. To disconnect, remove all three lines and {local ? "restart rer dev" : "deploy again"}. <a href="/docs/ai-assistance">AI setup guide</a></p>
  </details>;
}

export function AiAssistanceCard({ toneInstructions, status, loading, error, onToneInstructionsChange }: {
  toneInstructions: string;
  status: AiStatus | null;
  loading: boolean;
  error: string | null;
  onToneInstructionsChange: (value: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  async function testProvider() {
    setChecking(true); setCheck(null);
    try { setCheck(await appApi<{ ok: boolean; message: string }>("/api/app/ai/check", { method: "POST" })); }
    catch (cause) { setCheck({ ok: false, message: cause instanceof Error ? cause.message : "The AI provider did not answer." }); }
    finally { setChecking(false); }
  }
  const availability = error
    ? { label: "Availability unavailable", className: "state-failed", detail: error }
    : loading || !status
      ? { label: "Checking provider…", className: "state-pending", detail: "Lamp is reading the configured AI adapter." }
      : status.unavailable
        ? { label: "Not available here", className: "state-pending", detail: status.unavailable }
        : status.configured
          ? { label: "Provider configured", className: "state-active", detail: "Operators can ask for a suggested update in an incident. Lamp never publishes a suggestion by itself." }
          : { label: "No provider configured", className: "state-pending", detail: "Connect an AI provider to suggest incident update text. Lamp works fully without it." };

  return <section className="data-card ai-assistance-card" aria-labelledby="ai-assistance-title">
    <div className="card-heading"><div><p className="card-kicker">Draft assistance</p><h2 id="ai-assistance-title"><Icon name="settings" width={17} height={17} />AI assistance</h2></div><span className={`state-pill ${availability.className}`}>{availability.label}</span></div>
    <p className="card-support">{availability.detail}</p>
    {status && !status.unavailable && <>
      {!status.configured && <ConnectSteps local={status.local} />}
      {status.configured && <div className="setup-guide">
        <p>Test sends one made-up incident to the provider. Success shows the text it suggests.</p>
        <Button type="button" variant="secondary" disabled={checking} onClick={() => void testProvider()}>{checking ? "Testing…" : "Test the provider"}</Button>
        {check && <p className="setup-result" data-ok={check.ok} role="status">{check.ok ? "Working. " : "Not working: "}{check.message}</p>}
      </div>}
      <label className="form-label" htmlFor="ai-tone-instructions">Tone instructions<textarea id="ai-tone-instructions" maxLength={2000} value={toneInstructions} placeholder="For example: lead with customer impact, use concise factual language, and state the next update time." onChange={(event) => onToneInstructionsChange(event.target.value)} /></label>
      <small className="field-note">Sent with the incident’s public details when an operator asks for a suggestion. Internal notes are never sent.</small>
    </>}
  </section>;
}
