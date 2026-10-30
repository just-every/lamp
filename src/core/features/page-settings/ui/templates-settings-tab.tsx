import { useCallback, useEffect, useRef, useState } from "react";

import type { IncidentTemplate } from "../../incidents/template-repository";
import { TemplateEditor } from "../../incidents/ui/template-editor";
import { useAppData } from "../../../app/client/ui/api";
import { useLeaveGuard } from "../../../app/client/ui/leave-guard";
import { FormError, LoadingState } from "../../../app/client/ui/states";

const LEAVE_EDIT = "Leave without saving these template changes?";

/** Settings › Templates: choose a saved update template and edit it with the incident editor's own form. */
export function TemplatesSettingsTab() {
  const { data, error, loading, refresh } = useAppData<{ templates: IncidentTemplate[] }>("/api/app/incident-templates");
  const [selected, setSelected] = useState("");
  const [edited, setEdited] = useState<IncidentTemplate | null>(null);
  const [dirty, setDirty] = useState(false);
  const visit = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; visit.current++; }; }, []);
  // A save answered after the owner chose another template, or left, changes nothing on screen.
  const captureUpdate = useCallback(() => { const version = visit.current; return () => mounted.current && visit.current === version; }, []);
  // Unsaved template edits hold a pane switch, a route change and signing out until the owner agrees to drop them.
  useLeaveGuard(async () => !dirty || window.confirm(LEAVE_EDIT), () => dirty);

  if (loading && !data) return <LoadingState>Loading templates…</LoadingState>;
  if (!data) return <FormError>{error ?? "Templates could not be loaded."}</FormError>;
  const template = edited?.id === selected ? edited : data.templates.find(item => item.id === selected);

  function choose(id: string) {
    if (dirty && !window.confirm(LEAVE_EDIT)) return;
    visit.current++;
    setSelected(id); setEdited(null); setDirty(false);
  }

  return <section className="data-card templates-card" aria-label="Update templates">
    {data.templates.length ? <label className="form-label">Saved update template<select aria-label="Saved update template" value={selected} onChange={event => choose(event.target.value)}>
      <option value="">Choose a saved template</option>
      {data.templates.map(item => <option key={item.id} value={item.id}>{item.folder ? `${item.folder} / ` : ""}{item.name}</option>)}
    </select></label> : <p>No saved templates yet. Save an update as a template from an incident.</p>}
    {template ? <TemplateEditor key={template.id} template={template} captureUpdate={captureUpdate} onDirty={setDirty} onSaved={saved => { setEdited(saved); refresh(); }} /> : null}
  </section>;
}
