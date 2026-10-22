import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { fromPageDateTime, toPageDateTime, usePageTimezone } from "../../../app/client/ui/timezone";
import { ComponentRelationships, NewIncidentComponents } from "./affected-components";
import { IncidentPreview } from "./incident-preview";
import { MoreOptions, OptionalText } from "./incident-more-options";
import { NextUpdateField } from "./next-update-field";
import { PublicationControls, publishHint } from "./publish-options";
import { StatusChoice } from "./status-choice";
import { TemplateControls } from "./template-controls";
import { useNewIncident } from "./use-new-incident";
import { useAppData } from "../../../app/client/ui/api";
import type { ComponentsService } from "../../components";

/** The new-incident screen: what is happening, who is affected, the next update and Publish, beside the preview.
 * With `onClose`, it stands in for an empty incident list (an empty list opens the create form). */
export function NewIncidentPage({ onClose }: { onClose?: () => void }) {
  const timezone = usePageTimezone();
  const { form, setForm, setUpdate, setChannels, preview, previewError, timeErrors, setTimeErrors, publishable, publishing, error, publish, savable, saveDraft, applyTemplate } = useNewIncident();
  const { data: componentData } = useAppData<{ components: Awaited<ReturnType<ComponentsService["list"]>> }>("/api/app/components");
  const [openedAtError, setOpenedAtError] = useState<string | null>(null);
  const { update } = form;
  const name = (componentId: string) => componentData?.components.find(component => component.id === componentId)?.name ?? "Component";
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
          {update.lifecycle === "Resolved" ? <p className="resolution-note" role="status">Resolved: no next update.</p> : <NextUpdateField value={update.nextUpdateAt} timezone={timezone} onChange={(value) => setUpdate("nextUpdateAt", value)} onError={(message) => setTimeErrors(current => ({ ...current, nextUpdate: message }))} />}
          {error ? <FormError>{error}</FormError> : null}
        </form>
      </section>
      <div className="incident-side"><IncidentPreview preview={preview} error={previewError} /></div>
      <div className="composer-publish" inert={publishing}>
          <MoreOptions footer={<><span className="publish-hint">{publishHint(form.channels, form.timing)}</span><Button type="button" disabled={!publishable || publishing || Boolean(openedAtError)} onClick={() => void publish()}>{publishing ? "Publishing…" : form.timing.mode === "schedule" ? "Schedule" : form.timing.mode === "backdate" ? "Publish historical update" : "Publish"}</Button></>}>
            <StatusChoice showLegend value={update.lifecycle} onChange={(lifecycle) => setUpdate("lifecycle", lifecycle)} />
            <OptionalText label="What still works" value={update.whatStillWorks} max={250} onChange={(value) => setUpdate("whatStillWorks", value)} />
            <OptionalText label="Details" value={update.details} max={500} onChange={(value) => setUpdate("details", value)} />
            <label className="form-label">Opened at<input aria-label="Opened at" type="datetime-local" value={toPageDateTime(form.openedAt, timezone)} onChange={(event) => { try { setForm(current => ({ ...current, openedAt: fromPageDateTime(event.target.value, timezone) })); setOpenedAtError(null); } catch (cause) { setOpenedAtError((cause as Error).message); } }} /><small>When it started, if earlier. Times in {timezone}.</small>{openedAtError ? <FormError>{openedAtError}</FormError> : null}</label>
            <PublicationControls channels={form.channels} onChannels={setChannels} timing={form.timing} timezone={timezone} error={timeErrors.timing} onTiming={(timing) => setForm(current => ({ ...current, timing }))} onError={(message) => setTimeErrors(current => ({ ...current, timing: message }))} />
            <ComponentRelationships rows={form.claims.map(claim => ({ componentId: claim.componentId, name: name(claim.componentId), relationship: claim.relationship }))} onChange={(componentId, relationship) => setForm(current => ({ ...current, claims: current.claims.map(claim => claim.componentId === componentId ? { ...claim, relationship } : claim) }))} />
            <TemplateControls draft={update} components={form.claims} onApply={async (template) => applyTemplate(template)} captureUpdate={() => () => true} />
            <div className="option-group private-draft"><Button type="button" variant="secondary" disabled={!savable || Boolean(openedAtError)} onClick={() => void saveDraft()}>Save as private draft</Button></div>
          </MoreOptions>
      </div>
    </div>
  </div>;
}
