import { useRef, useState } from "react";

import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";

type ImportDoorSettings = {
  configured: boolean;
  enabled: boolean;
  keys: { kid: string; revoked: boolean }[];
};

const settingsPath = "/api/app/import-door/settings";

export function ImportDoorSetting() {
  const resource = useAppData<ImportDoorSettings>(settingsPath);
  const [saved, setSaved] = useState<ImportDoorSettings | null>(null);
  const [selectedKid, setSelectedKid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queue = useRef({ sending: false, revision: 0, completed: 0, enabled: false });
  const settings = saved ?? resource.data;
  const revokedKids = settings?.keys.filter(key => key.revoked).map(key => key.kid) ?? [];
  const canRevoke = settings?.keys.some(key => key.kid === selectedKid && !key.revoked);

  async function save(enabled: boolean, revokeKid?: string) {
    if (!settings) return;
    const q = queue.current;
    q.enabled = enabled; q.revision++;
    setSaved({ ...settings, enabled });
    setError(null); setMessage(null);
    if (q.sending) return;
    q.sending = true; setBusy(true);
    try {
      while (q.completed !== q.revision) {
        const revision = q.revision;
        try {
          const next = await appApi<ImportDoorSettings>(settingsPath, {
            method: "PUT",
            body: JSON.stringify({ enabled: q.enabled, ...(revokeKid ? { revokedKids: [...revokedKids, revokeKid] } : {}) }),
          });
          q.completed = revision;
          setSaved({ ...next, enabled: q.enabled });
          if (revokeKid) setSelectedKid("");
          setMessage(revokeKid ? `Grant key ${revokeKid} was permanently revoked.` : "Saved · live");
          revokeKid = undefined;
        } catch (cause) {
          if (q.revision !== revision) continue;
          setError(`Business imports could not be saved: ${cause instanceof Error ? cause.message : "The server could not be reached."} Your choice is kept here.`);
          break;
        }
      }
    } finally { q.sending = false; setBusy(false); }
  }

  return <details><summary>Business imports · {resource.loading ? 'Checking…' : settings?.enabled ? 'On' : 'Off'}</summary><div className="setup-guide" aria-busy={busy || resource.loading}>
    <label className="checkbox-label">
      <input type="checkbox" checked={settings?.enabled ?? false} disabled={resource.loading || Boolean(resource.error) || !settings?.configured} onChange={event => void save(event.target.checked)} />
      Allow Business imports
    </label>
    <small className="field-note">Allow imports included with a Business plan. Changes take effect immediately.</small>
    {resource.loading && <p role="status">Checking Business import availability…</p>}
    {!resource.loading && settings && !settings.configured && <p>Business imports are not set up for this installation.</p>}
    {settings && settings.keys.length > 0 && <>
      <label className="form-label">Import signing key
        <select value={selectedKid} disabled={busy || resource.loading || Boolean(resource.error)} onChange={event => setSelectedKid(event.target.value)}>
          <option value="">Choose a key to revoke</option>
          {settings.keys.map(key => <option key={key.kid} value={key.kid} disabled={key.revoked}>{key.kid}{key.revoked ? " (permanently revoked)" : ""}</option>)}
        </select>
        <small>Revocation is permanent. Imports approved with this key will be refused.</small>
      </label>
      <Button type="button" variant="secondary" disabled={busy || resource.loading || Boolean(resource.error) || !canRevoke} onClick={() => void save(settings.enabled, selectedKid)}>Permanently revoke key</Button>
    </>}
    {revokedKids.length > 0 && <small className="field-note">Permanently revoked: {revokedKids.join(", ")}</small>}
    {(resource.error || error) && <p role="alert">{resource.error || error}</p>}
    {error && <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(settings?.enabled ?? false)}>Retry</Button>}
    {resource.error && <Button type="button" variant="secondary" onClick={resource.refresh}>Retry Business import settings</Button>}
    {busy ? <p role="status">Saving…</p> : message && <p role="status">{message}</p>}
  </div></details>;
}
