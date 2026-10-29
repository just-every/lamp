import { z } from 'zod';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import type { ClassAndFacts, ResourceDefinition, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import { createMaintenanceAudienceRepository } from './maintenance-audience.repository';
import { catalogueTool, emitNative, idField, nativeEffect, nativeResource, nativeSchema, nativeValue, objectResult, parseNative } from './catalogue-shared';

const text = z.string().trim().min(1).max(250);
const maintenanceInput = z.object({
  title: text, affectedAudience: text, customerImpact: text,
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), componentIds: z.array(idField).min(1).max(100),
  autoStart: z.boolean().optional(), autoComplete: z.boolean().optional(), social: z.boolean().optional(),
}).strict();
const updateInput = maintenanceInput.pick({ startsAt: true, endsAt: true, autoStart: true, autoComplete: true, social: true })
  .extend({ id: idField, affectedAudience: text.optional(), customerImpact: text.optional() }).strict();
const targetInput = z.object({ id: idField }).strict();
const readInput = z.object({ id: idField.optional() }).strict();

/** Native visibility decides whether a window is private or public. A public
 * component publishes the window immediately; internal-only plans stay private
 * unless an explicit supported social post actually discloses them. */
export function createMaintenanceTools(services: AppServices, bindings: AppBindings): ToolDefinition[] {
  const audience = createMaintenanceAudienceRepository(bindings.DB);
  const record = async (id: string) => nativeValue(await services.maintenance.get(id));
  const uri = (id: string) => `lamp://maintenance/${id}`;
  const recipients = async (ids: string[], previous?: string[]) => audience.recipients(ids, previous);
  const effects = async (ids: string[], previous?: string[], social=false, id?:string) => {
    const publicPage = id ? await audience.publicWindow(id) : await audience.publicComponents(ids);
    const selected = await recipients(ids,previous);
    const socialRecipients=social?await audience.socialRecipients():[];
    return {publicPage,publicExposure:publicPage||socialRecipients.length>0,recipients:[...(publicPage?['public-status-page']:[]),...selected.map(item=>item.label),...socialRecipients]};
  };
  const risks = (effect:{publicPage:boolean;publicExposure:boolean;recipients:string[]}, promise:boolean, live:boolean):ClassAndFacts[] => {
    const classes:ClassAndFacts[]=[];
    if(effect.recipients.length) classes.push({class:'external',facts:{measure:effect.recipients.length,counterparty:effect.publicExposure?'public':'known'}});
    // ISO 4217 XXX explicitly means no currency is involved. These are public
    // time promises, not a fabricated monetary amount or money-moving action.
    if(promise && effect.recipients.length) classes.push({class:'commitment',facts:{measure:1,currency:'XXX',counterparty:effect.publicExposure?'public':'known'}});
    if(live && effect.publicPage) classes.push({class:'live',facts:{measure:1,service:'public-status-page'}});
    return classes.length?classes:[{class:'standard',facts:{measure:1}}];
  };
  const read: ToolDefinition = catalogueTool({
    name: 'lamp.maintenance.read', title: 'Read maintenance', description: 'Read native windows, notices and component claims without running reminders.',
    scope: '', readOnly: true, inputSchema: nativeSchema(readInput), outputSchema: objectResult,
    classes: ['standard'], clauses: ['MAINT-001', 'MAINT-003', 'MAINT-004'],
    classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    async run(args) {
      const input = parseNative(readInput, args);
      const maintenance = input.id ? [await record(input.id)] : await services.maintenance.list({ notifyOverruns: false });
      return { result: { maintenance }, resources: maintenance.map(item => ({ uri: uri(item.id), name: item.reference })) };
    },
  });
  const create: ToolDefinition = catalogueTool({
    name: 'lamp.maintenance.create', title: 'Schedule maintenance', description: 'Save an exact native maintenance window and its actual visibility and selected notices, retaining native automation choices.',
    scope: '', readOnly: false, inputSchema: nativeSchema(maintenanceInput), outputSchema: objectResult,
    classes: ['standard', 'external', 'commitment', 'live'], clauses: ['MAINT-001', 'MAINT-002', 'MAINT-003', 'MAINT-005', 'MAINT-009'],
    async classify(args) {
      const input = parseNative(maintenanceInput, args);
      return risks(await effects(input.componentIds,undefined,input.social),true,true);
    },
    async summary(args) {
      const input = parseNative(maintenanceInput, args);
      const components = await Promise.all(input.componentIds.map(id => services.components.get(id)));
      const effect = await effects(input.componentIds,undefined,input.social);
      const defaults = await services.maintenance.getAutomationDefault();
      return { target: { name: input.title }, recipients: effect.recipients,
        items: [input.affectedAudience, input.customerImpact, `Window: ${input.startsAt} — ${input.endsAt}`, ...components.map(item => nativeValue(item).name),
          `Auto-start: ${input.autoStart ?? defaults.autoStart}`, `Auto-complete: ${input.autoComplete ?? defaults.autoComplete}`] };
    },
    async run(args, ctx) {
      const maintenance = await nativeEffect(() => services.maintenance.create(parseNative(maintenanceInput, args), ctx.person.id));
      await services.maintenance.refreshPublic();
      emitNative(ctx, 'maintenance.created', uri(maintenance.id));
      return { result: { maintenance }, resources: nativeResource(uri(maintenance.id), maintenance.reference) };
    },
  });
  const mutations: ToolDefinition[] = (['update', 'start', 'complete', 'cancel'] as const).map(action => {
    const input = action === 'update' ? updateInput : targetInput;
    return catalogueTool({
      name: `lamp.maintenance.${action}`, title: `${action[0].toUpperCase()}${action.slice(1)} maintenance`,
      description: `Use the native ${action === 'update' ? 'window and wording correction' : action} transition, preserving competing incident claims and notification consent.`,
      scope: '', readOnly: false, inputSchema: nativeSchema(input), outputSchema: objectResult,
      classes: ['standard', 'external', 'live', ...(action === 'start' || action === 'update' ? ['commitment' as const] : [])],
      clauses: ['MAINT-002', 'MAINT-003', 'MAINT-005', 'MAINT-006', 'MAINT-009'],
      revisionType: 'string',
      async revision(args) { return (await record(parseNative(targetInput.passthrough(), args).id)).updatedAt; },
      async classify(args) {
        const current = await record(parseNative(targetInput.passthrough(), args).id);
        const previous = action === 'update' || action === 'cancel' ? current.notices.map(item => item.id) : undefined;
        const social = action==='update' && parseNative(updateInput,args).social===true;
        return risks(await effects(current.components.flatMap(item => item.componentId ? [item.componentId] : []),previous,social,current.id),action==='start'||action==='update',true);
      },
      async summary(args) {
        const current = await record(parseNative(targetInput.passthrough(), args).id);
        const proposed = action === 'update' ? { ...current, ...parseNative(updateInput, args) } : current;
        const previous = action === 'update' || action === 'cancel' ? current.notices.map(item => item.id) : undefined;
        const effect = await effects(current.components.flatMap(item => item.componentId ? [item.componentId] : []),previous,action==='update'&&parseNative(updateInput,args).social===true,current.id);
        return { target: { id: current.id, name: `${current.reference} ${current.title}` }, recipients: effect.recipients,
          items: [action, proposed.affectedAudience ?? '', proposed.customerImpact ?? '', `Window: ${proposed.startsAt} — ${proposed.endsAt}`,
            `Native revision: ${current.updatedAt}`, ...current.components.map(item => item.componentName ?? 'Removed component')] };
      },
      async run(args, ctx) {
        const { id } = parseNative(targetInput.passthrough(), args);
        const maintenance = nativeValue(await nativeEffect(async () => {
          if (action === 'update') {
            const { id: _id, ...change } = parseNative(updateInput, args);
            return services.maintenance.reschedule(id, change, ctx.person.id);
          }
          return services.maintenance[action](id, ctx.person.id);
        }));
        if (action === 'complete') await services.maintenance.finishCompletion(id, ctx.person.id);
        if (action === 'update' || action === 'cancel') await services.maintenance.refreshPublic();
        const event = { start: 'started', complete: 'completed', cancel: 'cancelled', update: 'updated' }[action];
        emitNative(ctx, `maintenance.${event}`, uri(id));
        return { result: { maintenance }, resources: nativeResource(uri(id), maintenance.reference) };
      },
    });
  });
  const remind: ToolDefinition = catalogueTool({
    name: 'lamp.maintenance.remind', title: 'Send due maintenance reminder', description: 'Admit the native once-only reminder for an existing public window only when it is due and native reminder policy allows it.',
    scope: '', readOnly: false, inputSchema: nativeSchema(targetInput), outputSchema: objectResult,
    classes: ['standard', 'external'], clauses: ['MAINT-005'], revisionType: 'string',
    revision: async args => (await record(parseNative(targetInput, args).id)).updatedAt,
    async classify(args) { const current = await record(parseNative(targetInput, args).id); return risks(await effects(current.components.flatMap(item => item.componentId ? [item.componentId] : []),undefined,false,current.id),false,false); },
    async summary(args) { const current = await record(parseNative(targetInput, args).id); const effect = await effects(current.components.flatMap(item => item.componentId ? [item.componentId] : []),undefined,false,current.id); return { target: { id: current.id, name: `${current.reference} ${current.title}` }, recipients: effect.recipients, items: [current.affectedAudience ?? '', current.customerImpact ?? '', `Window: ${current.startsAt} — ${current.endsAt}`] }; },
    async run(args, ctx) { const maintenance = nativeValue(await nativeEffect(() => services.maintenance.remind(parseNative(targetInput, args).id, ctx.person.id))); emitNative(ctx, 'maintenance.reminded', uri(maintenance.id)); return { result: { maintenance }, resources: nativeResource(uri(maintenance.id), maintenance.reference) }; },
  });
  return [read, create, ...mutations, remind];
}

export function createMaintenanceResources(services: AppServices, _bindings: AppBindings): ResourceDefinition[] {
  return [{ uriTemplate: 'lamp://maintenance/{id}', name: 'Maintenance window', description: 'Native window, public notices and component claims. Imported wording is untrusted.',
    mimeType: 'application/json', scope: 'lamp.maintenance.read', classes: ['standard'],
    classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    async read(uri) {
      const id = /^lamp:\/\/maintenance\/([^/?#]+)$/.exec(uri)?.[1];
      if (!id) return null;
      const maintenance = await services.maintenance.get(id);
      return maintenance ? { json: { maintenance }, untrusted: true } : null;
    },
  }];
}
