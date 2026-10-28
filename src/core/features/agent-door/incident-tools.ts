import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import type { ApprovalSummary, ClassAndFacts, ToolContext, ToolDefinition } from '../../../base/modules/agent-door/types.ts';
import { ToolRefusal } from '../../../base/modules/agent-door/errors.ts';
import { incidentDraftSchema } from '../../shared/schemas';
import { createPublicationPreviewRepository } from "./publication-preview.repository";
import { mostSevereState } from "../../shared/domain";
import { incidentImpact } from "../../shared/incident-impact";
import { INCIDENT_IMPACTS } from '../../shared/incident-impact';
import { incidentIdInput, draftIdInput, nativeTool, standard, incident, version, requireVersion, incidentLink } from './incident-tool-support';
import { createIncidentSchema, publishSchema, scheduleSchema, internalNoteSchema, correctionSchema } from '../incidents/routes';
import { agentAction } from '../incidents/agent-action';
import { draftFromIncident } from '../incidents/draft';
import { reportTools } from './report-tools';
import { scheduleAgentJob } from './jobs';
import { readMaintenance } from './maintenance-tools';

const emptyInput = z.object({}).strict();
const saveInput = draftIdInput.extend({ draft: incidentDraftSchema }).strict();
const publicationInput = draftIdInput.extend(publishSchema.omit({ componentStates: true }).shape).strict();
const scheduleInput = draftIdInput.extend(scheduleSchema.shape).strict();
const noteInput = incidentIdInput.extend(internalNoteSchema.shape).strict();
const correctionInput = draftIdInput.extend(correctionSchema.shape).strict();
const impactInput = incidentIdInput.extend({ impactOverride: z.enum(INCIDENT_IMPACTS).nullable() }).strict();

/** Private preparation and public publication remain separate native actions. */
export function incidentTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const audience = createPublicationPreviewRepository(bindings.DB);
  const recipients = async (args: Record<string, unknown>) => {
    const current = await incident(services,args.id);
    const components = [...new Set([...current.components.flatMap(row=>row.componentId?[row.componentId]:[]),...(current.draft?.componentChanges.map(change=>change.componentId)??[])])];
    const peak = mostSevereState([current.impact ?? 'Operational',...(current.draft?.componentChanges.map(change=>change.state) ?? [])]);
    const impact = incidentImpact(peak,current.impactOverride).effectiveImpact;
    const retroactive = typeof args.publishedAt==='string' && Date.parse(args.publishedAt)<Date.now();
    return retroactive || current.updates.some(update=>update.isRetroactive) ? [] : audience.recipients(components,(args.channels as string[]) ?? [],impact);
  };
  const read = { scope: 'lamp:read', readOnly: true };
  const write = { scope: 'lamp:write', readOnly: false };
  const publish = { scope: 'lamp:publish', readOnly: false };
  const revision = async (args: Record<string, unknown>) => version(await incident(services, args.id));
  const draftSummary = async (args: Record<string, unknown>): Promise<ApprovalSummary> => {
    const current = await incident(services, args.id);
    return { target: { id: current.id, name: current.title }, items: [
      `Saved draft: ${requireVersion(current, args.draft_version)}`,
      JSON.stringify(args.draft ?? draftFromIncident(current)),
      ...current.components.map(component => `${component.componentName}: ${component.state}`),
    ] };
  };
  const publishSummary = async (args: Record<string, unknown>): Promise<ApprovalSummary> => {
    const current = await incident(services, args.id);
    const nativeVersion = requireVersion(current, args.draft_version);
    if (!current.draft) throw new ToolRefusal('saved_draft_required');
    const preview = await services.incidents.preview(current.id, draftFromIncident(current));
    if (!preview) throw new ToolRefusal('not_found');
    const recovery = current.draft.lifecycle === 'Resolved' ? await services.incidents.recoveryCheck(current.id) : null;
    return { target: { id: current.id, name: current.title }, recipients: ['Public status page', ...await recipients(args)], items: [
      `Saved preview: ${nativeVersion}`, preview.email.plainText,
      ...current.components.map(component => `${component.componentName}: ${component.state}`),
      ...(current.draft.nextUpdateAt && current.draft.lifecycle !== 'Resolved' ? [`Next update promised by ${current.draft.nextUpdateAt}`] : []),
      ...(args.overrideReason ? [`Private recovery override: ${String(args.overrideReason)}`] : []),
      ...(args.publishAt ? [`Publish at ${String(args.publishAt)}`] : []),
      ...(recovery ? [`Current recovery: ${JSON.stringify({ passed: recovery.passed, items: recovery.items, notTracked: recovery.notTracked, trafficLearning: recovery.trafficLearning })}`] : []),
    ] };
  };
  const publicationClasses = async (args: Record<string, unknown>): Promise<ClassAndFacts[]> => {
    const current = await incident(services, args.id);
    requireVersion(current, args.draft_version);
    const draft = current.draft;
    if (!draft) throw new ToolRefusal('saved_draft_required');
    const classes: ClassAndFacts[] = [{ class: 'external', facts: { measure: 1 + (await recipients(args)).length, counterparty: 'public' } }];
    const changesLiveState = current.lifecycle !== draft.lifecycle || draft.componentChanges.some(change => {
      const before = current.components.find(component => component.componentId === change.componentId);
      return before?.state !== change.state;
    }) || current.updates.length === 0;
    if (changesLiveState) classes.push({ class: 'live', facts: { measure: 1, service: 'public status page' } });
    if (draft.lifecycle === 'Resolved' || (draft.nextUpdateAt && draft.nextUpdateAt !== current.updates[0]?.nextUpdateAt)) classes.push({ class: 'commitment', facts: { measure: 0, currency: 'XXX', counterparty: 'public' } });
    return classes;
  };
  const publishRun = (resolve: boolean) => async (args: Record<string, unknown>, ctx: ToolContext) => {
    const current = await incident(services, args.id);
    const draftVersion = requireVersion(current, args.draft_version);
    if (resolve && current.draft?.lifecycle !== 'Resolved') throw new ToolRefusal('resolved_draft_required');
    if (!resolve && current.draft?.lifecycle === 'Resolved') throw new ToolRefusal('use_resolve');
    const { id: _id, draft_version: _version, ...input } = publicationInput.parse(args);
    const update = await services.incidents.publish(current.id, ctx.person.id, { ...input, expectedVersion: draftVersion }, agentAction(ctx));
    if (!update) throw new ToolRefusal('saved_draft_required');
    await services.incidents.finishPublication(update);
    ctx.emit(resolve ? 'incident.resolved' : 'incident.published', `lamp://incidents/${current.id}`, { updateId: update.id });
    return { result: { update, revision: `${update.id}:${current.updates.length + 1}` }, resources: incidentLink(current.id) };
  };
  return [
    nativeTool(emptyInput, {
      name: 'lamp.status.read', title: 'Read status', description: 'Read stored components, active incident summaries and maintenance without performing health or provider checks.', ...read,
      classes: ['standard'], clauses: ['PAGE-001', 'INCIDENT-001', 'COMP-006'], classify: standard,
      async run() {
        const [components, incidents, maintenance] = await Promise.all([services.components.list(), services.incidents.list(), readMaintenance(bindings.DB)]);
        return { result: { components, incidents: incidents.filter(row => row.lifecycle !== 'Resolved').map(({ id, title, reference, lifecycle, effectiveImpact, components, overdue }) => ({ id, title, reference, lifecycle, effectiveImpact, components, overdue })), maintenance } };
      },
    }),
    nativeTool(incidentIdInput, {
      name: 'lamp.incidents.read', title: 'Read incident', description: 'Read the current native incident, private draft, notes and published versions.', ...read, untrusted: true,
      classes: ['standard', 'sensitive'], clauses: ['INCIDENT-001', 'INCIDENT-008', 'UPDATE-005'],
      async classify(args) { const current = await incident(services, args.id); return [...standard(), ...(current.internalNotes.length ? [{ class: 'sensitive' as const, facts: { measure: current.internalNotes.length, kind: 'private operator notes' } }] : [])]; },
      async run(args) { const value = await incident(services, args.id); return { result: { incident: value, revision: version(value) }, resources: incidentLink(value.id) }; },
    }),
    nativeTool(incidentIdInput, {
      name: 'lamp.incidents.brief', title: 'Read incident brief', description: 'Read the model-free cited brief; internal notes are excluded from its evidence.', ...read, untrusted: true,
      classes: ['standard'], clauses: ['DRAFT-004', 'AGENT-001'], classify: standard,
      async run(args) { const value = await incident(services, args.id); return { result: { brief: await services.briefs.get(value.id) }, resources: [{ uri: `lamp://incidents/${value.id}/brief`, name: 'Cited incident brief' }] }; },
    }),
    nativeTool(incidentIdInput, {
      name: 'lamp.recovery.read', title: 'Read recovery evidence', description: 'Read current accepted recovery and traffic evidence; this does not run a monitor or establish recovery.', ...read, untrusted: true,
      classes: ['standard'], clauses: ['AGENT-004', 'HIST-006'], classify: standard,
      async run(args) { const value = await incident(services, args.id); return { result: { recovery: await services.incidents.recoveryCheck(value.id) }, resources: [{ uri: `lamp://incidents/${value.id}/recovery`, name: 'Recovery evidence' }] }; },
    }),
    nativeTool(createIncidentSchema, {
      name: 'lamp.incidents.create', title: 'Create private incident', description: 'Open a private native incident with components and a saved first draft. No public state or notice changes.', ...write,
      classes: ['standard'], clauses: ['INCIDENT-001', 'UPDATE-005'], classify: standard,
      summary(args) { const input = createIncidentSchema.parse(args); return { target: { name: input.title }, items: [JSON.stringify(input)] }; },
      async run(args, ctx) { const value = await services.incidents.create(createIncidentSchema.parse(args), ctx.person.id); ctx.emit('incident.created', `lamp://incidents/${value.id}`); return { result: { incident: value, revision: version(value) }, resources: incidentLink(value.id) }; },
    }),
    ...(['lamp.drafts.save', 'lamp.incidents.update'] as const).map(name => nativeTool(saveInput, {
      name, title: name === 'lamp.drafts.save' ? 'Save incident draft' : 'Update private incident draft', description: 'Save exact native draft fields and staged component choices at the acknowledged draft version. Nothing publishes.', ...write,
      classes: ['standard'], clauses: ['UPDATE-005', 'UPDATE-012'], classify: standard, revisionType: 'string', revision,
      summary: draftSummary,
      async run(args, ctx) { const input = saveInput.parse(args); const current = await incident(services, input.id); requireVersion(current, input.draft_version); const draft = await services.incidents.saveDraft(input.id, input.draft, ctx.person.id, input.draft_version); if (!draft) throw new ToolRefusal('not_found'); ctx.emit('incident.draft.saved', `lamp://incidents/${input.id}`); return { result: { draft, revision: `${draft.id}:${current.updates.length}` }, resources: [{ uri: `lamp://incidents/${input.id}/draft/${draft.id}:${current.updates.length}`, name: 'Saved private draft' }] }; },
    })),
    nativeTool(noteInput, {
      name: 'lamp.incidents.note', title: 'Add internal note', description: 'Add a private native note. It is never inserted into the AI brief or public projection.', ...write, untrusted: true,
      classes: ['standard'], clauses: ['INCIDENT-008'], classify: standard,
      async summary(args) { const value = await incident(services, args.id); return { target: { id: value.id, name: value.title }, items: [String(args.body)] }; },
      async run(args, ctx) { const input = noteInput.parse(args); if (!await services.incidents.addInternalNote(input.id, input.body, ctx.person.id)) throw new ToolRefusal('not_found'); ctx.emit('incident.note.added', `lamp://incidents/${input.id}`); return { result: { created: true }, resources: incidentLink(input.id) }; },
    }),
    nativeTool(impactInput, {
      name: 'lamp.impact.update', title: 'Update incident impact', description: 'Set the native impact override without changing or fabricating recovery evidence.', ...write,
      classes: ['standard', 'external', 'live'], clauses: ['INCIDENT-002', 'INCIDENT-013'],
      async classify(args) { const value = await incident(services, args.id); return value.updates.length ? [{ class: 'external', facts: { measure: 1, counterparty: 'public' } }, { class: 'live', facts: { measure: 1, service: 'public incident impact' } }] : standard(); },
      revisionType: 'string', async revision(args) { return JSON.stringify(await services.incidentImpact.get(String(args.id))); },
      async summary(args) { const value = await incident(services, args.id); return { target: { id: value.id, name: value.title }, items: [`Impact: ${String(args.impactOverride ?? 'component-derived')}`] }; },
      async run(args, ctx) { const input = impactInput.parse(args); await incident(services, input.id); const impact = await services.incidentImpact.set(input.id, input.impactOverride, ctx.person.id); ctx.emit('incident.impact.changed', `lamp://incidents/${input.id}`); return { result: { impact }, resources: incidentLink(input.id) }; },
    }),
    ...(['lamp.incidents.publish', 'lamp.incidents.resolve'] as const).map(name => nativeTool(publicationInput, {
      name, title: name.endsWith('resolve') ? 'Publish checked resolution' : 'Publish saved incident update', description: 'Publish the exact saved native draft under policy, current recovery, component and configured reviewer rules. Captures the eligible native notification audience once.', ...publish,
      classes: ['external', 'live', 'commitment'], clauses: ['UPDATE-001', 'UPDATE-007', 'UPDATE-008', 'AGENT-004', 'AGENT-008'],
      classify: publicationClasses, summary: publishSummary, revisionType: 'string', revision, run: publishRun(name.endsWith('resolve')),
    })),
    nativeTool(correctionInput, {
      name: 'lamp.updates.correct', title: 'Mark correction draft', description: 'Mark a saved private draft as a correction to a published native update; publication remains a distinct action.', ...write,
      classes: ['standard'], clauses: ['INCIDENT-004'], classify: standard, summary: draftSummary, revisionType: 'string', revision,
      async run(args, ctx) { const input = correctionInput.parse(args); requireVersion(await incident(services, input.id), input.draft_version); if (!await services.incidents.markCorrection(input.id, input.updateId, input.draft_version)) throw new ToolRefusal('native_conflict'); ctx.emit('incident.correction.marked', `lamp://incidents/${input.id}`); return { result: { marked: true }, resources: incidentLink(input.id) }; },
    }),
    nativeTool(scheduleInput, {
      name: 'lamp.updates.schedule', title: 'Schedule saved publication', description: 'Retain the saved version and originating agent consent for a future typed publication. Final admission checks current authority, policy, Pause, recovery and review again.', ...publish,
      classes: ['external', 'live', 'commitment'], clauses: ['UPDATE-006', 'UPDATE-005', 'AGENT-004'], classify: publicationClasses, summary: publishSummary, revisionType: 'string', revision,
      async run(args, ctx) {
        const input = scheduleInput.parse(args); const current = await incident(services, input.id); requireVersion(current, input.draft_version);
        const draft = await services.incidents.schedule(input.id, ctx.person.id, input.publishAt, input.channels, input.draft_version, true);
        if (!draft) throw new ToolRefusal('saved_draft_required');
        const scheduledVersion = `${draft.id}:${current.updates.length}`;
        const job = await scheduleAgentJob(ctx, { tool: draft.lifecycle === 'Resolved' ? 'lamp.incidents.resolve' : 'lamp.incidents.publish', dueAt: input.publishAt, expectedRevision: scheduledVersion, args: { id: input.id, draft_version: scheduledVersion, channels: input.channels } });
        ctx.emit('incident.publication.scheduled', `lamp://incidents/${input.id}`);
        return { result: { draft, job, revision: scheduledVersion }, resources: incidentLink(input.id) };
      },
    }),
    ...reportTools(bindings,services),
  ];
}
