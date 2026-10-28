import type { ToolDefinition } from '../../../base/modules/agent-door/types.ts';
import type { AppServices } from '../../app/services';
import { ToolRefusal } from '../../../base/modules/agent-door/index.ts';

export function connectionTools(services: AppServices): ToolDefinition[] {
  const inputSchema = { type: 'object' as const, properties: {}, additionalProperties: false };
  const base = { scope: 'lamp:read', readOnly: true, inputSchema, classes: ['standard' as const],
    classify: async (_args: Record<string, unknown>, ctx: import('../../../base/modules/agent-door/types.ts').ToolContext) => {
      if (ctx.clientId?.startsWith('management-token:')) throw new ToolRefusal('insufficient_scope');
      return [{ class: 'standard' as const, facts: { measure: 1 } }];
    } };
  return [{ ...base, name: 'lamp.channels.read', title: 'Read channel delivery configuration', description: 'Read native Slack/Teams channel metadata, consent and retained outcomes without credential URLs.',
    clauses: ['NOTIFY-011', 'NOTIFY-012', 'NOTIFY-016'], outputSchema: { type: 'object', properties: { channels: { type: 'array' }, posts: { type: 'array' } }, required: ['channels', 'posts'] },
    run: async () => ({ result: { channels: await services.channels.list(), posts: (await services.channels.log()).map(post => ({ id: post.id, state: post.state, kind: post.kind, reference: post.reference })) } }),
  }, { ...base, name: 'lamp.social.read', title: 'Read social publication outcomes', description: 'Read native supported social-account metadata and retained post identities. Provider credentials and opaque invocation custody are excluded.',
    clauses: ['INTEG-002'], outputSchema: { type: 'object', properties: { accounts: { type: 'array' }, posts: { type: 'array' } }, required: ['accounts', 'posts'] },
    async run() { const state = await services.social.list(); return { result: { accounts: state.accounts, posts: state.posts.map(post => ({ id: post.id, eventId: post.eventId, accountId: post.accountId, network: post.network, state: post.state })) } }; },
  }, { ...base, name: 'lamp.imports.read', title: 'Read subscriber import outcomes', description: 'Read current native subscriber batch outcomes. Applying or restoring an import remains the separate native import door; this read sends no invitation.',
    clauses: ['MOVE-002', 'SUB-017'], outputSchema: { type: 'object', properties: { batches: { type: 'array' } }, required: ['batches'] },
    run: async (_args, ctx) => ({ result: { batches: await services.subscribers.intake.batches(ctx.person.id) } }),
  }];
}
