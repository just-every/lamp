import { z } from 'zod';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { ToolRefusal, type ToolDefinition, type ClassAndFacts, type ToolContext } from '../../../base/modules/agent-door/index.ts';
import { createMaintenanceRepository } from '../maintenance/repository';
import { createOperationsRepository } from './operations.repository';
import { agentAction } from '../incidents/agent-action';
import { scheduleAgentJob } from './jobs';
import type { MaintenanceView } from '../maintenance/service';
import { jsonInput, idInput, arrayOutput, recordOutput, required, nativeFailure, changed, live, publicDisclosure } from './operations-schema';

const wording = z.string().trim().min(1).max(250);
const createInput = z.object({ title: wording, affectedAudience: wording, customerImpact: wording, startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), componentIds: z.array(z.string().min(1)).min(1).max(100), autoStart: z.boolean().optional(), autoComplete: z.boolean().optional(), social: z.boolean().optional() }).strict();
const updateInput = z.object({ id: z.string().min(1), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), affectedAudience: wording.optional(), customerImpact: wording.optional(), autoStart: z.boolean().optional(), autoComplete: z.boolean().optional(), social: z.boolean().optional() }).strict();

/** Unlike MaintenanceService.list, this projection never emits overrun alerts. */
export async function readMaintenance(db: D1Database, id?: string): Promise<MaintenanceView[]> {
  const repository = createMaintenanceRepository(db);
  const records = id ? [await repository.find(id)].filter((record): record is NonNullable<typeof record> => record !== null) : await repository.listMaintenance();
  return Promise.all(records.map(async record => ({ ...record, ...await repository.automation.get(record.id), components: await repository.listComponents(record.id), notices: await repository.listNotices(record.id), importedUpdates: await repository.listImportedUpdates(record.id), overrunning: record.state === 'In progress' && Date.parse(record.endsAt) + 15 * 60_000 <= Date.now() })));
}

export function maintenanceWindowRevision(record: MaintenanceView): string {
  return JSON.stringify([record.id,record.title,record.affectedAudience,record.customerImpact,record.startsAt,record.endsAt,record.autoStart,record.autoComplete,record.components.map(component => [component.componentId,component.componentName,component.state])]);
}
async function queueMaintenance(record: MaintenanceView, ctx: ToolContext, reminder = true) {
  const revision = maintenanceWindowRevision(record);
  if (record.state === 'Scheduled') {
    if (record.autoStart) await scheduleAgentJob(ctx, { tool: 'lamp.maintenance.autostart', args: { id: record.id }, dueAt: record.startsAt, expectedRevision: revision });
    if (reminder && Date.parse(record.startsAt) > ctx.now()) await scheduleAgentJob(ctx, { tool: 'lamp.maintenance.remind', args: { id: record.id }, dueAt: new Date(Date.parse(record.startsAt) - 24 * 60 * 60_000).toISOString(), expectedRevision: revision });
  }
  if (record.autoComplete && (record.state === 'Scheduled' || record.state === 'In progress')) await scheduleAgentJob(ctx, { tool: 'lamp.maintenance.autocomplete', args: { id: record.id }, dueAt: record.endsAt, expectedRevision: revision });
}

export function maintenanceTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const get = async (id: string) => required((await readMaintenance(bindings.DB, id))[0]);
  const repository = createOperationsRepository(bindings.DB);
  const audience = async (args: Record<string, unknown>, verb: string) => {
    const record = typeof args.id === 'string' ? await get(args.id) : undefined;
    const componentIds = record ? record.components.flatMap(component => component.componentId ? [component.componentId] : []) : args.componentIds as string[];
    return repository.maintenanceAudience({ componentIds, ...(verb === 'update' || verb === 'cancel' ? { previousEventIds: record?.notices.map(notice => notice.id) ?? [] } : {}), social: args.social === true });
  };
  const classes = (service: string, recipients: number): ClassAndFacts[] => [publicDisclosure(1 + recipients), live(service), { class: 'commitment', facts: { measure: 0, currency: 'XXX', counterparty: 'public' } }];
  const summary = (verb: string) => async (args: Record<string, unknown>) => {
    const existing = typeof args.id === 'string' ? await get(args.id) : undefined;
    const components = existing?.components.map(component => component.componentName) ?? await Promise.all((args.componentIds as string[]).map(async id => required(await services.components.get(id)).name));
    return { target: { ...(existing ? { id: existing.id } : {}), name: existing?.title ?? String(args.title) }, recipients: ['Public status page', ...(await audience(args, verb)).map(item => `${item.channel}: ${item.recipient}`)], items: [String(args.affectedAudience ?? existing?.affectedAudience), String(args.customerImpact ?? existing?.customerImpact), `Window: ${String(args.startsAt ?? existing?.startsAt)} to ${String(args.endsAt ?? existing?.endsAt)}`, `Components: ${components.join(', ')}`, `Automatic start: ${String(args.autoStart ?? existing?.autoStart ?? (await services.maintenance.getAutomationDefault()).autoStart)}`, `Automatic completion: ${String(args.autoComplete ?? existing?.autoComplete ?? (await services.maintenance.getAutomationDefault()).autoComplete)}`] };
  };
  const base = { scope: 'lamp:publish', readOnly: false, classes: ['external', 'live', 'commitment'] as const, clauses: ['MAINT-001', 'MAINT-002', 'MAINT-003', 'MAINT-009', 'TEAM-003'], untrusted: true };
  const tools: ToolDefinition[] = [{
    name: 'lamp.maintenance.read', title: 'Read maintenance', description: 'Read actual maintenance windows, component claims and published notices without running schedules or notifications.', scope: 'lamp:read', readOnly: true,
    inputSchema: jsonInput(idInput.partial()), outputSchema: arrayOutput('maintenance'), classes: ['standard'], clauses: ['MAINT-001', 'MAINT-009'], untrusted: true,
    classify: async args => { const input = idInput.partial().parse(args); if (input.id) await get(input.id); return [{ class: 'standard', facts: { measure: 1 } }]; },
    run: async args => { const { id } = idInput.partial().parse(args); return { result: { maintenance: await readMaintenance(bindings.DB, id) } }; },
  }, {
    ...base, classes: [...base.classes], name: 'lamp.maintenance.create', title: 'Schedule maintenance', description: 'Create a native published maintenance window and its selected notices. This is a public schedule, not a private draft.',
    inputSchema: jsonInput(createInput), outputSchema: recordOutput('maintenance'), classify: async args => { createInput.parse(args); return classes('status-page maintenance schedule', (await audience(args, 'create')).length); }, summary: summary('create'),
    run: async (args, ctx) => { try { const maintenance = await services.maintenance.create(createInput.parse(args), ctx.person.id, agentAction(ctx)); await queueMaintenance(maintenance, ctx); await services.maintenance.refreshPublic(); changed(ctx, 'maintenance.created', `lamp://maintenance/${maintenance.id}`, { id: maintenance.id }); return { result: { maintenance }, resources: [{ uri: `lamp://maintenance/${maintenance.id}`, name: maintenance.title }] }; } catch (error) { return nativeFailure(error); } },
  }, {
    ...base, classes: [...base.classes], name: 'lamp.maintenance.update', title: 'Update maintenance window', description: 'Reschedule published maintenance or extend a running window using the current native revision; preserve competing incident claims.',
    inputSchema: jsonInput(updateInput), outputSchema: recordOutput('maintenance'), revisionType: 'string', revision: async args => (await get(updateInput.parse(args).id)).updatedAt,
    classify: async args => { const input = updateInput.parse(args); await get(input.id); return classes('status-page maintenance schedule', (await audience(args, 'update')).length); }, summary: summary('update'),
    run: async (args, ctx) => { try { const { id, ...input } = updateInput.parse(args); const current = await get(id); const maintenance = required(await services.maintenance.reschedule(id, input, ctx.person.id, current.updatedAt, agentAction(ctx))); await queueMaintenance(maintenance, ctx); await services.maintenance.refreshPublic(); changed(ctx, 'maintenance.updated', `lamp://maintenance/${id}`, { id }); return { result: { maintenance }, resources: [{ uri: `lamp://maintenance/${id}`, name: maintenance.title }] }; } catch (error) { return nativeFailure(error); } },
  }];
  for (const verb of ['start', 'complete', 'cancel'] as const) tools.push({
    ...base, classes: [...base.classes], name: `lamp.maintenance.${verb}`, title: `${verb[0].toUpperCase()}${verb.slice(1)} maintenance`, description: `${verb} the exact current native maintenance window and publish its real notice. Component claims from other incidents retain their precedence.`,
    inputSchema: jsonInput(idInput), outputSchema: recordOutput('maintenance'), revisionType: 'string', revision: async args => (await get(idInput.parse(args).id)).updatedAt,
    classify: async args => { await get(idInput.parse(args).id); return classes('status-page component state', (await audience(args, verb)).length); }, summary: summary(verb),
    run: async (args, ctx) => { try { const { id } = idInput.parse(args), current = await get(id); const maintenance = required(await services.maintenance[verb](id, ctx.person.id, current.updatedAt, agentAction(ctx))); if (verb === 'start') await queueMaintenance(maintenance, ctx, false); if (verb === 'complete') await services.maintenance.finishCompletion(id, ctx.person.id); else if (verb === 'cancel') await services.maintenance.refreshPublic(); changed(ctx, `maintenance.${verb === 'start' ? 'started' : verb === 'complete' ? 'completed' : 'cancelled'}`, `lamp://maintenance/${id}`, { id }); return { result: { maintenance }, resources: [{ uri: `lamp://maintenance/${id}`, name: maintenance.title }] }; } catch (error) { return nativeFailure(error); } },
  });
  for (const verb of ['autostart', 'autocomplete', 'remind'] as const) tools.push({
    ...base, classes: verb === 'remind' ? ['external','commitment'] : [...base.classes], name: `lamp.maintenance.${verb}`,
    title: verb === 'autostart' ? 'Run due automatic maintenance start' : verb === 'autocomplete' ? 'Run due automatic maintenance completion' : 'Send due maintenance reminder',
    description: 'Admit one distinct due native maintenance effect using current policy, original sponsor, consent, unchanged window and current automation. A person reclaiming the plan or Pause prevents this agent effect.',
    inputSchema: jsonInput(idInput), outputSchema: recordOutput('maintenance'), revisionType: 'string', revision: async args => maintenanceWindowRevision(await get(idInput.parse(args).id)),
    classify: async args => {
      const record = await get(idInput.parse(args).id), now = Date.now();
      if (!await createMaintenanceRepository(bindings.DB).agentOwned(record.id)) throw new ToolRefusal('native_authority_changed');
      if (verb === 'autostart' && (record.state !== 'Scheduled' || !record.autoStart || Date.parse(record.startsAt) > now)) throw new ToolRefusal('native_schedule_not_due');
      if (verb === 'autocomplete' && (record.state !== 'In progress' || !record.autoComplete || Date.parse(record.endsAt) > now)) throw new ToolRefusal('native_schedule_not_due');
      if (verb === 'remind' && (record.state !== 'Scheduled' || Date.parse(record.startsAt) <= now || Date.parse(record.startsAt) > now + 24 * 60 * 60_000)) throw new ToolRefusal('native_schedule_not_due');
      return classes('status-page component state', (await audience(args, verb)).length).filter(item => verb !== 'remind' || item.class !== 'live');
    }, summary: summary(verb),
    run: async (args, ctx) => { try {
      const { id } = idInput.parse(args), current = await get(id), maintenance = required(await services.maintenance[verb](id, ctx.person.id, current.updatedAt, agentAction(ctx)));
      if (verb === 'autocomplete') await services.maintenance.finishCompletion(id, ctx.person.id);
      changed(ctx, `maintenance.${verb === 'autostart' ? 'started' : verb === 'autocomplete' ? 'completed' : 'reminder'}`, `lamp://maintenance/${id}`, { id });
      return { result: { maintenance }, resources: [{ uri: `lamp://maintenance/${id}`, name: maintenance.title }] };
    } catch (error) { return nativeFailure(error); } },
  });
  return tools;
}
