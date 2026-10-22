import { useState, type FormEvent } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { createOpaqueToken } from "../../../platform/security/opaque-tokens";
import { CopyField, NewKey, SaveNote, ShownOnce, ToolHeading, type Copyable } from "./tool-parts";
import { toolDoes, type Source } from "./tools";
import { useSourceAutosave } from "./use-source-autosave";

type Fields = { name: string; timestampHeader: string; signatureHeader: string; deduplicationPath: string; titlePath: string; statePath: string; recoveredValue: string };
const DEFAULTS: Omit<Fields, "name"> = { timestampHeader: "x-lamp-timestamp", signatureHeader: "x-lamp-signature", deduplicationPath: "$.alert.id", titlePath: "$.alert.title", statePath: "$.alert.state", recoveredValue: "recovered" };
const PATHS: Array<[keyof Fields, string]> = [["deduplicationPath", "Deduplication JSON path"], ["titlePath", "Title JSON path"], ["statePath", "State JSON path"], ["recoveredValue", "Recovery value"]];
const HEADERS: Array<[keyof Fields, string]> = [["timestampHeader", "Timestamp header"], ["signatureHeader", "Signature header"]];
const fieldsOf = (source: Source): Fields => ({ name: source.name, timestampHeader: source.timestampHeader, signatureHeader: source.signatureHeader, deduplicationPath: source.deduplicationPath, titlePath: source.titlePath, statePath: source.statePath, recoveredValue: source.recoveredValue });
const complete = (fields: Fields, hmac: boolean) => [fields.name, fields.deduplicationPath, fields.titlePath, fields.statePath, fields.recoveredValue, ...(hmac ? [fields.timestampHeader, fields.signatureHeader] : [])].every(value => value.trim());

function howToSend(hmac: boolean, fields: Pick<Fields, "timestampHeader" | "signatureHeader">) {
  return hmac ? `Post JSON to this address. Put the ISO time in ${fields.timestampHeader} and the HMAC-SHA256 of time.body, base64url, in ${fields.signatureHeader}.`
    : "Post JSON to this address with the header Authorization: Bearer and the token.";
}

/** Any other tool that posts JSON: Lamp makes its token or signing secret unless the tool brings its own secret. */
export function WebhookForm({ source, onConnected, onSaved, onClose }: { source: Source | null; onConnected: () => void; onSaved: () => void; onClose: () => void }) {
  return source ? <EditWebhook source={source} onSaved={onSaved} onClose={onClose} /> : <ConnectWebhook onConnected={onConnected} onClose={onClose} />;
}

function ConnectWebhook({ onConnected, onClose }: { onConnected: () => void; onClose: () => void }) {
  const [fields, setFields] = useState<Fields>({ name: "", ...DEFAULTS });
  const [hmac, setHmac] = useState(false);
  const [ownSecret, setOwnSecret] = useState("");
  const [shown, setShown] = useState<{ fields: Copyable[]; once: boolean; hmac: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const key = hmac ? ownSecret.trim() || createOpaqueToken() : createOpaqueToken();
    try {
      const { source } = await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify({ ...fields, credentialKind: hmac ? "hmac-sha256" : "bearer-token", ...(hmac ? { signingSecret: key } : { bearerToken: key }) }) });
      const made = !hmac || !ownSecret.trim();
      setShown({ hmac, once: made, fields: [{ label: "Address", value: source.endpointUrl, copy: "Copy address" }, ...(made ? [{ label: hmac ? "Signing secret" : "Token", value: key, copy: hmac ? "Copy secret" : "Copy token" }] : [])] });
      onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The tool could not be connected."); }
    finally { setBusy(false); }
  }
  const set = (key: keyof Fields, value: string) => setFields(current => ({ ...current, [key]: value }));
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title="Connect another tool" does={toolDoes("webhook")} close={{ label: shown ? "Close" : "Back", onClick: onClose }} />
    {shown ? <ShownOnce once={shown.once} fields={shown.fields} onDone={onClose}>{howToSend(shown.hmac, fields)}</ShownOnce>
      : <form className="tool-fields" onSubmit={connect}>
        <label className="form-label">Name<input required maxLength={120} value={fields.name} placeholder="Checkout monitor" onChange={event => set("name", event.target.value)} /></label>
        <label className="form-label">Proof<select value={hmac ? "hmac" : "token"} onChange={event => setHmac(event.target.value === "hmac")}><option value="token">A token Lamp makes</option><option value="hmac">An HMAC signature</option></select></label>
        {hmac && <label className="form-label">The tool's own signing secret<input type="password" autoComplete="new-password" value={ownSecret} onChange={event => setOwnSecret(event.target.value)} /><small>Leave empty and Lamp makes one.</small></label>}
        <PayloadFields fields={fields} hmac={hmac} set={set} />
        <div className="form-actions"><Button disabled={busy || !complete(fields, hmac)}>{busy ? "Connecting…" : "Connect"}</Button></div>
      </form>}
    {error && <FormError>{error}</FormError>}
  </section>;
}

function EditWebhook({ source, onSaved, onClose }: { source: Source; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source.id, onSaved);
  const hmac = source.credentialKind === "hmac-sha256";
  const [fields, setFields] = useState<Fields>(() => fieldsOf(source));
  const [key, setKey] = useState<string | null>(null);
  function set(name: keyof Fields, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    // A blank secret or token keeps the saved one; an emptied field waits until it has a value again.
    if (complete(next, hmac)) autosave.save({ ...next, credentialKind: source.credentialKind });
  }
  async function newKey() {
    const made = createOpaqueToken();
    await appApi(`/api/app/intake/sources/${source.id}`, { method: "PUT", body: JSON.stringify({ ...fields, credentialKind: source.credentialKind, ...(hmac ? { signingSecret: made } : { bearerToken: made }) }) });
    setKey(made); onSaved();
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source.name} does={toolDoes("webhook")} close={{ label: "Close", onClick: onClose }} />
    <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />
    <div className="tool-fields">
      <label className="form-label">Name<input required maxLength={120} value={fields.name} onChange={event => set("name", event.target.value)} /></label>
      <PayloadFields fields={fields} hmac={hmac} set={set} />
    </div>
    <CopyField label="Address" value={source.endpointUrl} copy="Copy address" />
    {key ? <ShownOnce fields={[{ label: hmac ? "Signing secret" : "Token", value: key, copy: hmac ? "Copy secret" : "Copy token" }]} onDone={() => setKey(null)}>{howToSend(hmac, fields)}</ShownOnce>
      : <NewKey what={hmac ? "signing secret" : "token"} replace={newKey} />}
  </section>;
}

/** Lamp's own alert shape fills every field; a tool with another shape changes them here. */
function PayloadFields({ fields, hmac, set }: { fields: Fields; hmac: boolean; set: (name: keyof Fields, value: string) => void }) {
  return <details className="tool-more">
    <summary>Payload fields</summary>
    <div className="tool-fields">{[...PATHS, ...(hmac ? HEADERS : [])].map(([name, label]) => <label key={name} className="form-label">{label}<input required maxLength={name === "recoveredValue" ? 100 : name.endsWith("Header") ? 120 : 250} value={fields[name]} onChange={event => set(name, event.target.value)} /></label>)}</div>
  </details>;
}
