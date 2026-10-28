import { z } from 'zod';
import { ToolRefusal, type ToolDefinition } from '../../../base/modules/agent-door/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { pointsSchema } from '../metrics/schema';
import { createLampDoorRepository } from './repository';
import { createMetricsRepository } from '../metrics/repository';
import { jsonInput } from './operations-schema';

/** The retained management client keeps its original read/point-write fences. */
export function managementTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const people = createLampDoorRepository(bindings.DB), metrics = createMetricsRepository(bindings.DB);
  const push = pointsSchema.extend({ id: z.string().min(1).max(128) }).strict();
  return [{
    name: 'lamp.metrics.read', title: 'Read metric definitions', description: 'Read native sanitized metric definitions without fetching a provider or measuring recovery.',
    scope: 'lamp:read', readOnly: true, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'object', properties: { metrics: { type: 'array' } }, required: ['metrics'], additionalProperties: false },
    classes: ['standard'], clauses: ['UPTIME-008', 'API-001'], classify: () => [{ class: 'standard', facts: { measure: 1 } }],
    run: async () => ({ result: { metrics: await services.metrics.list() } }),
  }, {
    name: 'lamp.metrics.push', title: 'Record supplied metric points', description: 'Record bounded native UTC-minute aggregates. Supplied observations never establish incident recovery. Management clients retain their original metrics:write and live credential fences.',
    scope: 'lamp:metrics', readOnly: false, inputSchema: jsonInput(push),
    outputSchema: { type: 'object', properties: { accepted: { type: 'integer' } }, required: ['accepted'], additionalProperties: false },
    classes: ['external', 'live'], clauses: ['UPTIME-008', 'API-001'],
    classify: async args => { if (!await metrics.get(String(args.id))) throw new ToolRefusal('not_found'); return [{ class: 'external', facts: { measure: 1, counterparty: 'public' } }, { class: 'live', facts: { measure: 1, service: 'public status-page metric' } }]; },
    summary: async args => { const input = push.parse(args), metric = await metrics.get(input.id); if (!metric) throw new ToolRefusal('not_found'); return { target: { id: metric.id, name: metric.name }, recipients: ['Public status page'], items: [`${input.points.length} supplied UTC-minute aggregates`, JSON.stringify(input.points), 'These supplied points do not prove independently observed recovery.'] }; },
    async run(args, ctx) {
      const input = push.parse(args);
      const local = ctx.clientId?.startsWith('management-token:');
      const client = local ? await people.liveClient(ctx.clientId!, ctx.person.id) : null;
      if (local && client?.scope !== 'metrics:write') throw new ToolRefusal('insufficient_scope');
      if (!await services.metrics.authorize(ctx.person.id)) throw new ToolRefusal('unauthenticated');
      const authority = client ? { id: client.id, personId: ctx.person.id, fence: client.version, kind: client.kind } : undefined;
      if (!await services.metrics.push(input.id, input.points, authority)) throw new ToolRefusal('not_found');
      ctx.emit('metric.points_recorded', `lamp://metrics/${input.id}`);
      return { result: { accepted: input.points.length }, resources: [{ uri: `lamp://metrics/${input.id}`, name: 'Metric' }] };
    },
  }];
}
