import { defineTool, ToolRefusal, type ToolContext, type ToolDefinition } from '../../../base/modules/agent-door/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createAgentAccessRepository } from './access.repository';

const id = { type: 'string', minLength: 1, maxLength: 128 };
const targetSchema = { type: 'object' as const, properties: { id }, required: ['id'], additionalProperties: false };
const resultSchema = { type: 'object', properties: { id, removed: { type: 'boolean' } }, required: ['id', 'removed'], additionalProperties: false };
const ownerClauses = ['TEAM-001', 'TEAM-002', 'TEAM-003', 'AGENT-008'];

/** Security changes retain their real native scope. A revocation cannot mint a
 * token, link a chat identity or manufacture a person's native owner proof. */
export function accessTools(bindings: AppBindings, services: AppServices): ToolDefinition[] {
  const repository = createAgentAccessRepository(bindings.DB);
  async function owner(ctx: ToolContext) {
    const actor = await repository.actor(ctx.person.id);
    if (!actor) throw new ToolRefusal('unauthenticated');
    return actor;
  }
  async function link(args: Record<string, unknown>, ctx: ToolContext) {
    await owner(ctx);
    const target = (await repository.links.list(ctx.person.id)).find(record => record.id === args.id);
    if (!target) throw new ToolRefusal('not_found');
    return target;
  }
  async function token(args: Record<string, unknown>, ctx: ToolContext) {
    await owner(ctx);
    const target = await repository.tokens.get(String(args.id));
    if (!target || target.revokedAt !== null) throw new ToolRefusal('not_found');
    return target;
  }
  return [
    defineTool({
      name: 'lamp.access.read', title: 'Read native access',
      description: 'Read current operators, non-secret management credential metadata and the sponsor’s chat links. An optional target returns its currently effective grants for revocation readback. No link codes, bearer credentials or provider secrets are returned.',
      scope: 'access:read', readOnly: true, clauses: ownerClauses,
      inputSchema: { type: 'object', properties: { id }, additionalProperties: false },
      outputSchema: { type: 'object', properties: { operators: { type: 'array' }, invited: { type: 'array' }, credentials: { type: 'array' }, chatLinks: { type: 'array' }, grants: { type: 'array', items: { type: 'string' } } }, required: ['operators', 'invited', 'credentials', 'chatLinks', 'grants'] },
      classes: ['standard'],
      async classify(_args, ctx) { await owner(ctx); return [{ class: 'standard', facts: { measure: 1 } }]; },
      async run(args, ctx) {
        await owner(ctx);
        const [operators, invited, credentials, chatLinks] = await Promise.all([
          repository.operators.listOperators(), repository.operators.listInvitedOperators(), repository.tokens.list(), repository.links.list(ctx.person.id),
        ]);
        const nativeToken = credentials.find(record => record.id === args.id);
        const nativeLink = chatLinks.find(record => record.id === args.id);
        const grants = nativeToken
          ? await repository.effectiveTokenGrants(nativeToken.id)
          : nativeLink ? [`chat:${nativeLink.transport}`] : [];
        return { result: { operators, invited, credentials, chatLinks, grants } };
      },
    }),
    defineTool({
      name: 'lamp.access.update', title: 'Revoke a chat link',
      description: 'Remove one of the current sponsor’s native Slack or Teams identity links. This operation only narrows access; creating a single-use link code and consuming it remains the native person/chat identity flow.',
      scope: 'access:write', readOnly: false, clauses: [...ownerClauses, 'INCIDENT-012'],
      inputSchema: targetSchema, outputSchema: resultSchema, classes: ['access', 'security'],
      widens: false, narrowing: { effect: 'revoke', target: 'id' },
      async authority(args, ctx) { await link(args, ctx); return { subject: ctx.person.id, widens: false }; },
      async classify(args, ctx) { const target = await link(args, ctx); return [{ class: 'access', facts: { measure: 1, direction: 'narrows' } }, { class: 'security', facts: { measure: 1, setting: `chat-link:${target.transport}` } }]; },
      async revision(args, ctx) { return (await link(args, ctx)).createdAt; }, revisionType: 'string',
      async summary(args, ctx) { const target = await link(args, ctx); return { target: { id: target.id, name: `${target.transport}: ${target.subject}` }, items: [`Remove chat access for ${ctx.person.name}`] }; },
      async run(args, ctx) {
        const target = await link(args, ctx);
        if (!await services.chatDesk.links.remove(target.id, ctx.person.id)) throw new ToolRefusal('not_found');
        ctx.emit('access.chat-link.revoked', `lamp://access/${encodeURIComponent(ctx.person.id)}`, { id: target.id, approved_by: ctx.approvers });
        return { result: { id: target.id, removed: true } };
      },
    }),
    defineTool({
      name: 'lamp.credentials.update', title: 'Revoke a management credential',
      description: 'Revoke one existing native management token and its underlying credential. This operation cannot create a credential or widen its read or metrics scope. Secret issuance remains the native recent-human-proof screen.',
      scope: 'credentials:write', readOnly: false, clauses: [...ownerClauses, 'API-001'],
      inputSchema: targetSchema, outputSchema: resultSchema, classes: ['access', 'security'],
      widens: false, narrowing: { effect: 'revoke', target: 'id' },
      async authority(args, ctx) { const target = await token(args, ctx); return { subject: target.issuerId, widens: false }; },
      async classify(args, ctx) { await token(args, ctx); return [{ class: 'access', facts: { measure: 1, direction: 'narrows' } }, { class: 'security', facts: { measure: 1, setting: 'management-token' } }]; },
      async revision(args, ctx) { const target = await token(args, ctx); return `${target.id}:${target.revokedAt ?? 'active'}:${target.expiresAt}`; }, revisionType: 'string',
      async summary(args, ctx) { const target = await token(args, ctx); return { target: { id: target.id, name: target.name }, items: target.scopes.map(scope => `Revoke ${scope}`) }; },
      async run(args, ctx) {
        const target = await token(args, ctx), actor = await owner(ctx);
        if (!await repository.tokens.revoke(target.id, actor.id, actor.version)) throw new ToolRefusal('authority_changed');
        ctx.emit('access.credential.revoked', `lamp://access/${encodeURIComponent(target.issuerId)}`, { id: target.id, approved_by: ctx.approvers });
        return { result: { id: target.id, removed: true } };
      },
    }),
    defineTool({
      name: 'lamp.privacy.erase', title: 'Erase a subscriber',
      description: 'Use native subscriber erasure to remove the recipient’s identifying data and deactivate delivery authority while retaining the native non-personal audit. This is irreversible and sends no invitation or confirmation.',
      scope: 'privacy:erase', readOnly: false, clauses: ['SUB-011', 'BASE-DATA-003', 'TEAM-001', 'TEAM-003', 'AGENT-008'],
      inputSchema: targetSchema, outputSchema: resultSchema, classes: ['destructive'],
      async classify(args, ctx) { await owner(ctx); if (!await repository.subscriber(String(args.id))) throw new ToolRefusal('not_found'); return [{ class: 'destructive', facts: { measure: 1 } }]; },
      async revision(args, ctx) { await owner(ctx); return (await repository.subscriber(String(args.id)))?.updatedAt ?? null; }, revisionType: 'string',
      async summary(args, ctx) {
        await owner(ctx); const target = await repository.subscriber(String(args.id));
        if (!target) throw new ToolRefusal('not_found');
        return { target: { id: target.id, name: `${target.channel} subscriber` }, items: ['Erase destination and recipient details; revoke delivery and subscription credentials'] };
      },
      async run(args, ctx) {
        await owner(ctx); const target = await repository.subscriber(String(args.id));
        if (!target || !await services.subscribers.deleteSubscriber(target.id, ctx.person.id)) throw new ToolRefusal('not_found');
        ctx.emit('subscriber.erased', `lamp://subscribers/${encodeURIComponent(target.id)}`, { id: target.id, approved_by: ctx.approvers });
        return { result: { id: target.id, removed: true } };
      },
    }),
  ];
}
