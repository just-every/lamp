import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import { createPublicationPreviewRepository } from './publication-preview.repository';
import type { ToolDefinition } from '../../../base/modules/agent-door/types.ts';
import { ToolRefusal } from '../../../base/modules/agent-door/errors.ts';
import type { AppServices } from '../../app/services';
import { incidentIdInput, nativeTool, standard, incident, incidentLink } from './incident-tool-support';
import { agentAction } from '../incidents/agent-action';
import type { IncidentReportRow } from '../reports/repository';

const reportInput = incidentIdInput.extend({
  report: z.object({ summary: z.string().trim().max(10_000), timeline: z.string().trim().max(10_000), cause: z.string().trim().max(10_000), remediation: z.string().trim().max(10_000) }).strict(),
}).strict();
const publicationInput = incidentIdInput.extend({ report_version: z.string().min(1), channels: z.array(z.enum(['email', 'webhook', 'sms'])).max(3) }).strict();
const reportVersion = (report: IncidentReportRow | null) => report ? `${report.id}:${report.updatedAt}` : '-';

export function reportTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const audience = createPublicationPreviewRepository(bindings.DB);
  const recipients = async (args: Record<string,unknown>) => { const value = await incident(services,args.id); return audience.recipients(value.components.flatMap(row=>row.componentId?[row.componentId]:[]),(args.channels as string[])??[],value.effectiveImpact); };
  const read = { scope: 'lamp:read', readOnly: true };
  const write = { scope: 'lamp:write', readOnly: false };
  return [
    nativeTool(incidentIdInput, {
      name: 'lamp.reports.read', title: 'Read post-incident report', description: 'Read the actual saved report and publication state.', ...read,
      classes: ['standard'], clauses: ['HIST-002', 'AGENT-005'], classify: standard,
      async run(args) { const current = await incident(services, args.id); const report = await services.reports.get(current.id); return { result: { report, revision: reportVersion(report) }, resources: [{ uri: `lamp://reports/${current.id}`, name: 'Post-incident report' }] }; },
    }),
    nativeTool(incidentIdInput, {
      name: 'lamp.reports.draft', title: 'Draft report from record', description: 'Create the native cited report draft from a resolved incident without replacing existing work or publishing it.', ...write,
      classes: ['standard'], clauses: ['HIST-002', 'AGENT-005'], classify: standard,
      async summary(args) { const current = await incident(services, args.id); return { target: { id: current.id, name: current.title }, items: ['Create a private cited report draft'] }; },
      async run(args, ctx) { const current = await incident(services, args.id); const result = await services.reports.draft(current.id, ctx.person.id); ctx.emit('report.drafted', `lamp://reports/${current.id}`); return { result: { ...result, revision: reportVersion(result.report) }, resources: [{ uri: `lamp://reports/${current.id}`, name: 'Post-incident report' }] }; },
    }),
    nativeTool(reportInput, {
      name: 'lamp.reports.save', title: 'Save report draft', description: 'Save private report wording through the native report service. Published reports are immutable.', ...write,
      classes: ['standard'], clauses: ['HIST-002', 'AGENT-005'], classify: standard,
      revisionType: 'string', async revision(args) { return reportVersion(await services.reports.get(String(args.id))); },
      async summary(args) { const current = await incident(services, args.id); const input = reportInput.parse(args); return { target: { id: current.id, name: current.title }, items: [JSON.stringify(input.report)] }; },
      async run(args, ctx) { const input = reportInput.parse(args); await incident(services, input.id); const report = await services.reports.save(input.id, input.report, ctx.person.id); ctx.emit('report.saved', `lamp://reports/${input.id}`); return { result: { report, revision: reportVersion(report) }, resources: [{ uri: `lamp://reports/${input.id}`, name: 'Post-incident report' }] }; },
    }),
    nativeTool(publicationInput, {
      name: 'lamp.reports.publish', title: 'Publish saved report', description: 'Publish the exact saved post-incident report and selected native notices with truthful agent, sponsor and approver attribution.', scope: 'lamp:publish', readOnly: false,
      classes: ['external', 'commitment'], clauses: ['HIST-002', 'AGENT-005', 'UPDATE-008'],
      classify: async args => [{ class: 'external', facts: { measure: 1 + (await recipients(args)).length, counterparty: 'public' } }, { class: 'commitment', facts: { measure: 0, currency: 'XXX', counterparty: 'public' } }],
      revisionType: 'string', async revision(args) { return reportVersion(await services.reports.get(String(args.id))); },
      async summary(args) { const current = await incident(services, args.id); const report = await services.reports.get(current.id); if (!report) throw new ToolRefusal('saved_report_required'); if (reportVersion(report) !== args.report_version) throw new ToolRefusal('revision_conflict'); return { target: { id: report.id, name: `${current.reference}: ${current.title}` }, recipients: ['Public status page', ...await recipients(args)], items: [`Saved report ${String(args.report_version)}`, report.summary, report.timeline, report.cause, report.remediation] }; },
      async run(args, ctx) { const input = publicationInput.parse(args); await incident(services, input.id); const current = await services.reports.get(input.id); if (reportVersion(current) !== input.report_version) throw new ToolRefusal('revision_conflict'); const report = await services.reports.publish(input.id, ctx.person.id, input.channels, agentAction(ctx)); if (!report) throw new ToolRefusal('native_conflict', 'A mutable complete report for a resolved incident is required.'); ctx.emit('report.published', `lamp://reports/${input.id}`); return { result: { report, revision: reportVersion(report) }, resources: incidentLink(input.id) }; },
    }),
  ];
}
