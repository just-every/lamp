import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { createOpaqueToken } from "../../../platform/security/opaque-tokens";
import { datadogPayloadTemplate, uptimeRobotPayloadTemplate, newRelicPayloadTemplate } from "../presets";
import { ComponentOptions, NewKey, SaveNote, ShownOnce, ToolHeading, type Copyable } from "./tool-parts";
import { keyedAddress, toolDoes, toolLabel, type ComponentOption, type Source } from "./tools";
import { useSourceAutosave } from "./use-source-autosave";

export type SingleTool = "newrelic" | "datadog" | "uptimerobot" | "betterstack" | "pingdom";

// Each tool takes Lamp's key in the address, so the address is the one thing to paste (with the body the tool must send).
const SETUP: Record<SingleTool, string> = {
  newrelic: "In New Relic, add a workflow webhook destination with this address and custom payload. Notify on activated and closed issues.",
  datadog: "In Datadog's Webhooks integration, add a webhook with this address and payload, then mention @webhook-<its name> in your monitor.",
  uptimerobot: "In UptimeRobot, add a Webhook with this address as URL to Notify, tick Send as JSON and paste the body. Then add it to each monitor's alert contacts.",
  betterstack: "In Better Stack, add an incident webhook with this address.",
  pingdom: "In Pingdom, add a webhook integration with this address and attach it to the check.",
};
function setupFields(tool: SingleTool, address: string): Copyable[] {
  const fields: Copyable[] = [{ label: `${toolLabel(tool)} address`, value: address, copy: "Copy address" }];
  if (tool === "newrelic") fields.push({ label: "New Relic workflow template", value: newRelicPayloadTemplate, copy: "Copy template", multiline: true });
  if (tool === "datadog") fields.push({ label: "Datadog payload", value: datadogPayloadTemplate, copy: "Copy payload", multiline: true });
  if (tool === "uptimerobot") fields.push({ label: "UptimeRobot JSON body", value: uptimeRobotPayloadTemplate, copy: "Copy body", multiline: true });
  return fields;
}
const body = (source: Pick<Source, "name">, tool: SingleTool, componentId: string) => ({ name: source.name, preset: tool, componentId, credentialKind: "bearer-token" });

/** Datadog, UptimeRobot, Better Stack and Pingdom: one component, chosen once; Lamp makes the key. */
export function PresetForm({ tool, source, components, name, onConnected, onSaved, onClose }: { tool: SingleTool; source: Source | null; components: ComponentOption[]; name: string; onConnected: () => void; onSaved: () => void; onClose: () => void }) {
  return source ? <EditPreset tool={tool} source={source} components={components} onSaved={onSaved} onClose={onClose} /> : <ConnectPreset tool={tool} name={name} components={components} onConnected={onConnected} onClose={onClose} />;
}

function ConnectPreset({ tool, name, components, onConnected, onClose }: { tool: SingleTool; name: string; components: ComponentOption[]; onConnected: () => void; onClose: () => void }) {
  const [componentId, setComponentId] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true); setError(null);
    try {
      const { source } = await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify(body({ name }, tool, componentId)) });
      setAddress(keyedAddress(source, source.token!)); onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `${toolLabel(tool)} could not be connected.`); }
    finally { setBusy(false); }
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={`Connect ${toolLabel(tool)}`} does={toolDoes(tool)} close={{ label: address ? "Close" : "Back", onClick: onClose }} />
    {address ? <ShownOnce fields={setupFields(tool, address)} onDone={onClose}>{SETUP[tool]}</ShownOnce> : <form className="tool-fields" onSubmit={event => { event.preventDefault(); void connect(); }}>
      <label className="form-label">Component<select required value={componentId} onChange={event => setComponentId(event.target.value)}><ComponentOptions components={components} empty="Choose a component" /></select></label>
      <div className="form-actions"><Button disabled={busy || !componentId}>{busy ? "Connecting…" : `Connect ${toolLabel(tool)}`}</Button></div>
    </form>}
    {error && <FormError>{error}</FormError>}
  </section>;
}

function EditPreset({ tool, source, components, onSaved, onClose }: { tool: SingleTool; source: Source; components: ComponentOption[]; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source.id, onSaved);
  const [componentId, setComponentId] = useState(source.componentId ?? "");
  const [address, setAddress] = useState<string | null>(null);
  async function newAddress() {
    const token = createOpaqueToken();
    await appApi(`/api/app/intake/sources/${source.id}`, { method: "PUT", body: JSON.stringify({ ...body(source, tool, componentId), bearerToken: token }) });
    setAddress(keyedAddress(source, token)); onSaved();
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source.name} does={toolDoes(tool)} close={{ label: "Close", onClick: onClose }} />
    <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />
    <div className="tool-fields"><label className="form-label">Component<select required value={componentId} onChange={event => { setComponentId(event.target.value); autosave.save(body(source, tool, event.target.value), true); }}><ComponentOptions components={components} empty="Choose a component" required /></select></label></div>
    {address ? <ShownOnce fields={setupFields(tool, address)} onDone={() => setAddress(null)}>{SETUP[tool]}</ShownOnce> : <NewKey what="address" replace={newAddress} />}
  </section>;
}
