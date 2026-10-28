import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { relativeTime } from "../../../app/client/ui/relative-time";
import { FormError } from "../../../app/client/ui/states";
import { toolLabel, toolOf, type ComponentOption, type Source } from "./tools";

/** Each connected tool as one compact row: its name, its state, Edit and Remove. Its form stays closed until Edit. */
export function ConnectedTools({ sources, components, editing, onEdit, onRemoved }: { sources: Source[]; components: ComponentOption[]; editing: string | null; onEdit: (source: Source) => void; onRemoved: (source: Source) => void }) {
  return <section className="data-card connected-tools" aria-labelledby="connected-tools-title">
    <h2 id="connected-tools-title">Connected</h2>
    <ul className="tool-list">{sources.map(source => <ConnectedTool key={source.id} source={source} components={components} editing={editing === source.id} onEdit={() => onEdit(source)} onRemoved={() => onRemoved(source)} />)}</ul>
  </section>;
}

function state(source: Source): { label: string; tone: string } {
  const tool = toolOf(source);
  if (tool === "pagerduty" && !source.webhookConnected) return { label: "Needs its signing secret", tone: "state-degraded-performance" };
  const mapped = new Set((source.monitorMappings ?? []).map(row => row.monitorId));
  const unpicked = (source.monitors ?? []).filter(monitor => !mapped.has(monitor.monitorId)).length;
  if (unpicked) return { label: `${unpicked} monitor${unpicked === 1 ? "" : "s"} to pick`, tone: "state-degraded-performance" };
  if (source.responderConnection === "reconnect") return { label: "Notes need a new key", tone: "state-degraded-performance" };
  return source.lastReceivedAt ? { label: "Connected", tone: "state-active" } : { label: "Waiting for the first alert", tone: "state-waiting" };
}

/** One quiet line: the tool when the name does not say it, the one component it feeds, and the last delivery once there is one. */
function details(source: Source, components: ComponentOption[]) {
  const tool = toolOf(source);
  const parts: string[] = [];
  if (tool !== "webhook" && source.name !== toolLabel(tool)) parts.push(toolLabel(tool));
  if (source.componentId) parts.push(components.find(component => component.id === source.componentId)?.name ?? "a removed component");
  if (source.lastReceivedAt) parts.push(`last delivery ${relativeTime(source.lastReceivedAt)}`);
  return parts.join(" · ");
}

function ConnectedTool({ source, components, editing, onEdit, onRemoved }: { source: Source; components: ComponentOption[]; editing: boolean; onEdit: () => void; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { label, tone } = state(source);
  const line = details(source, components);
  async function remove() {
    setRemoving(true); setError(null);
    try { await appApi(`/api/app/intake/sources/${source.id}`, { method: "DELETE" }); onRemoved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : `${source.name} could not be removed.`); setRemoving(false); }
  }
  return <li className={`tool-row${editing ? " is-open" : ""}`} aria-label={source.name}>
    <span className="tool-row-name"><strong>{source.name}</strong>{line && <small>{line}</small>}</span>
    <span className={`state-pill ${tone}`}>{label}</span>
    <span className="tool-row-actions">
      <Button type="button" variant="secondary" className="table-action" aria-label={`Edit ${source.name}`} aria-expanded={editing} onClick={onEdit}>Edit</Button>
      <Button type="button" variant="secondary" className="table-action" aria-label={`Remove ${source.name}`} disabled={removing} onClick={() => setConfirming(true)}>Remove</Button>
    </span>
    {confirming && <div className="tool-confirm" role="group" aria-label={`Remove ${source.name}?`}>
      <p>Its address stops working and its alert log here is erased. Drafts stay.</p>
      <div className="form-actions"><Button type="button" variant="secondary" disabled={removing} onClick={() => setConfirming(false)}>Keep</Button><Button type="button" variant="secondary" className="danger-button" disabled={removing} onClick={() => void remove()}>{removing ? "Removing…" : `Remove ${source.name}`}</Button></div>
    </div>}
    {error && <FormError>{error}</FormError>}
  </li>;
}
