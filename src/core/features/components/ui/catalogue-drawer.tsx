import { useState } from "react";
import type { CataloguePreview, CatalogueSnapshot, ComponentCatalogue } from "../catalogue-schema";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Drawer } from "../../../app/client/ui/drawer";
import { FormError, LoadingState } from "../../../app/client/ui/states";
import { CatalogueTables } from "./catalogue-tables";

export function CatalogueDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data, error, loading } = useAppData<CatalogueSnapshot>("/api/app/components/bulk");
  return <Drawer title="Bulk edit components" eyebrow="Component catalogue" className="catalogue-drawer" onClose={onClose}>
    {loading ? <LoadingState /> : error ? <FormError>{error}</FormError> : data ? <CatalogueWorkspace initial={data} onClose={onClose} onSaved={onSaved} /> : null}
  </Drawer>;
}

function CatalogueWorkspace({ initial, onClose, onSaved }: { initial: CatalogueSnapshot; onClose: () => void; onSaved: () => void }) {
  const [catalogue, setCatalogue] = useState(initial.catalogue);
  const [revision, setRevision] = useState(initial.revision);
  const [mode, setMode] = useState<"table" | "csv">("table");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<CataloguePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = (next: ComponentCatalogue) => { setCatalogue(next); setPreview(null); setError(null); };
  const selectMode = (next: "table" | "csv") => { setMode(next); setPreview(null); setError(null); };
  async function review() {
    setBusy(true); setError(null); setPreview(null);
    try {
      const next = await appApi<CataloguePreview>("/api/app/components/bulk/preview", { method: "POST", body: JSON.stringify(mode === "csv" ? { csv } : { catalogue, revision }) });
      setPreview(next);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true); setError(null);
    try {
      await appApi("/api/app/components/bulk/apply", { method: "POST", body: JSON.stringify({ catalogue: preview.catalogue, revision: preview.revision, reviewToken: preview.reviewToken }) });
      onSaved();
    } catch (cause) { setError((cause as Error).message); setPreview(null); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError(null); setPreview(null);
    try {
      const next = await appApi<CatalogueSnapshot>("/api/app/components/bulk");
      setCatalogue(next.catalogue); setRevision(next.revision);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="catalogue-workspace">
    <p className="drawer-copy">Edit components and groups together, then review the changes before applying them. Removing a group makes its remaining components ungrouped. Published updates keep a removed component's name.</p>
    <div className="form-actions"><Button variant="secondary" type="button" aria-pressed={mode === "table"} disabled={busy} onClick={() => selectMode("table")}>Edit table</Button><Button variant="secondary" type="button" aria-pressed={mode === "csv"} disabled={busy} onClick={() => selectMode("csv")}>Import CSV</Button></div>
    {mode === "table" ? <CatalogueTables catalogue={catalogue} disabled={busy} onChange={change} /> : <section className="component-editor-form">
      <label className="form-label">CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setPreview(null); setError(null); try { setCsv(await file.text()); } catch (cause) { setError((cause as Error).message); } }} /></label>
      <label className="form-label">CSV contents<textarea rows={8} disabled={busy} value={csv} onChange={event => { setCsv(event.target.value); setPreview(null); setError(null); }} /></label>
      <p>Required header: <code>name</code>. Optional headers: <code>id,group,description,display_order,group_order,internal,only_show_if_degraded,uptime_start_date,note,action</code>. Dates use YYYY-MM-DD; visibility values use true or false. Quote fields containing commas, quotes or newlines.</p>
      <p>Rows without an ID create components. Existing components remain unless a row names their ID and sets action to delete. New group names create groups. Positions start at zero.</p>
    </section>}
    {error && <><FormError>{error}</FormError><Button variant="secondary" type="button" disabled={busy} onClick={reload}>Discard table edits and reload current catalogue</Button></>}
    {preview && <section className="data-card" aria-label="Catalogue review"><h3>Review changes</h3><p role="status">Dry run complete. Nothing has been written.</p><p>Components: {preview.counts.components.created} created, {preview.counts.components.changed} changed, {preview.counts.components.deleted} deleted. Groups: {preview.counts.groups.created} created, {preview.counts.groups.changed} changed, {preview.counts.groups.deleted} deleted.</p>
      {preview.removed.components.length > 0 && <p>Components to delete: {preview.removed.components.join(", ")}</p>}{preview.removed.groups.length > 0 && <p>Groups to delete: {preview.removed.groups.join(", ")}</p>}
      {mode === "csv" && <details><summary>Inspect the resulting catalogue</summary><CatalogueTables catalogue={preview.catalogue} disabled onChange={() => {}} /></details>}
    </section>}
    <div className="drawer-actions"><Button variant="secondary" type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="secondary" type="button" disabled={busy} onClick={review}>{busy ? "Working…" : "Review changes"}</Button><Button type="button" disabled={busy || !preview} onClick={apply}>{busy ? "Working…" : "Apply reviewed changes"}</Button></div>
  </div>;
}
