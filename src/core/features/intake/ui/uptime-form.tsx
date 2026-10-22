import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { createOpaqueToken } from "../../../platform/security/opaque-tokens";
import { ComponentOptions, CopyField, NewKey, SaveNote, ShownOnce, ToolHeading } from "./tool-parts";
import { keyedAddress, toolDoes, type ComponentOption, type Source } from "./tools";
import { useSourceAutosave } from "./use-source-autosave";

const SETUP = "In Uptime's Notifications, add a Webhook with this address and keep its default signed JSON. Uptime's signing secret is not needed here.";

type Mappings = Map<string, string>;
const body = (source: Source, mappings: Mappings) => ({ name: source.name, preset: "uptime", credentialKind: source.credentialKind, monitorMappings: [...mappings].map(([monitorId, componentId]) => ({ monitorId, componentId })) });

/** The monitors Uptime's own events named, then any mapped before Uptime paired by picking (known only by ID until they alert). */
function monitorsOf(source: Source) {
  const seen = source.monitors ?? [];
  const named = new Set(seen.map(row => row.monitorId));
  return [...seen, ...(source.monitorMappings ?? []).filter(row => !named.has(row.monitorId)).map(row => ({ monitorId: row.monitorId, monitorName: `Monitor ${row.monitorId}` }))];
}

/** Uptime pairs by picking: Lamp makes the address Uptime posts to, and each monitor Uptime names gets a component here. */
export function UptimeForm({ source, components, name, onConnected, onSaved, onClose }: { source: Source | null; components: ComponentOption[]; name: string; onConnected: () => void; onSaved: () => void; onClose: () => void }) {
  return source ? <EditUptime source={source} components={components} onSaved={onSaved} onClose={onClose} /> : <ConnectUptime name={name} onConnected={onConnected} onClose={onClose} />;
}

function ConnectUptime({ name, onConnected, onClose }: { name: string; onConnected: () => void; onClose: () => void }) {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true); setError(null);
    try {
      const { source } = await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify({ name, preset: "uptime", credentialKind: "bearer-token" }) });
      setAddress(keyedAddress(source, source.token!)); onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Uptime could not be connected."); }
    finally { setBusy(false); }
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title="Connect Uptime" does={toolDoes("uptime")} close={{ label: address ? "Close" : "Back", onClick: onClose }} />
    {address ? <ShownOnce fields={[{ label: "Uptime address", value: address, copy: "Copy address" }]} onDone={onClose}>{SETUP}</ShownOnce>
      : <div className="form-actions tool-connect"><Button type="button" disabled={busy} onClick={() => void connect()}>{busy ? "Making the address…" : "Make the Uptime address"}</Button></div>}
    {error && <FormError>{error}</FormError>}
  </section>;
}

function EditUptime({ source, components, onSaved, onClose }: { source: Source; components: ComponentOption[]; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source.id, onSaved);
  const [mappings, setMappings] = useState<Mappings>(() => new Map((source.monitorMappings ?? []).map(row => [row.monitorId, row.componentId])));
  const [address, setAddress] = useState<string | null>(null);
  const monitors = monitorsOf(source);

  function pick(monitorId: string, componentId: string) {
    const next = new Map(mappings);
    if (componentId) next.set(monitorId, componentId); else next.delete(monitorId);
    setMappings(next);
    autosave.save(body(source, next), true);
  }
  async function newAddress() {
    const token = createOpaqueToken();
    await appApi(`/api/app/intake/sources/${source.id}`, { method: "PUT", body: JSON.stringify({ ...body(source, mappings), bearerToken: token }) });
    setAddress(keyedAddress(source, token)); onSaved();
  }

  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source.name} does={monitors.length ? "Pick a component for each monitor you want on your page." : toolDoes("uptime")} close={{ label: "Close", onClick: onClose }} />
    {monitors.length ? <>
      <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />
      <ul className="monitor-picks" aria-label="Uptime monitors">{monitors.map(monitor => <li key={monitor.monitorId}>
        <label className="form-label">{monitor.monitorName}<select aria-label={monitor.monitorName} value={mappings.get(monitor.monitorId) ?? ""} onChange={event => pick(monitor.monitorId, event.target.value)}><ComponentOptions components={components} empty="Not on your page" /></select></label>
      </li>)}</ul>
    </> : <p className="tool-note">Monitors appear here after Uptime's first alert.</p>}
    {address ? <ShownOnce fields={[{ label: "Uptime address", value: address, copy: "Copy address" }]} onDone={() => setAddress(null)}>{SETUP}</ShownOnce>
      : source.credentialKind === "bearer-token" ? <NewKey what="address" replace={newAddress} />
      : <CopyField label="Uptime address" value={source.endpointUrl} copy="Copy address" />}
  </section>;
}
