import { useState } from "react";

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
  const settings = saved ?? resource.data;
  const revokedKids = settings?.keys.filter(key => key.revoked).map(key => key.kid) ?? [];
  const canRevoke = settings?.keys.some(key => key.kid === selectedKid && !key.revoked);

  async function save(enabled: boolean, revokeKid?: string) {
    if (!settings || busy) return;
    setBusy(true); setError(null); setMessage(null);
    setSaved({ ...settings, enabled });
    try {
      const next = await appApi<ImportDoorSettings>(settingsPath, {
        method: "PUT",
        body: JSON.stringify({ enabled, ...(revokeKid ? { revokedKids: [...revokedKids, revokeKid] } : {}) }),
      });
      setSaved(next);
      if (revokeKid) setSelectedKid("");
      setMessage(revokeKid ? `Grant key ${revokeKid} was permanently revoked.` : `Business imports ${next.enabled ? "enabled" : "disabled"}.`);
    } catch (cause) {
      setSaved(settings);
      setError(cause instanceof Error ? cause.message : "Business import settings could not be saved.");
    } finally { setBusy(false); }
  }

  return <details><summary>Business imports · {resource.loading ? 'Checking…' : settings?.enabled ? 'On' : 'Off'}</summary><div className="setup-guide" aria-busy={busy || resource.loading}>
    <label className="checkbox-label">
      <input type="checkbox" checked={settings?.enabled ?? false} disabled={busy || resource.loading || Boolean(resource.error) || !settings?.configured} onChange={event => void save(event.target.checked)} />
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
    {resource.error && <Button type="button" variant="secondary" onClick={resource.refresh}>Retry Business import settings</Button>}
    {message && <p role="status">{message}</p>}
  </div></details>;
}
