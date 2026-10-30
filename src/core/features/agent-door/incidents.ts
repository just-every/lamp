import { z } from 'zod';
import { ToolRefusal, type ClassAndFacts, type ToolContext, type ToolDefinition } from '../../../../modules/agent-door/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { incidentFirstUpdateSchema, incidentDraftSchema, pageSettingsSchema } from '../../shared/schemas';
import { COMPONENT_STATES } from '../../shared/domain';
import { ulidSchema } from '../../shared/ids';
import { createOperatorRolesRepository } from '../operators/roles.repository';
import { allowsOperatorRequest } from '../operators/permissions';
import { agentNativeRepository } from './repository';
import { DraftConflictError } from '../incidents/repository';

const text = { type: 'string', minLength: 1, maxLength: 250 };
const idSchema = { type: 'object' as const, properties: { id: text }, required: ['id'], additionalProperties: false };
const record = { type: 'object', required: ['id'], properties: { id: text } };
const nativeIncident = { type: 'object', required: ['id', 'title', 'lifecycle', 'components', 'updates', 'internalNotes'], properties: {
  id: text, title: text, lifecycle: { type: 'string' }, components: { type: 'array' }, updates: { type: 'array' }, internalNotes: { type: 'array' },
} };
const draftVersion = { type: 'string', pattern: '^(?:[0-9A-HJKMNP-TV-Z]{26}|-):[0-9]+$' };
const results: Record<string, Record<string, unknown>> = {
  'configuration.save': { settings: { type: 'object', required: ['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'footerCreditEnabled'], properties: { pageName: text, tagline: { type: 'string' }, accentColor: { type: 'string' }, timezone: text, hostname: text, footerCreditEnabled: { type: 'boolean' } }, additionalProperties: false } },
  'incidents.list': { incidents: { type: 'array', items: nativeIncident } },
  'incidents.get': { incident: nativeIncident, draftVersion },
  'incidents.create': { id: text, incident: nativeIncident, draftVersion },
  'incidents.note': { id: text, saved: { const: true } },
  'incidents.draft': { id: text, draft: record, draftVersion },
  'incidents.publish': { id: text, update: { type: 'object', required: ['id', 'incidentId', 'lifecycle', 'publishedAt'], properties: { id: text, incidentId: text, lifecycle: { type: 'string' }, publishedAt: { type: 'string' } } } },
  'incidents.brief': { brief: { type: 'object', required: ['incident'] }, recovery: { type: 'object' } },
};
const standard: ClassAndFacts[] = [{ class: 'standard', facts: { measure: 1 } }];
const publication: ClassAndFacts[] = [{ class: 'external', facts: { measure: 0, counterparty: 'public' } }, { class: 'live', facts: { measure: 1, service: 'Lamp status page' } }];
const updateProperties = {
  lifecycle: { type: 'string', enum: ['Investigating', 'Identified', 'Monitoring', 'Resolved'] },
  affectedAudience: { type: 'string', maxLength: 250 }, customerImpact: { type: 'string', maxLength: 250 }, whatStillWorks: { type: 'string', maxLength: 250 }, details: { type: 'string', maxLength: 500 },
  nextUpdateAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
};
const updateSchema = { type: 'object', properties: updateProperties, required: Object.keys(updateProperties).filter(key => key !== 'nextUpdateAt'), additionalProperties: false };
const titles: Record<string, string> = {
  witness: 'Check record consistency', 'configuration.save': 'Save page settings',
  'incidents.list': 'List incidents', 'incidents.get': 'Read an incident', 'incidents.create': 'Prepare an incident',
  'incidents.note': 'Add a private note', 'incidents.draft': 'Save an update draft',
  'incidents.publish': 'Publish an incident update', 'incidents.brief': 'Read the incident brief',
};
const descriptions: Record<string, string> = {
  witness: 'Read counts and content hashes without returning private record text.',
  'configuration.save': 'Save the running status page identity and presentation as an Owner or Admin.',
  'incidents.list': 'Read incidents, their updates and private notes visible to the current operator.',
  'incidents.get': 'Read an incident and the current draft version needed for its next change.',
  'incidents.create': 'Prepare an incident with one affected component and an unpublished first update.',
  'incidents.note': 'Save a private note on an incident without publishing it.',
  'incidents.draft': 'Save update wording using its current draft version, preserving staged component choices.',
  'incidents.publish': 'Publish the exact saved draft to the public status page without selecting subscriber channels. Review and recovery requirements still apply.',
  'incidents.brief': 'Read the recorded incident evidence and recovery check.',
};
const firstUpdate = incidentFirstUpdateSchema;
const createSchema = z.object({ title: z.string().trim().min(1).max(250), componentId: ulidSchema, state: z.enum(COMPONENT_STATES), update: firstUpdate }).strict();
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ToolRefusal('invalid_arguments');
  return result.data;
}

/** MCP callbacks use the same native services and role decisions as the desk. */
export function incidentTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const native = agentNativeRepository(bindings.DB);
  async function guard(ctx: ToolContext, method: string, path: string) {
    const role = await createOperatorRolesRepository(bindings.DB).role(ctx.person.id);
    if (!role || !allowsOperatorRequest(role, method, `/api/app${path}`)) throw new ToolRefusal('forbidden');
  }
  async function incident(id: unknown) {
    const parsed = ulidSchema.safeParse(id);
    if (!parsed.success) throw new ToolRefusal('invalid_arguments');
    const value = await services.incidents.get(parsed.data);
    if (!value) throw new ToolRefusal('not_found');
    return value;
  }
  async function writeRevision<T>(id: string, expected: string, write: () => Promise<T>): Promise<T> {
    const changed = async () => new ToolRefusal('revision_conflict', 'Read the current incident draft before changing it.', { current_revision: await native.draftVersion(id) });
    if (expected !== await native.draftVersion(id)) throw await changed();
    try { return await write(); }
    catch (error) { if (error instanceof DraftConflictError) throw await changed(); throw error; }
  }
  const tool = (name: string, readOnly: boolean, classes: ToolDefinition['classes'], clauses: string[], inputSchema: ToolDefinition['inputSchema'], methods: Pick<ToolDefinition, 'classify' | 'run'> & Partial<ToolDefinition>): ToolDefinition => ({
    name: `lamp.${name}`, title: titles[name]!, description: descriptions[name]!,
    scope: name === 'witness' ? 'lamp:inspect' : readOnly ? 'incidents:read' : name === 'configuration.save' ? 'configuration:write' : name === 'incidents.publish' ? 'incidents:publish' : 'incidents:draft', readOnly, classes, clauses, inputSchema,
    outputSchema: name === 'witness' ? { type: 'object', minProperties: 1, additionalProperties: { type: 'object', required: ['count', 'sha256'], properties: { count: { type: 'integer', minimum: 0 }, sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, additionalProperties: false } }
      : { type: 'object', properties: results[name], required: Object.keys(results[name]!), additionalProperties: false },
    ...(name !== 'witness' ? { untrusted: true } : {}), ...methods,
  });
  const target = (args: Record<string, unknown>) => ({ kind: 'incident', id: String(args.id) });
  const summary = async (args: Record<string, unknown>) => ({ target: { id: String(args.id), name: (await incident(args.id)).title } });
  return [
    tool('configuration.save', false, ['external', 'live'], ['SETUP-001', 'SETUP-002', 'PAGE-001', 'THEME-002'], {
      type: 'object', properties: { pageName: { ...text, maxLength: 120 }, tagline: { ...text, maxLength: 280 }, accentColor: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, timezone: { ...text, maxLength: 100 }, hostname: { ...text, maxLength: 253 }, footerCreditEnabled: { type: 'boolean' } },
      required: ['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'footerCreditEnabled'], additionalProperties: false,
    }, {
      summary: args => ({ target: { name: String(args.pageName) }, items: ['Save the running status page identity and presentation'] }),
      classify: async (_args, ctx) => { await guard(ctx, 'PUT', '/page-settings'); return publication; },
      run: async (args, ctx) => {
        await guard(ctx, 'PUT', '/page-settings');
        // This tool does not edit owner AI instructions. Discard the form
        // schema's default so the native update preserves an existing value.
        const { aiToneInstructions: _instructions, ...input } = parse(pageSettingsSchema, args);
        await services.pageSettings.ensureInitial(input);
        const saved = await services.pageSettings.update(input);
        if (!saved) throw new ToolRefusal('not_found');
        const { pageName, tagline, accentColor, timezone, hostname, footerCreditEnabled } = saved;
        return { result: { settings: { pageName, tagline, accentColor, timezone, hostname, footerCreditEnabled } } };
      },
    }),
    tool('witness', true, ['standard'], ['BASE-AGENT-005', 'BASE-AGENT-012'], { type: 'object', properties: {}, additionalProperties: false }, {
      classify: async (_args, ctx) => { await guard(ctx, 'GET', '/components'); return standard; },
      run: async (_args, ctx) => { await guard(ctx, 'GET', '/components'); return { result: await native.witness() }; },
    }),
    tool('incidents.list', true, ['sensitive'], ['INCIDENT-001', 'AGENT-008'], { type: 'object', properties: {}, additionalProperties: false }, {
      classify: async (_args, ctx) => { await guard(ctx, 'GET', '/incidents'); return [{ class: 'sensitive', facts: { measure: (await services.incidents.list()).length, kind: 'private incident record' } }]; },
      run: async (_args, ctx) => { await guard(ctx, 'GET', '/incidents'); return { result: { incidents: await services.incidents.list() } }; },
    }),
    tool('incidents.get', true, ['sensitive'], ['INCIDENT-001', 'AGENT-008'], idSchema, {
      target,
      classify: async (args, ctx) => { await guard(ctx, 'GET', `/incidents/${args.id}`); await incident(args.id); return [{ class: 'sensitive', facts: { measure: 1, kind: 'private incident record' } }]; },
      run: async (args, ctx) => { await guard(ctx, 'GET', `/incidents/${args.id}`); return { result: { incident: await incident(args.id), draftVersion: await native.draftVersion(String(args.id)) } }; },
    }),
    tool('incidents.create', false, ['standard'], ['INCIDENT-001', 'UPDATE-001', 'AGENT-008'], {
      type: 'object', properties: { title: text, componentId: text, state: { type: 'string', enum: [...COMPONENT_STATES] }, update: updateSchema }, required: ['title', 'componentId', 'state', 'update'], additionalProperties: false,
    }, {
      summary: args => ({ target: { name: String(args.title) }, items: [String(args.componentId)] }),
      classify: async (_args, ctx) => { await guard(ctx, 'POST', '/incidents'); return standard; },
      run: async (args, ctx) => {
        await guard(ctx, 'POST', '/incidents'); const value = parse(createSchema, args);
        const record = await services.incidents.create({ title: value.title, components: [{ componentId: value.componentId, state: value.state, relationship: 'Primary' }], update: value.update }, ctx.person.id);
        return { result: { id: record.id, incident: record, draftVersion: await native.draftVersion(record.id) } };
      },
    }),
    tool('incidents.note', false, ['standard'], ['INCIDENT-007', 'AGENT-008'], {
      type: 'object', properties: { id: text, body: { type: 'string', minLength: 1, maxLength: 5000 } }, required: ['id', 'body'], additionalProperties: false,
    }, {
      target, summary,
      classify: async (args, ctx) => { await guard(ctx, 'POST', `/incidents/${args.id}/internal-notes`); await incident(args.id); return standard; },
      run: async (args, ctx) => { await guard(ctx, 'POST', `/incidents/${args.id}/internal-notes`); const input = parse(z.object({ id: ulidSchema, body: z.string().trim().min(1).max(5000) }), args); if (!await services.incidents.addInternalNote(input.id, input.body, ctx.person.id)) throw new ToolRefusal('not_found'); return { result: { id: input.id, saved: true } }; },
    }),
    tool('incidents.draft', false, ['standard'], ['UPDATE-001', 'UPDATE-005', 'AGENT-008'], {
      type: 'object', properties: { id: text, draftVersion: { type: 'string' }, update: updateSchema }, required: ['id', 'draftVersion', 'update'], additionalProperties: false,
    }, {
      target, summary, revisionType: 'string', revision: args => native.draftVersion(String(args.id)),
      classify: async (args, ctx) => { await guard(ctx, 'PUT', `/incidents/${args.id}/draft`); return standard; },
      run: async (args, ctx) => {
        await guard(ctx, 'PUT', `/incidents/${args.id}/draft`);
        const id = parse(ulidSchema, args.id), expected = String(args.draftVersion);
        const input = parse(incidentDraftSchema, args.update);
        const draft = await writeRevision(id, expected, () => services.incidents.saveDraft(id, input, ctx.person.id, expected));
        if (!draft) throw new ToolRefusal('not_found');
        return { result: { id, draft, draftVersion: await native.draftVersion(id) } };
      },
    }),
    tool('incidents.publish', false, ['external', 'live'], ['UPDATE-001', 'UPDATE-007', 'UPDATE-008', 'AGENT-008'], {
      type: 'object', properties: { id: text, draftVersion: { type: 'string' } }, required: ['id', 'draftVersion'], additionalProperties: false,
    }, {
      target, summary, revisionType: 'string', revision: args => native.draftVersion(String(args.id)),
      classify: async (args, ctx, completed) => { await guard(ctx, 'POST', `/incidents/${args.id}/publish`); if (completed) return [...completed]; await incident(args.id); return publication; },
      run: async (args, ctx) => {
        await guard(ctx, 'POST', `/incidents/${args.id}/publish`);
        const id = parse(ulidSchema, args.id), expected = String(args.draftVersion);
        const value = await writeRevision(id, expected, () => services.incidents.publish(id, ctx.person.id, { channels: [], expectedVersion: expected }));
        if (!value) throw new ToolRefusal('not_found');
        await services.incidents.finishPublication(value);
        return { result: { id: value.id, update: value } };
      },
    }),
    tool('incidents.brief', true, ['sensitive'], ['AGENT-001', 'AGENT-004', 'INCIDENT-009'], idSchema, {
      target,
      classify: async (args, ctx) => { await guard(ctx, 'GET', `/incidents/${args.id}`); await incident(args.id); return [{ class: 'sensitive', facts: { measure: 1, kind: 'private incident brief' } }]; },
      run: async (args, ctx) => { await guard(ctx, 'GET', `/incidents/${args.id}`); return { result: { brief: await services.briefs.get(parse(ulidSchema, args.id)), recovery: await services.incidents.recoveryCheck(String(args.id)) } }; },
    }),
  ];
}
