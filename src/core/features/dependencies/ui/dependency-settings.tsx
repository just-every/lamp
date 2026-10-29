import { useEffect, useState, type FormEvent } from "react";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError, useOperatorTime } from "../../../app/client/ui/states";
import type { ComponentState } from "../../../shared/domain";

type Mode = "show" | "draft" | "rollup";
type Mapping = Record<string, ComponentState>;
type CatalogEntry = { id: string; name: string; origin: string; statusPageUrl: string; path: string; format: string; mapping: Mapping };
type Dependency = {
  id: string; componentId: string; name: string; vendorName: string; sourceUrl: string; statusPageUrl: string; format: string;
  mode: Mode; dependentComponentIds: string[]; templateId: string | null; state: ComponentState | null;
  unavailableAt: string | null; lastReadAt: number | null; failures: number; incidentId: string | null;
  mapping?: Mapping; options?: { json?: { mapping: Mapping } };
};
type Component = { id: string; name: string };
type Template = { id: string; name: string };

function StateMapping({ mapping }: { mapping: Mapping }) {
  return <details><summary>State mapping</summary><dl>{Object.entries(mapping).map(([state, mapped]) => <div key={state}><dt>{state}</dt><dd>{mapped}</dd></div>)}</dl></details>;
}

function DependencyRow({ dependency, components, templates, mapping, refresh }: {
  dependency: Dependency; components: Component[]; templates: Template[]; mapping?: Mapping; refresh: () => void;
}) {
  const formatTime = useOperatorTime();
  const [mode, setMode] = useState(dependency.mode);
  const [templateId, setTemplateId] = useState(dependency.templateId ?? "");
  const [selected, setSelected] = useState(dependency.dependentComponentIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setMode(dependency.mode); setTemplateId(dependency.templateId ?? ""); setSelected(dependency.dependentComponentIds);
  }, [dependency.mode, dependency.templateId, dependency.dependentComponentIds.join(",")]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      await appApi(`/api/app/dependencies/${dependency.id}`, { method: "PUT", body: JSON.stringify({ mode, dependentComponentIds: selected, templateId: templateId || null }) });
      refresh(); setMessage("Dependency behavior saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The dependency could not be saved."); }
    finally { setSaving(false); }
  }
  async function remove() {
    setSaving(true); setError(null); setMessage(null);
    try { await appApi(`/api/app/dependencies/${dependency.id}`, { method: "DELETE" }); refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The dependency could not be removed."); }
    finally { setSaving(false); }
  }
  return <article className="data-card" aria-label={dependency.name}>
    <h3>{dependency.name}</h3>
    <p>Reported by <a href={dependency.statusPageUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{dependency.vendorName}</a> · {dependency.unavailableAt ? "Vendor status unavailable" : dependency.state ?? "Waiting for first read"}</p>
    {dependency.unavailableAt && <p role="status">Vendor status became unavailable at {formatTime(dependency.unavailableAt)}. The last reported state is {dependency.state ?? "not yet known"}.</p>}
    <p>{dependency.lastReadAt === null ? "This source has not been read yet." : `Last read ${formatTime(new Date(dependency.lastReadAt).toISOString())}.`} Reads are at least two minutes apart.</p>
    {mapping && <StateMapping mapping={mapping} />}
    <form className="channel-form" onSubmit={save}>
      <label className="form-label full-width">Dependency behavior<select aria-label="Dependency behavior" value={mode} disabled={saving} onChange={event => setMode(event.target.value as Mode)}><option value="show">Show only</option><option value="draft">Draft an incident</option><option value="rollup">Include in overall status</option></select></label>
      {mode === "draft" && <>
        <label className="form-label full-width">Upstream-provider template<select aria-label="Upstream-provider template" required value={templateId} disabled={saving} onChange={event => setTemplateId(event.target.value)}><option value="">Choose a saved template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <fieldset className="full-width"><legend>Dependent components</legend>{components.length ? components.map(component => <label className="checkbox-label" key={component.id}><input type="checkbox" disabled={saving} checked={selected.includes(component.id)} onChange={event => setSelected(event.target.checked ? [...selected, component.id] : selected.filter(id => id !== component.id))} />{component.name}</label>) : <p>Add a buyer component before choosing draft mode.</p>}</fieldset>
        <p className="full-width">An upstream outage prepares one private draft. An operator must review and publish it. Vendor recovery adds brief evidence and never resolves the buyer incident.</p>
      </>}
      {mode === "show" && <p className="full-width">Vendor changes do not claim buyer component state or change overall status.</p>}
      {mode === "rollup" && <p className="full-width">Vendor state contributes to overall status without changing buyer component claims.</p>}
      <Button type="submit" disabled={saving || mode === "draft" && (!templateId || !selected.length)}>Save dependency behavior</Button>
      <Button type="button" variant="secondary" disabled={saving} onClick={() => void remove()}>Stop following</Button>
    </form>
    {dependency.incidentId && <p><a className="text-link" href={`/app/incidents/${dependency.incidentId}`}>Review upstream incident</a></p>}
    {error && <FormError>{error}</FormError>}{message && <p role="status">{message}</p>}
  </article>;
}

/** Public vendor reads are configured alongside the page's other Settings. */
export function DependencySettings() {
  const resource = useAppData<{ dependencies: Dependency[]; catalog: CatalogEntry[] }>("/api/app/dependencies");
  const componentResource = useAppData<{ components: Component[] }>("/api/app/components");
  const templateResource = useAppData<{ templates: Template[] }>("/api/app/incident-templates");
  const [catalogId, setCatalogId] = useState("");
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [statusPageUrl, setStatusPageUrl] = useState("");
  const [format, setFormat] = useState("statuspage");
  const [componentId, setComponentId] = useState("");
  const [statePath, setStatePath] = useState("status");
  const [incidentPath, setIncidentPath] = useState("");
  const [summaryPath, setSummaryPath] = useState("");
  const [mappingText, setMappingText] = useState('{"operational":"Operational","outage":"Major outage"}');
  const [internal, setInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const catalog = resource.data?.catalog ?? [];
  const dependencies = resource.data?.dependencies ?? [];
  const selectedVendor = catalog.find(entry => entry.id === catalogId);
  const vendorComponentIds = new Set(dependencies.map(row => row.componentId));
  const components = (componentResource.data?.components ?? []).filter(row => !vendorComponentIds.has(row.id));
  async function follow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(null); setMessage(null);
    try {
      const options = {
        ...(componentId.trim() ? { componentId: componentId.trim() } : {}),
        ...(!catalogId && format === "json" ? { json: { statePath, ...(incidentPath ? { incidentPath } : {}), ...(summaryPath ? { summaryPath } : {}), mapping: JSON.parse(mappingText) as Mapping } } : {}),
      };
      await appApi("/api/app/dependencies", { method: "POST", body: JSON.stringify({ name, internal, ...(catalogId ? { catalogId } : { sourceUrl, statusPageUrl, format }), options }) });
      setName(""); setSourceUrl(""); setStatusPageUrl(""); setComponentId(""); resource.refresh(); componentResource.refresh(); setMessage("Vendor status is now followed in show-only mode.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The vendor source could not be followed."); }
    finally { setSaving(false); }
  }
  return <div className="page-stack">
    <section className="data-card" aria-labelledby="dependency-settings-title">
      <p className="card-kicker">Dependencies</p><h2 id="dependency-settings-title">Follow vendor status</h2>
      <p>Follow public vendor reports without turning an upstream problem into your own outage. New dependencies show vendor status only.</p>
      <form className="channel-form" onSubmit={follow}>
        <label className="form-label">Vendor<select aria-label="Vendor" value={catalogId} disabled={saving} onChange={event => { setCatalogId(event.target.value); setName(catalog.find(entry => entry.id === event.target.value)?.name ?? ""); }}><option value="">Custom public source</option>{catalog.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label className="form-label">Vendor component name<input required maxLength={120} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
        {!catalogId && <>
          <label className="form-label full-width">Public status source<input required type="url" value={sourceUrl} disabled={saving} onChange={event => setSourceUrl(event.target.value)} /></label>
          <label className="form-label full-width">Vendor status page<input required type="url" value={statusPageUrl} disabled={saving} onChange={event => setStatusPageUrl(event.target.value)} /></label>
          <label className="form-label">Source format<select aria-label="Source format" value={format} disabled={saving} onChange={event => setFormat(event.target.value)}><option value="statuspage">Statuspage v2</option><option value="rss">RSS</option><option value="atom">Atom</option><option value="json">Configured JSON</option></select></label>
        </>}
        {(selectedVendor?.format === "statuspage" || !catalogId && format === "statuspage") && <label className="form-label">Vendor component ID (optional)<input value={componentId} disabled={saving} onChange={event => setComponentId(event.target.value)} /></label>}
        {!catalogId && format === "json" && <>
          <label className="form-label">State path<input required value={statePath} disabled={saving} onChange={event => setStatePath(event.target.value)} /></label>
          <label className="form-label">Incident path (optional)<input value={incidentPath} disabled={saving} onChange={event => setIncidentPath(event.target.value)} /></label>
          <label className="form-label">Summary path (optional)<input value={summaryPath} disabled={saving} onChange={event => setSummaryPath(event.target.value)} /></label>
          <label className="form-label full-width">JSON state mapping<textarea required rows={4} value={mappingText} disabled={saving} onChange={event => setMappingText(event.target.value)} /></label>
        </>}
        <label className="checkbox-label full-width"><input type="checkbox" checked={internal} disabled={saving} onChange={event => setInternal(event.target.checked)} />Keep this vendor component internal</label>
        <Button type="submit" disabled={saving || resource.loading}>{saving ? "Saving…" : "Follow vendor status"}</Button>
      </form>
      {selectedVendor && <><p>Read from <a href={selectedVendor.statusPageUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>{selectedVendor.name} status</a> at most once every two minutes.</p><StateMapping mapping={selectedVendor.mapping} /></>}
      {(error || resource.error || componentResource.error || templateResource.error) && <FormError>{error || resource.error || componentResource.error || templateResource.error}</FormError>}
      {message && <p role="status">{message}</p>}
    </section>
    {dependencies.length ? dependencies.map(dependency => <DependencyRow key={dependency.id} dependency={dependency} components={components} templates={templateResource.data?.templates ?? []} mapping={dependency.mapping ?? dependency.options?.json?.mapping ?? catalog.find(entry => new URL(dependency.sourceUrl).origin === entry.origin)?.mapping} refresh={resource.refresh} />) : <section className="data-card"><p>No vendor status sources are followed yet.</p></section>}
  </div>;
}
