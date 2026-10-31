import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";

import { INCIDENT_LIFECYCLES, type IncidentLifecycle } from "../../../shared/domain";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { fromPageDateTime, toPageDateTime, usePageTimezone } from "../../../app/client/ui/timezone";
import { ComponentRelationships, NewIncidentComponents, relationshipSummary } from "./affected-components";
import { IncidentPreview } from "./incident-preview";
import { NextUpdateField } from "./next-update-field";
import { OptionalText } from "./optional-text";
import { NotifyChannels, PublishTimingField, channelSummary, publishHint, publishTime, type PublishTiming } from "./publish-options";
import { TemplateControls } from "./template-controls";
import { OptionPanel, UpdateOptions, type OptionGroup } from "./update-options";
import { useNewIncident } from "./use-new-incident";
import { useAppData } from "../../../app/client/ui/api";
import type { ComponentsService } from "../../components";

/** The new-incident screen: what is happening, who is affected, the next update and Publish, beside the preview.
 * Its starting status and everything else sit behind the + (Update options).
 * With `onClose`, it stands in for an empty incident list (an empty list opens the create form). */
export function NewIncidentPage({ onClose }: { onClose?: () => void }) {
  const timezone = usePageTimezone();
  const { form, setForm, setUpdate, setChannels, preview, previewError, timeErrors, setTimeErrors, publishable, publishing, error, publish, savable, saveDraft, applyTemplate } = useNewIncident();
  const { data: componentData } = useAppData<{ components: Awaited<ReturnType<ComponentsService["list"]>> }>("/api/app/components");
  const [openedAtError, setOpenedAtError] = useState<string | null>(null);
  const [shownFields, setShownFields] = useState({ whatStillWorks: false, details: false, openedAt: false });
  const stillWorksId = useId(), detailsId = useId(), openedAtId = useId();
  const { update } = form;
  const name = (componentId: string) => componentData?.components.find(component => component.id === componentId)?.name ?? "Component";
  const relationshipRows = form.claims.map(claim => ({ componentId: claim.componentId, name: name(claim.componentId), relationship: claim.relationship }));
  const chooseTiming = (mode: PublishTiming["mode"]) => { if (form.timing.mode !== mode) { setForm(current => ({ ...current, timing: { mode, at: null } })); setTimeErrors(current => ({ ...current, timing: null })); } };
  const groups: OptionGroup[] = [
    { caption: "Status", choice: { options: INCIDENT_LIFECYCLES, value: update.lifecycle, onChange: (lifecycle) => setUpdate("lifecycle", lifecycle as IncidentLifecycle) } },
    { caption: "Add to this update", entries: [
      { key: "still-works", label: "What still works", glyph: "lines", target: stillWorksId, onSelect: () => setShownFields(current => ({ ...current, whatStillWorks: true })) },
      { key: "details", label: "Details", glyph: "lines", target: detailsId, onSelect: () => setShownFields(current => ({ ...current, details: true })) },
      { key: "opened-at", label: "Opened at", glyph: "clock", value: form.openedAt ? publishTime(form.openedAt, timezone) : undefined, target: openedAtId, onSelect: () => setShownFields(current => ({ ...current, openedAt: true })) },
      ...(relationshipRows.length ? [{ key: "relationship", label: "Relationship…", glyph: "link" as const, value: relationshipSummary(relationshipRows), panel: "relationship" }] : []),
    ] },
    { caption: "Send", entries: [
      { key: "notify", label: "Notify…", glyph: "send", value: channelSummary(form.channels), panel: "notify" },
      { key: "schedule", label: "Schedule…", glyph: "calendar", value: form.timing.mode === "schedule" && form.timing.at ? publishTime(form.timing.at, timezone) : undefined, panel: "timing", onSelect: () => chooseTiming("schedule") },
      { key: "backdate", label: "Backdate…", glyph: "clock", value: form.timing.mode === "backdate" && form.timing.at ? publishTime(form.timing.at, timezone) : undefined, panel: "timing", onSelect: () => chooseTiming("backdate") },
    ] },
    { caption: "Templates", entries: [
      { key: "use-template", label: "Use a template", glyph: "template", panel: "template-use" },
      { key: "save-template", label: "Save as a template", glyph: "template", panel: "template-save" },
    ] },
    { caption: "Draft", entries: [
      { key: "private-draft", label: "Save as private draft", glyph: "lock", disabled: !savable || Boolean(openedAtError), value: savable ? undefined : "Title and component first", onSelect: () => void saveDraft() },
    ] },
  ];
  return <div className="incident-page new-incident">
    <header className="incident-heading">
      {onClose ? null : <Link className="back-link" to="/app/incidents">← Incidents</Link>}
      <div className="incident-title-row"><h1>New incident</h1>{onClose ? <Button type="button" variant="secondary" onClick={onClose}>Close</Button> : null}</div>
    </header>
    <div className="incident-compose">
      <section className="composer-panel" aria-label="New incident" inert={publishing}>
        <form className="impact-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="impact-field">
            <legend>What’s happening?</legend>
            <input aria-label="Incident title" required maxLength={250} placeholder="Title customers will see" value={form.title} onChange={(event) => setForm(current => ({ ...current, title: event.target.value }))} />
            <textarea aria-label="Customer impact" required rows={2} maxLength={250} placeholder="What customers see" value={update.customerImpact} onChange={(event) => setUpdate("customerImpact", event.target.value)} />
          </fieldset>
          <fieldset className="impact-field">
            <legend>Who’s affected?</legend>
            <NewIncidentComponents claims={form.claims} onChange={(claims) => setForm(current => ({ ...current, claims }))} />
            <input aria-label="Who is affected" required maxLength={250} placeholder="Which customers" value={update.affectedAudience} onChange={(event) => setUpdate("affectedAudience", event.target.value)} />
          </fieldset>
          <OptionalText id={stillWorksId} label="What still works" value={update.whatStillWorks} max={250} shown={shownFields.whatStillWorks} onChange={(value) => setUpdate("whatStillWorks", value)} />
          <OptionalText id={detailsId} label="Details" value={update.details} max={500} shown={shownFields.details} onChange={(value) => setUpdate("details", value)} />
          <div className="form-label option-text" hidden={!shownFields.openedAt && !form.openedAt && !openedAtError}><label htmlFor={openedAtId}>Opened at</label><input id={openedAtId} type="datetime-local" value={toPageDateTime(form.openedAt, timezone)} onChange={(event) => { try { setForm(current => ({ ...current, openedAt: fromPageDateTime(event.target.value, timezone) })); setOpenedAtError(null); } catch (cause) { setOpenedAtError((cause as Error).message); } }} /><small>When it started, if earlier. Times in {timezone}.</small>{openedAtError ? <FormError>{openedAtError}</FormError> : null}</div>
          {update.lifecycle === "Resolved" ? <p className="resolution-note" role="status">Resolved: no next update.</p> : <NextUpdateField value={update.nextUpdateAt} timezone={timezone} onChange={(value) => setUpdate("nextUpdateAt", value)} onError={(message) => setTimeErrors(current => ({ ...current, nextUpdate: message }))} />}
          {error ? <FormError>{error}</FormError> : null}
        </form>
      </section>
      <div className="incident-side"><IncidentPreview preview={preview} error={previewError} /></div>
      <div className="composer-publish" inert={publishing}>
        <UpdateOptions groups={groups} footer={<><span className="publish-hint">{publishHint(form.channels, form.timing, timezone)}</span><Button type="button" disabled={!publishable || publishing || Boolean(openedAtError)} onClick={() => void publish()}>{publishing ? "Publishing…" : form.timing.mode === "schedule" ? "Schedule" : form.timing.mode === "backdate" ? "Publish historical update" : "Publish"}</Button></>}>
          <OptionPanel name="notify" title="Notify"><NotifyChannels channels={form.channels} onChange={setChannels} /></OptionPanel>
          <OptionPanel name="timing" title="When it publishes"><PublishTimingField timing={form.timing} timezone={timezone} error={timeErrors.timing} onChange={(timing) => setForm(current => ({ ...current, timing }))} onError={(message) => setTimeErrors(current => ({ ...current, timing: message }))} /></OptionPanel>
          <OptionPanel name="relationship" title="Relationship"><ComponentRelationships rows={relationshipRows} onChange={(componentId, relationship) => setForm(current => ({ ...current, claims: current.claims.map(claim => claim.componentId === componentId ? { ...claim, relationship } : claim) }))} /></OptionPanel>
          <TemplateControls draft={update} components={form.claims} onApply={async (template) => applyTemplate(template)} captureUpdate={() => () => true} />
        </UpdateOptions>
      </div>
    </div>
  </div>;
}
