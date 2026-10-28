import type { AppBindings } from "../../app/types";
import type { AppServices } from "../../app/services";
import type { ClassAndFacts, ResourceDefinition } from "../../../base/modules/agent-door/types.ts";
import { createIncidentRepository } from "../incidents/repository";
import { createMaintenanceRepository } from "../maintenance/repository";
import { createAgentResourceRepository } from "./resources/repository";
import type { PublishingDraft } from "../incidents/repository";

type RecordJson = Record<string, unknown>;
const standard = (): ClassAndFacts[] => [{ class: "standard", facts: { measure: 1 } }];
const protectedRead = (kind: string): ClassAndFacts[] => [...standard(), { class: "sensitive", facts: { measure: 1, kind } }];

function savedDraft(draft: PublishingDraft | null, internalIds: Set<string> = new Set()) {
  if (!draft) return null;
  return { id: draft.id, incidentId: draft.incidentId, lifecycle: draft.lifecycle,
    affectedAudience: draft.affectedAudience, customerImpact: draft.customerImpact, whatStillWorks: draft.whatStillWorks,
    details: draft.details, nextUpdateAt: draft.nextUpdateAt,
    componentChanges: draft.componentChanges.map(change => ({ ...change, internal: internalIds.has(change.componentId) })),
    authorOperatorId: draft.authorOperatorId, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
    scheduledPublishAt: draft.scheduledPublishAt, scheduledChannels: draft.scheduledChannels,
    reviewedByOperatorId: draft.reviewedByOperatorId, reviewedAt: draft.reviewedAt, correctsUpdateId: draft.correctsUpdateId };
}

function identity(uri: string, family: string, tail: string[] = []) {
  try {
    const url = new URL(uri), parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    return url.protocol === "lamp:" && url.hostname === family && !url.search && !url.hash
      && parts.length === tail.length + 1 && tail.every((part, index) => part === "{version}" || parts[index + 1] === part)
      ? { id: parts[0], version: tail.includes("{version}") ? parts.at(-1) : undefined } : null;
  } catch { return null; }
}

/** Private projections use current native admission. Public display facts are
 * separated below from notes; a private note never enters a brief or report. */
export function lampResources(bindings: AppBindings, services: AppServices): ResourceDefinition[] {
  const repository = createAgentResourceRepository(bindings.DB);
  const incidentRepository = createIncidentRepository(bindings.DB);
  const maintenanceRepository = createMaintenanceRepository(bindings.DB);
  function resource(family: string, tail: string[], name: string,
    read: (id: string, version?: string, personId?: string) => Promise<unknown | null>,
    classify: (json: RecordJson) => ClassAndFacts[] = standard, sensitive = false): ResourceDefinition {
    const uriTemplate = `lamp://${family}/{id}${tail.length ? "/" + tail.join("/") : ""}`;
    return {
      uriTemplate, name, description: `${name} from Lamp's current native record; outside text is untrusted.`, mimeType: "application/json",
      scope: "lamp:read", classes: sensitive ? ["standard", "sensitive"] : ["standard"],
      classify(record) { return classify(record.json as RecordJson); },
      async read(uri, ctx) {
        const target = identity(uri, family, tail);
        if (!target || !await repository.admitted(ctx, family)) return null;
        const json = await read(target.id, target.version, ctx.person.id);
        return json === null ? null : { json, untrusted: true };
      },
    };
  }

  return [
    resource("components", [], "Component", async id => services.components.get(id),
      json => json.internal === true ? protectedRead("internal component details") : standard(), true),
    resource("incidents", [], "Private incident", async id => {
      const incident = await services.incidents.get(id);
      if (!incident) return null;
      const internalComponents = new Set((await services.components.list()).filter(component => component.internal).map(component => component.id));
      return { id: incident.id, reference: incident.reference, title: incident.title, lifecycle: incident.lifecycle,
        openedAt: incident.openedAt, resolvedAt: incident.resolvedAt, impact: incident.impact,
        components: incident.components.map(component => ({ ...component, internal: internalComponents.has(component.componentId ?? "") })),
        updates: incident.updates, draft: savedDraft(incident.draft, internalComponents), internalNotes: incident.internalNotes,
        owner: incident.owner, unowned: incident.unowned };
    }, json => (Array.isArray(json.internalNotes) && json.internalNotes.length > 0)
      || (Array.isArray(json.components) && json.components.some(component => (component as RecordJson).internal === true))
      || Boolean(json.draft && Array.isArray((json.draft as RecordJson).componentChanges)
        && ((json.draft as RecordJson).componentChanges as RecordJson[]).some(component => component.internal === true))
      ? protectedRead("private incident notes or internal components") : standard(), true),
    resource("incidents", ["public"], "Published incident projection", async id => {
      const incident = await services.incidents.get(id);
      if (!incident || incident.updates.length === 0) return null;
      const publicComponents = new Set((await services.components.list()).filter(component => !component.internal).map(component => component.id));
      return { id: incident.id, reference: incident.reference, title: incident.title, lifecycle: incident.lifecycle,
        openedAt: incident.openedAt, resolvedAt: incident.resolvedAt, impact: incident.impact,
        components: incident.components.filter(component => component.publishedAt !== null && publicComponents.has(component.componentId ?? "")),
        updates: incident.updates };
    }),
    resource("incidents", ["brief"], "Incident brief", async id => {
      const brief = await services.briefs.get(id);
      if (!brief) return null;
      return { ...brief, whatWeKnow: { ...brief.whatWeKnow, alerts: brief.whatWeKnow.alerts.map(({ payload: _payload, ...alert }) => alert) } };
    }),
    resource("incidents", ["recovery"], "Reported recovery evidence", async id => services.incidents.recoveryCheck(id)),
    resource("incidents", ["draft", "{version}"], "Exact saved incident draft", async (id, version) => {
      const [incident, draft, updates] = await Promise.all([
        incidentRepository.findIncident(id), incidentRepository.findPublishingDraft(id), incidentRepository.listUpdates(id),
      ]);
      if (!incident || incident.deletedAt || !draft || `${draft.id}:${updates.length}` !== version) return null;
      const internalIds = new Set((await services.components.list()).filter(component => component.internal).map(component => component.id));
      return { incidentId: id, version, draft: savedDraft(draft, internalIds) };
    }, json => json.draft && ((json.draft as RecordJson).componentChanges as RecordJson[]).some(component => component.internal === true)
      ? protectedRead("internal component details in saved draft") : standard(), true),
    resource("maintenance", [], "Maintenance", async id => {
      const record = await maintenanceRepository.find(id);
      if (!record) return null;
      const [components, notices, automation] = await Promise.all([
        maintenanceRepository.listComponents(id), maintenanceRepository.listNotices(id), maintenanceRepository.automation.get(id),
      ]);
      const internalIds = new Set((await services.components.list()).filter(component => component.internal).map(component => component.id));
      return { ...record, components: components.map(component => ({ ...component, internal: internalIds.has(component.componentId ?? "") })), notices, ...automation };
    }, json => Array.isArray(json.components) && json.components.some(component => (component as RecordJson).internal === true)
      ? protectedRead("internal maintenance components") : standard(), true),
    resource("subscribers", [], "Subscriber consent and selections", async id => repository.subscriber(id)),
    resource("deliveries", [], "Delivery outcome", async id => repository.delivery(id)),
    resource("imports", ["report"], "Saved import report", async (id, _version, personId) => repository.importReport(id, personId!)),
    resource("reports", [], "Post-incident report", async id => {
      const record = await repository.reportIncident(id);
      return record ? services.reports.get(record.incidentId) : null;
    }),
  ];
}
