import type { ToolDefinition, ToolContext, ResourceDefinition } from '../../../../modules/agent-door/types.ts';
import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createManagementApiService } from '../management-api/service';
import { createSubscriberRepository } from '../subscribers/repository';
import { createPeopleAdapter } from './people';
import { createAgentIdentityRepository } from './identity.repository';
import { createOwnerTools } from './owner-tools';

const idSchema = {type: 'object' as const, properties: {id: {type: 'string', minLength: 1, maxLength: 128}}, required: ['id'], additionalProperties: false};
const outputSchema = {type: 'object', additionalProperties: true};
const changed = (ctx: ToolContext, type: string, uri: string, result: unknown) => {
  ctx.emit(type, uri);
  return {result, resources: [{uri, name: type}]};
};

/** Uses existing native fences; secret issuance and email step-up stay native. */
export function createAccessTools(services: AppServices, bindings: AppBindings): ToolDefinition[] {
  const people = createPeopleAdapter(services, bindings), identities = createAgentIdentityRepository(bindings.DB);
  const management = createManagementApiService(bindings.DB, services.auth), subscribers = createSubscriberRepository(bindings.DB);
  const current = async (ctx: ToolContext) => {
    const person = await people.person(ctx.person.id);
    if (!person?.active) throw new ToolRefusal('sponsor_unavailable');
    return person;
  };
  const target = async (id: string, ctx: ToolContext) => {
    await current(ctx);
    const token = (await management.list()).find(row => row.id === id);
    if (token) return {kind: 'management-token' as const, id, subject: token.issuerId, name: token.name,
      grants: await identities.credential(token.id, token.issuerId) ? token.scopes.map(scope => `management:${scope}`) : [], revision: String(token.revokedAt ?? token.expiresAt)};
    const link = (await services.chatDesk.links.list(ctx.person.id)).find(row => row.id === id);
    if (link) return {kind: 'chat-link' as const, id, subject: ctx.person.id, name: `${link.transport} chat link`,
      grants: [`chat:${link.transport}:incident-preview`, `chat:${link.transport}:incident-publish`], revision: link.createdAt};
    const operator = await identities.person(id);
    if (operator) return {kind: 'operator' as const, id, subject: id, name: operator.displayName,
      grants: operator.status === 'active' ? ['lamp:operator'] : [], revision: String(operator.version)};
    return null;
  };
  return [
    ...createOwnerTools(services, bindings),
    {
      name: 'lamp.access.read', title: 'Read current Lamp access',
      description: 'Read native operator and credential metadata, or one credential/link’s effective grants. No bearer, signing material, chat subject, or raw connection secret is returned.',
      scope: 'lamp.access.read', readOnly: true,
      inputSchema: {type: 'object', properties: {id: {type: 'string', minLength: 1, maxLength: 128}}, additionalProperties: false},
      outputSchema, classes: ['standard'], clauses: ['TEAM-001', 'TEAM-003', 'API-001', 'AGENT-008'],
      classify: () => [{class: 'standard', facts: {measure: 1}}],
      async run(args, ctx) {
        await current(ctx);
        if (typeof args.id === 'string') {
          const record = await target(args.id, ctx);
          return {result: record ?? {id: args.id, grants: []}};
        }
        const [operators, tokens, links] = await Promise.all([services.operators.listOperators(), management.list(), services.chatDesk.links.list(ctx.person.id)]);
        const activeTokens = (await Promise.all(tokens.map(async token => await identities.credential(token.id, token.issuerId) ? token : null)))
          .filter((token): token is (typeof tokens)[number] => token !== null);
        return {result: {operators, tokens, activeTokens, chatLinks: links.map(({id, transport, createdAt}) => ({id, transport, createdAt})),
          nativePermissions: 'Every admitted Lamp operator has the same native authority; signed Business policy roles are separate.'}};
      },
    },
    {
      name: 'lamp.access.update', title: 'Remove a native chat link',
      description: 'Revoke one Slack/Teams identity currently linked to the sponsoring native operator. Establishing a new identity requires the existing single-use native linking screen.',
      scope: 'lamp.access.update', readOnly: false, inputSchema: idSchema, outputSchema,
      classes: ['access', 'security'], clauses: ['AGENT-008', 'TEAM-003', 'API-001'],
      widens: false, narrowing: {effect: 'revoke', target: 'id'},
      async authority(_args, ctx) { await current(ctx); return {subject: ctx.person.id, widens: false}; },
      classify: () => [{class: 'access', facts: {measure: 1, direction: 'narrows'}}, {class: 'security', facts: {measure: 1, setting: 'chat identity'}}],
      async revision(args, ctx) { return (await target(String(args.id), ctx))?.revision ?? null; },
      async summary(args, ctx) {
        const record = await target(String(args.id), ctx);
        return {target: {id: String(args.id), name: record?.kind === 'chat-link' ? record.name : 'Unavailable chat link'}, items: ['Revoke this linked chat identity']};
      },
      async run(args, ctx) {
        const record = await target(String(args.id), ctx);
        if (record?.kind !== 'chat-link') throw new ToolRefusal('record_not_found');
        if (!await services.chatDesk.links.remove(record.id, ctx.person.id)) throw new ToolRefusal('revision_conflict');
        // Native unlink removes this record. Link the surviving sponsor access
        // projection; the narrowing witness still reads the removed link's grants.
        ctx.emit('access.changed', `lamp://access/${record.id}`);
        return {result: {id: record.id, revoked: true}, resources: [{uri: `lamp://access/${ctx.person.id}`, name: 'Current sponsoring operator access'}]};
      },
    },
    {
      name: 'lamp.credentials.update', title: 'Revoke a management credential',
      description: 'Revoke an existing native management token and its underlying credential. Creating or revealing credentials retains the native recent email-proof screen.',
      scope: 'lamp.credentials.update', readOnly: false, inputSchema: idSchema, outputSchema,
      classes: ['access', 'security'], clauses: ['API-001', 'AGENT-008', 'TEAM-007'],
      widens: false, narrowing: {effect: 'revoke', target: 'id'},
      async authority(args, ctx) { return {subject: (await target(String(args.id), ctx))?.subject ?? ctx.person.id, widens: false}; },
      classify: () => [{class: 'access', facts: {measure: 1, direction: 'narrows'}}, {class: 'security', facts: {measure: 1, setting: 'management credential'}}],
      async revision(args, ctx) { return (await target(String(args.id), ctx))?.revision ?? null; },
      async summary(args, ctx) {
        const record = await target(String(args.id), ctx);
        return {target: {id: String(args.id), name: record?.kind === 'management-token' ? record.name : 'Unavailable management credential'}, items: ['Revoke this credential and every retained native scope']};
      },
      async run(args, ctx) {
        const record = await target(String(args.id), ctx), actor = await identities.person(ctx.person.id);
        if (record?.kind !== 'management-token') throw new ToolRefusal('record_not_found');
        if (!actor || !await management.revoke(record.id, actor.id, actor.version)) throw new ToolRefusal('revision_conflict');
        return changed(ctx, 'credentials.changed', `lamp://access/${record.id}`, {id: record.id, revoked: true});
      },
    },
    {
      name: 'lamp.privacy.erase', title: 'Erase a subscriber',
      description: 'Permanently erase one native subscriber and its retained personal custody using Lamp’s existing erasure service. Operator erasure retains the native owner recovery and email-proof screen.',
      scope: 'lamp.privacy.erase', readOnly: false, inputSchema: idSchema, outputSchema,
      classes: ['destructive'], clauses: ['SUB-011', 'AGENT-008', 'TEAM-007'],
      classify: () => [{class: 'destructive', facts: {measure: 1}}],
      async revision(args, ctx) { await current(ctx); return (await subscribers.findSubscriber(String(args.id)))?.updatedAt ?? null; },
      async summary(args, ctx) {
        await current(ctx);
        const subscriber = await subscribers.findSubscriber(String(args.id));
        return {target: {id: String(args.id), name: subscriber ? `${subscriber.channel} subscriber` : 'Unavailable subscriber'}, items: ['Permanently erase retained subscriber personal data']};
      },
      async run(args, ctx) {
        await current(ctx);
        if (!await services.subscribers.deleteSubscriber(String(args.id), ctx.person.id)) throw new ToolRefusal('record_not_found');
        return changed(ctx, 'subscribers.erased', `lamp://subscribers/${args.id}`, {id: args.id, erased: true});
      },
    },
  ];
}

export function createAccessResources(services: AppServices, bindings: AppBindings): ResourceDefinition[] {
  const people = createPeopleAdapter(services, bindings), management = createManagementApiService(bindings.DB, services.auth), identities = createAgentIdentityRepository(bindings.DB);
  return [{uriTemplate: 'lamp://access/{id}', name: 'Native access metadata', scope: 'lamp.access.read', classes: ['standard'],
    description: 'Native operator status, effective management scopes or the sponsoring person’s linked chat identity, without secrets or chat-principal fields.',
    classify: () => [{class: 'standard', facts: {measure: 1}}],
    async read(uri, ctx) {
      if (!(await people.person(ctx.person.id))?.active) return null;
      const match = /^lamp:\/\/access\/([^/]+)$/.exec(uri);
      if (!match) return null;
      let id: string; try { id = decodeURIComponent(match[1]); } catch { return null; }
      const operator = await identities.person(id);
      if (operator) return {json:{id:operator.id,name:operator.displayName,role:operator.role,status:operator.status,
        grants:operator.status === 'active' && operator.role === 'owner' ? ['native:owner'] : []}};
      const token = (await management.list()).find(row => row.id === id);
      if (token) return {json: {id, name: token.name, issuerId: token.issuerId, revokedAt: token.revokedAt,
        expiresAt: token.expiresAt, grants: await identities.credential(token.id, token.issuerId) ? token.scopes.map(scope => `management:${scope}`) : []}};
      const link = (await services.chatDesk.links.list(ctx.person.id)).find(row => row.id === id);
      return link ? {json: {id, transport: link.transport, createdAt: link.createdAt,
        grants: [`chat:${link.transport}:incident-preview`, `chat:${link.transport}:incident-publish`]}} : null;
    },
  }];
}
