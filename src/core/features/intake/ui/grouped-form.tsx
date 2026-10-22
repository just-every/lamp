import { useState } from "react";

import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { createOpaqueToken } from "../../../platform/security/opaque-tokens";
import { parseLabelExpression, type GroupedPreset, type LabelMatcher } from "../grouped-alerts";
import { ComponentOptions, NewKey, SaveNote, ShownOnce, ToolHeading } from "./tool-parts";
import { keyedAddress, toolDoes, toolLabel, type ComponentOption, type Source } from "./tools";
import { useSourceAutosave } from "./use-source-autosave";

const SETUP: Record<GroupedPreset, string> = {
  alertmanager: "In Alertmanager, add this address as a webhook_configs url with send_resolved: true.",
  grafana: "In Grafana, add a Webhook contact point with this address and keep its default payload.",
};
type Row = { componentId: string; expression: string };
const emptyRow = (): Row => ({ componentId: "", expression: "" });
const expression = (labels: Record<string, string>) => Object.entries(labels).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
function labelsOf(row: Row) { try { return parseLabelExpression(row.expression); } catch { return null; } }
/** The rows as matchers, or null while a started row is incomplete or its labels do not parse. */
function matchersOf(rows: Row[]): LabelMatcher[] | null {
  const started = rows.filter(row => row.componentId || row.expression.trim());
  const matchers = started.map(row => ({ componentId: row.componentId, labels: labelsOf(row) }));
  return matchers.length && matchers.every(row => row.componentId && row.labels) ? matchers as LabelMatcher[] : null;
}
const body = (name: string, tool: GroupedPreset, labelMatchers: LabelMatcher[]) => ({ name, preset: tool, credentialKind: "bearer-token", labelMatchers });

/** Alertmanager and Grafana: each component is matched by exact alert labels; Lamp makes the key. */
export function GroupedForm({ tool, source, components, name, onConnected, onSaved, onClose }: { tool: GroupedPreset; source: Source | null; components: ComponentOption[]; name: string; onConnected: () => void; onSaved: () => void; onClose: () => void }) {
  return source ? <EditGrouped tool={tool} source={source} components={components} onSaved={onSaved} onClose={onClose} /> : <ConnectGrouped tool={tool} name={name} components={components} onConnected={onConnected} onClose={onClose} />;
}

function ConnectGrouped({ tool, name, components, onConnected, onClose }: { tool: GroupedPreset; name: string; components: ComponentOption[]; onConnected: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchers = matchersOf(rows);
  async function connect() {
    if (!matchers) return;
    setBusy(true); setError(null);
    try {
      const { source } = await appApi<{ source: Source }>("/api/app/intake/sources", { method: "POST", body: JSON.stringify(body(name, tool, matchers)) });
      setAddress(keyedAddress(source, source.token!)); onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `${toolLabel(tool)} could not be connected.`); }
    finally { setBusy(false); }
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={`Connect ${toolLabel(tool)}`} does={toolDoes(tool)} close={{ label: address ? "Close" : "Back", onClick: onClose }} />
    {address ? <ShownOnce fields={[{ label: `${toolLabel(tool)} address`, value: address, copy: "Copy address" }]} onDone={onClose}>{SETUP[tool]}</ShownOnce>
      : <form className="tool-fields" onSubmit={event => { event.preventDefault(); void connect(); }}>
        <LabelRows rows={rows} components={components} onChange={setRows} />
        <div className="form-actions"><Button disabled={busy || !matchers}>{busy ? "Connecting…" : `Connect ${toolLabel(tool)}`}</Button></div>
      </form>}
    {error && <FormError>{error}</FormError>}
  </section>;
}

function EditGrouped({ tool, source, components, onSaved, onClose }: { tool: GroupedPreset; source: Source; components: ComponentOption[]; onSaved: () => void; onClose: () => void }) {
  const autosave = useSourceAutosave(source.id, onSaved);
  const [rows, setRows] = useState<Row[]>(() => (source.labelMatchers ?? []).map(row => ({ componentId: row.componentId, expression: expression(row.labels) })));
  const [saved, setSaved] = useState<LabelMatcher[]>(source.labelMatchers ?? []);
  const [address, setAddress] = useState<string | null>(null);
  function change(next: Row[], immediate: boolean) {
    setRows(next);
    const matchers = matchersOf(next);
    // A row being typed saves once it parses; until then the last complete rows stay saved.
    if (matchers && JSON.stringify(matchers) !== JSON.stringify(saved)) { setSaved(matchers); autosave.save(body(source.name, tool, matchers), immediate); }
  }
  async function newAddress() {
    const token = createOpaqueToken();
    await appApi(`/api/app/intake/sources/${source.id}`, { method: "PUT", body: JSON.stringify({ ...body(source.name, tool, saved), bearerToken: token }) });
    setAddress(keyedAddress(source, token)); onSaved();
  }
  return <section className="data-card tool-form" aria-labelledby="tool-form-title">
    <ToolHeading title={source.name} does={toolDoes(tool)} close={{ label: "Close", onClick: onClose }} />
    <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />
    <div className="tool-fields"><LabelRows rows={rows} components={components} onChange={change} /></div>
    {address ? <ShownOnce fields={[{ label: `${toolLabel(tool)} address`, value: address, copy: "Copy address" }]} onDone={() => setAddress(null)}>{SETUP[tool]}</ShownOnce> : <NewKey what="address" replace={newAddress} />}
  </section>;
}

/** One row per component: every label in a row must match exactly; any matching row attaches its component. */
function LabelRows({ rows, components, onChange }: { rows: Row[]; components: ComponentOption[]; onChange: (rows: Row[], immediate: boolean) => void }) {
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const update = (index: number, field: keyof Row, value: string) => onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row), field === "componentId");
  return <>
    <ul className="label-rows">{rows.map((row, index) => {
      const invalid = touched.has(index) && row.expression.trim() !== "" && !labelsOf(row);
      return <li key={index} className="label-row">
        <label className="form-label">Component<select aria-label={`Component ${index + 1}`} value={row.componentId} onChange={event => update(index, "componentId", event.target.value)}><ComponentOptions components={components} empty="Choose a component" /></select></label>
        <label className="form-label">Labels<input aria-label={`Labels ${index + 1}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? `labels-${index}-help` : undefined} maxLength={2000} value={row.expression} placeholder={'service="api"'} onChange={event => update(index, "expression", event.target.value)} onBlur={() => setTouched(current => new Set(current).add(index))} />
          {invalid && <small id={`labels-${index}-help`}>Use exact labels like service="api", region="us-east".</small>}</label>
        {rows.length > 1 && <Button type="button" variant="secondary" className="table-action" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index), true)}>Remove</Button>}
      </li>;
    })}</ul>
    <div className="form-actions label-rows-actions"><Button type="button" variant="secondary" onClick={() => onChange([...rows, emptyRow()], true)}>Add a component</Button></div>
  </>;
}
