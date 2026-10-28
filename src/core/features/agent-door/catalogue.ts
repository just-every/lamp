import { z } from 'zod';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import type { ClassAndFacts, ResourceDefinition, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import { componentSchema, componentUpdateSchema, componentHistoryCorrectionSchema, componentStandingClaimSchema, componentGroupSchema, componentGroupUpdateSchema, pageSettingsSchema } from '../../shared/schemas';
import { metricSchema, metricPatchSchema, pointsSchema } from '../metrics/schema';
import { createCatalogueDoorRepository } from './catalogue.repository';
import { catalogueTool, emitNative, idField, nativeEffect, nativeResource, nativeSchema, nativeValue, objectResult, parseNative } from './catalogue-shared';

const target = z.object({ id: idField }).strict();
const targetOpen = target.passthrough();
const componentUpdate = componentUpdateSchema.extend({ id: idField }).strict();
const claimInput = componentStandingClaimSchema.extend({ id: idField }).strict();
const correctionInput = z.object({ ...componentHistoryCorrectionSchema.shape, id: idField }).strict();
// Secrets stay on the existing native person/connector screen. Ordinary tools
// never carry a provider key into their retained argument/audit records.
const metricCreate = metricSchema.omit({ credentials: true });
const metricUpdate = metricPatchSchema.omit({ credentials: true }).extend({ id: idField }).strict();
const groupUpdate = componentGroupUpdateSchema.extend({ id: idField }).strict();
const moveInput = z.object({ id: idField, direction: z.enum(['up', 'down']), expectedIds: z.array(idField).min(2).max(1000), groupId: idField.nullable().default(null) }).strict();

function publicChange(visible: boolean): ClassAndFacts[] {
  return visible ? [{ class: 'external', facts: { measure: 1, counterparty: 'public' } },
    { class: 'live', facts: { measure: 1, service: 'public-status-page' } }]
    : [{ class: 'standard', facts: { measure: 1 } }];
}

export function createCatalogueTools(services: AppServices, bindings: AppBindings): ToolDefinition[] {
  const repository = createCatalogueDoorRepository(bindings.DB);
  const component = async (id: string) => nativeValue(await services.components.get(id));
  const metric = async (id: string) => nativeValue((await services.metrics.list()).find(item => item.id === id));
  const group = async (id: string) => nativeValue((await services.components.listGroups()).find(item => item.id === id));
  const groupVisible = async (id:string) => (await services.components.list()).some(item => item.groupId===id && !item.internal && (!item.onlyShowIfDegraded || item.publicState!=='Operational'));
  const componentUri = (id: string) => `lamp://components/${id}`;
  const metricUri = (id: string) => `lamp://metrics/${id}`;
  const componentClasses = ['standard', 'external', 'live'] as const;
  const tools: ToolDefinition[] = [];

  tools.push(catalogueTool({
    name: 'lamp.groups.read', title: 'Read component groups', description: 'Read native catalogue groups and their current order.', scope: '', readOnly: true,
    inputSchema: nativeSchema(z.object({ id: idField.optional() }).strict()), outputSchema: objectResult, classes: ['standard'], clauses: ['COMP-002'],
    classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    async run(args) { const groups = typeof args.id === 'string' ? [await group(args.id)] : await services.components.listGroups(); return { result: { groups, order: groups.map(item => item.id) } }; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.groups.create', title: 'Create component group', description: 'Create a native component catalogue group.', scope: '', readOnly: false,
    inputSchema: nativeSchema(componentGroupSchema), outputSchema: objectResult, classes: ['standard'], clauses: ['COMP-002'],
    classify: () => publicChange(false), summary: args => ({ target: { name: parseNative(componentGroupSchema, args).name } }),
    async run(args, ctx) { const created = await nativeEffect(() => services.components.createGroup(parseNative(componentGroupSchema, args))); emitNative(ctx, 'group.created', `lamp://groups/${created.id}`); return { result: { group: created }, resources: nativeResource(`lamp://groups/${created.id}`, created.name) }; },
  }));
  for (const action of ['update', 'remove'] as const) tools.push(catalogueTool({
    name: `lamp.groups.${action}`, title: `${action === 'update' ? 'Update' : 'Remove'} component group`, description: 'Use native group editing and component-retention semantics.', scope: '', readOnly: false,
    inputSchema: nativeSchema(action === 'update' ? groupUpdate : target), outputSchema: objectResult,
    classes: action === 'update' ? ['standard', 'external', 'live'] : ['external', 'live', 'destructive'], clauses: ['COMP-002', 'COMP-007'], revisionType: 'string',
    revision: args => repository.groupRevision(parseNative(targetOpen, args).id),
    async classify(args) { const visible = await groupVisible(parseNative(targetOpen,args).id); return action==='remove' ? [{class:'destructive',facts:{measure:1}},...(visible?publicChange(true):[])] : publicChange(visible); },
    async summary(args) { const input = parseNative(targetOpen, args); return { target: { id: input.id, name: (await group(input.id)).name }, items: [JSON.stringify(args)] }; },
    async run(args, ctx) { const { id } = parseNative(targetOpen, args); const changed = await nativeEffect(() => action === 'remove' ? services.components.removeGroup(id, ctx.person.id) : services.components.updateGroup(id, (({ id: _id, ...rest }) => rest)(parseNative(groupUpdate, args)))); if (!changed) throw new ToolRefusal('not_found'); emitNative(ctx, `group.${action === 'remove' ? 'removed' : 'updated'}`, `lamp://groups/${id}`); return { result: { changed: true, id } }; },
  }));
  for (const kind of ['components', 'groups'] as const) tools.push(catalogueTool({
    name: `lamp.${kind}.move`, title: `Reorder ${kind}`, description: 'Move one native entry against its exact current membership and order.',
    scope: '', readOnly: false, inputSchema: nativeSchema(moveInput), outputSchema: objectResult, classes: ['standard', 'external', 'live'], clauses: ['COMP-002'],
    async classify(args) {
      const input=parseNative(moveInput,args);
      const publicRecords=await services.components.list();
      // Native reordering writes every member's numeric public position, not
      // only the entry moved; classify the full guarded collection.
      return publicChange(publicRecords.some(item=>!item.internal&&(!item.onlyShowIfDegraded||item.publicState!=='Operational')
        && (kind==='groups'?item.groupId!==null&&input.expectedIds.includes(item.groupId):input.expectedIds.includes(item.id))));
    },
    async summary(args) { const input = parseNative(moveInput, args); return { target: { id: input.id, name: kind === 'components' ? (await component(input.id)).name : (await group(input.id)).name }, items: [`Move ${input.direction}`, JSON.stringify(input.expectedIds)] }; },
    async run(args, ctx) { const input = parseNative(moveInput, args); await nativeEffect(() => services.components.move(kind, input.id, input.direction, input.expectedIds, input.groupId)); const resource = kind === 'components' ? componentUri(input.id) : `lamp://groups/${input.id}`; emitNative(ctx, 'catalogue.order.changed', resource); return { result: { moved: true }, resources: nativeResource(resource, kind) }; },
  }));

  tools.push(catalogueTool({
    name: 'lamp.components.create', title: 'Create component', description: 'Create a real public or internal component using the native catalogue validator.',
    scope: '', readOnly: false, inputSchema: nativeSchema(componentSchema), outputSchema: objectResult,
    classes: [...componentClasses], clauses: ['COMP-001', 'COMP-002', 'COMP-004', 'COMP-005'],
    classify: args => publicChange(!parseNative(componentSchema, args).internal),
    async summary(args) { const input = parseNative(componentSchema, args); return { target: { name: input.name }, recipients: input.internal ? [] : ['public-status-page'], items: [input.description, input.note, `Internal: ${input.internal}`, `Group: ${input.groupId ?? 'none'}`] }; },
    async run(args, ctx) { const created = await nativeEffect(() => services.components.create(parseNative(componentSchema, args), ctx.person.id)); emitNative(ctx, 'component.created', componentUri(created.id)); return { result: { component: created }, resources: nativeResource(componentUri(created.id), created.name) }; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.components.update', title: 'Update component', description: 'Edit native wording, visibility and catalogue metadata without fabricating recovery evidence.',
    scope: '', readOnly: false, inputSchema: nativeSchema(componentUpdate), outputSchema: objectResult,
    classes: [...componentClasses], clauses: ['COMP-002', 'COMP-004', 'COMP-005'], revisionType: 'string',
    revision: args => repository.componentRevision(parseNative(targetOpen, args).id),
    async classify(args) { const input = parseNative(componentUpdate, args); const current = await component(input.id); return publicChange(!current.internal || !input.internal); },
    async summary(args) { const { id, ...input } = parseNative(componentUpdate, args); const current = await component(id); return { target: { id, name: current.name }, recipients: !current.internal || !input.internal ? ['public-status-page'] : [], items: [JSON.stringify(input)] }; },
    async run(args, ctx) { const { id, ...input } = parseNative(componentUpdate, args); const changed = nativeValue(await nativeEffect(() => services.components.update(id, input))); emitNative(ctx, 'component.updated', componentUri(id)); return { result: { component: changed }, resources: nativeResource(componentUri(id), changed.name) }; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.claims.update', title: 'Change standing component claim', description: 'Set or clear a native standing claim; competing incident and maintenance claims retain precedence.',
    scope: '', readOnly: false, inputSchema: nativeSchema(claimInput), outputSchema: objectResult,
    classes: [...componentClasses], clauses: ['COMP-001', 'COMP-003', 'COMP-006'], revisionType: 'string',
    revision: args => repository.componentRevision(parseNative(targetOpen, args).id),
    async classify(args) { const input=parseNative(claimInput,args); const current = await component(input.id); const outcome=await repository.standingClaimOutcome(input.id,input.state); return publicChange(!current.internal&&current.publicState!==outcome); },
    async summary(args) { const { id, state } = parseNative(claimInput, args); const current = await component(id); return { target: { id, name: current.name }, recipients: current.internal ? [] : ['public-status-page'], items: [`Standing claim: ${current.standingClaimState ?? 'none'} → ${state ?? 'none'}`, `Current aggregate: ${current.publicState}`] }; },
    async run(args, ctx) { const { id, state } = parseNative(claimInput, args); const changed = nativeValue(await nativeEffect(() => services.components.setStandingClaim(id, state, ctx.person.id))); emitNative(ctx, 'component.claim.changed', componentUri(id)); return { result: { component: changed }, resources: nativeResource(componentUri(id), changed.name) }; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.components.remove', title: 'Remove component', description: 'Delete a component using native history and retained-name semantics.',
    scope: '', readOnly: false, inputSchema: nativeSchema(target), outputSchema: objectResult,
    classes: ['destructive', 'external', 'live'], clauses: ['COMP-007'], revisionType: 'string',
    revision: args => repository.componentRevision(parseNative(target, args).id),
    async classify(args) { const current = await component(parseNative(target, args).id); return [{ class: 'destructive', facts: { measure: 1 } }, ...(!current.internal ? publicChange(true) : [])]; },
    async summary(args) { const current = await component(parseNative(target, args).id); return { target: { id: current.id, name: current.name }, items: ['Remove this component and its public state/uptime projection; published references retain the name.'] }; },
    async run(args, ctx) { const { id } = parseNative(target, args); if (!await nativeEffect(() => services.components.remove(id, ctx.person.id))) throw new ToolRefusal('not_found'); emitNative(ctx, 'component.removed', componentUri(id)); return { result: { removed: true, id } }; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.components.correct', title: 'Correct component history', description: 'Append a reasoned correction for a closed native interval; retain original history.',
    scope: '', readOnly: false, inputSchema: nativeSchema(correctionInput), outputSchema: objectResult,
    classes: [...componentClasses], clauses: ['COMP-003', 'UPTIME-004'], revisionType: 'string',
    revision: args => repository.componentRevision(parseNative(targetOpen, args).id),
    async classify(args) { return publicChange(!(await component(parseNative(targetOpen, args).id)).internal); },
    async summary(args) { const { id, ...fields } = parseNative(correctionInput, args); const current = await component(id); const input = parseNative(componentHistoryCorrectionSchema, fields); return { target: { id, name: current.name }, items: [input.startsAt, input.endsAt, input.state, input.reason] }; },
    async run(args, ctx) { const { id, ...fields } = parseNative(correctionInput, args); const input = parseNative(componentHistoryCorrectionSchema, fields); await nativeEffect(() => services.components.correctHistory(id, input, ctx.person.id)); emitNative(ctx, 'component.history.corrected', componentUri(id)); return { result: { history: await services.components.history(id) }, resources: nativeResource(componentUri(id), (await component(id)).name) }; },
  }));

  tools.push(catalogueTool({
    name: 'lamp.metrics.read', title: 'Read public metric configuration', description: 'Read redacted native metric configuration without pulling a provider or claiming recovery.',
    scope: '', readOnly: true, inputSchema: nativeSchema(z.object({ id: idField.optional() }).strict()), outputSchema: objectResult,
    classes: ['standard'], clauses: ['UPTIME-008', 'API-001'], classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    async run(args, ctx) { if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('forbidden'); return { result: { metrics: typeof args.id === 'string' ? [await metric(args.id)] : await services.metrics.list() } }; },
  }));
  for (const action of ['create', 'update', 'remove'] as const) tools.push(catalogueTool({
    name: `lamp.metrics.${action}`, title: `${action[0].toUpperCase()}${action.slice(1)} public metric`, description: 'Use native public metric configuration. Provider secrets stay on their native person screen; this never manufactures observed recovery.',
    scope: '', readOnly: false, inputSchema: nativeSchema(action === 'create' ? metricCreate : action === 'update' ? metricUpdate : target), outputSchema: objectResult,
    classes: action === 'remove' ? ['external', 'live', 'destructive'] : ['external', 'live'], clauses: ['UPTIME-008', 'API-001'],
    ...(action === 'create' ? {} : { revisionType: 'integer' as const, revision: (args: Record<string, unknown>) => repository.metricRevision(parseNative(targetOpen, args).id) }),
    async classify() { return [...publicChange(true), ...(action === 'remove' ? [{ class: 'destructive' as const, facts: { measure: 1 } }] : [])]; },
    async summary(args) { return { target: action === 'create' ? { name: parseNative(metricCreate, args).name } : { id: parseNative(targetOpen, args).id, name: (await metric(parseNative(targetOpen, args).id)).name }, recipients: ['public-status-page'], items: [JSON.stringify(args)] }; },
    async run(args, ctx) {
      if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('forbidden');
      if (action === 'create') { const created = await nativeEffect(() => services.metrics.create(parseNative(metricCreate, args), ctx.person.id)); emitNative(ctx, 'metric.created', metricUri(created.id)); return { result: { metric: created }, resources: nativeResource(metricUri(created.id), created.name) }; }
      const { id } = parseNative(targetOpen, args);
      if (action === 'remove') { if (!await nativeEffect(() => services.metrics.remove(id, ctx.person.id))) throw new ToolRefusal('not_found'); emitNative(ctx, 'metric.removed', metricUri(id)); return { result: { removed: true, id } }; }
      const { id: _id, ...fields } = parseNative(metricUpdate, args);
      const changed = nativeValue(await nativeEffect(() => services.metrics.update(id, fields, ctx.person.id)));
      emitNative(ctx, 'metric.updated', metricUri(id)); return { result: { metric: changed }, resources: nativeResource(metricUri(id), changed.name) };
    },
  }));
  tools.push(catalogueTool({
    name: 'lamp.metrics.points', title: 'Push metric aggregates', description: 'Store native UTC minute aggregates with retained management-key scope and final credential fencing. Pushed values are not independent recovery observations.',
    scope: '', readOnly: false, inputSchema: nativeSchema(pointsSchema.extend({ id: idField }).strict()), outputSchema: objectResult,
    classes: ['external', 'live'], clauses: ['UPTIME-008', 'API-001'], revisionType: 'integer',
    revision: args => repository.metricRevision(parseNative(targetOpen, args).id), classify: () => publicChange(true),
    async summary(args) { const input = parseNative(pointsSchema.extend({ id: idField }).strict(), args); const current = await metric(input.id); return { target: { id: input.id, name: current.name }, recipients: ['public-status-page'], items: [`${input.points.length} minute aggregates`, JSON.stringify(input.points)] }; },
    async run(args, ctx) {
      if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('forbidden');
      const input = parseNative(pointsSchema.extend({ id: idField }).strict(), args);
      const authority = ctx.clientId ? await repository.managementAuthority(ctx.clientId, ctx.person.id) : undefined;
      if (ctx.clientId && !authority) throw new ToolRefusal('credential_revoked');
      if (!await nativeEffect(() => services.metrics.push(input.id, input.points, authority ?? undefined))) throw new ToolRefusal('not_found');
      emitNative(ctx, 'metric.points.updated', metricUri(input.id));
      return { result: { id: input.id, accepted: input.points.length }, resources: nativeResource(metricUri(input.id), (await metric(input.id)).name) };
    },
  }));
  tools.push(catalogueTool({
    name: 'lamp.metrics.pull', title: 'Refresh due provider metric', description: 'Perform one due native read-only provider query and retain its actual aggregate or unavailable outcome. Each scheduled cycle rechecks current authority and company policy.',
    scope: '', readOnly: false, inputSchema: nativeSchema(target), outputSchema: objectResult,
    classes: ['external', 'live'], clauses: ['UPTIME-008'], revisionType: 'integer',
    revision: args => repository.metricRevision(parseNative(target, args).id),
    async classify(args) { const current = await metric(parseNative(target, args).id); if (!current.connected || ['push','uptime'].includes(current.provider)) throw new ToolRefusal('provider_unavailable'); return [{class:'external',facts:{measure:1,counterparty:'known'}},{class:'live',facts:{measure:1,service:'public-status-page'}}]; },
    async summary(args) { const current = await metric(parseNative(target, args).id); return {target:{id:current.id,name:current.name},recipients:[current.provider],items:[`Query: ${current.query}`,`Component: ${current.componentId}`,`Provider: ${current.provider}`]}; },
    async run(args,ctx) { const result = nativeValue(await nativeEffect(() => services.metrics.pull(parseNative(target,args).id,ctx.person.id))); emitNative(ctx,'metric.provider.refreshed',metricUri(result.metric.id)); return {result,resources:nativeResource(metricUri(result.metric.id),result.metric.name)}; },
  }));
  tools.push(catalogueTool({
    name: 'lamp.page.read', title: 'Read page settings', description: 'Read native page and widget settings without changing public state.', scope: '', readOnly: true,
    inputSchema: nativeSchema(z.object({}).strict()), outputSchema: objectResult, classes: ['standard'], clauses: ['PAGE-011', 'PAGE-012'],
    classify: () => [{ class: 'standard', facts: { measure: 1 } }], run: async () => ({ result: { settings: nativeValue(await services.pageSettings.get()) } }),
  }));
  tools.push(catalogueTool({
    name: 'lamp.page.update', title: 'Update page settings', description: 'Save native page, sender, wording and widget settings. A changed widget-origin allow-list is a security control.',
    scope: '', readOnly: false, inputSchema: nativeSchema(pageSettingsSchema), outputSchema: objectResult,
    classes: ['external', 'live', 'security'], clauses: ['PAGE-011', 'PAGE-012', 'PAGE-013'], revisionType: 'string',
    revision: async () => (await services.pageSettings.get())?.updatedAt ?? null,
    async authority(args) { const current = nativeValue(await services.pageSettings.get()); const input = parseNative(pageSettingsSchema, args); if (!input.widgetAllowedOrigins) return null; const before = new Set(current.widgetAllowedOrigins); return { subject: 'lamp-widget-origins', widens: input.widgetAllowedOrigins.some(origin => !before.has(origin)) }; },
    async classify(args) { const input = parseNative(pageSettingsSchema, args); const current = nativeValue(await services.pageSettings.get()); const classes = publicChange(true); if (input.widgetAllowedOrigins && JSON.stringify([...input.widgetAllowedOrigins].sort()) !== JSON.stringify([...current.widgetAllowedOrigins].sort())) classes.push({ class: 'security', facts: { measure: 1, setting: 'widget-allowed-origins' } }); return classes; },
    async summary(args) { const input = parseNative(pageSettingsSchema, args); return { target: { id: 'default', name: input.pageName }, recipients: ['public-status-page'], items: [JSON.stringify(input)] }; },
    async run(args, ctx) { const settings = nativeValue(await nativeEffect(() => services.pageSettings.update(parseNative(pageSettingsSchema, args)))); emitNative(ctx, 'page.updated', 'lamp://page/default'); return { result: { settings }, resources: nativeResource('lamp://page/default', settings.pageName) }; },
  }));
  return tools;
}

export function createCatalogueResources(services: AppServices, _bindings: AppBindings): ResourceDefinition[] {
  return [
    { uriTemplate: 'lamp://groups/{id}', name: 'Component group', mimeType: 'application/json', scope: 'lamp.groups.read', classes: ['standard'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }], async read(uri) { const id = /^lamp:\/\/groups\/([^/?#]+)$/.exec(uri)?.[1]; const group = id ? (await services.components.listGroups()).find(item => item.id === id) : null; return group ? { json: { group }, untrusted: true } : null; } },
    { uriTemplate: 'lamp://metrics/{id}', name: 'Public metric configuration', mimeType: 'application/json', scope: 'lamp.metrics.read', classes: ['standard'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }], async read(uri, ctx) { if (!await services.metrics.authorize(ctx.person.id)) return null; const id = /^lamp:\/\/metrics\/([^/?#]+)$/.exec(uri)?.[1]; const metric = id ? (await services.metrics.list()).find(item => item.id === id) : null; return metric ? { json: { metric }, untrusted: true } : null; } },
    { uriTemplate: 'lamp://page/{id}', name: 'Page settings', mimeType: 'application/json', scope: 'lamp.page.read', classes: ['standard'],
      classify: () => [{ class: 'standard', facts: { measure: 1 } }], async read(uri) { if (uri !== 'lamp://page/default') return null; const settings = await services.pageSettings.get(); return settings ? { json: { settings }, untrusted: true } : null; } },
  ];
}
