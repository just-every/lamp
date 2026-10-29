import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import type { ResourceDefinition, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import { allowsOperatorRequest } from '../operators/permissions';
import { createOperatorRolesRepository } from '../operators/roles.repository';

// Match each direct service call to the native route's current role boundary.
// Configuration and unknown operations retain the native Owner/Admin boundary.
const writes: Record<string, [string, string]> = {
  'incidents.create': ['POST', '/incidents'],
  'incidents.update': ['PUT', '/incidents/record/draft'],
  'drafts.save': ['PUT', '/incidents/record/draft'],
  'incidents.note': ['POST', '/incidents/record/internal-notes'],
  'incidents.publish': ['POST', '/incidents/record/publish'],
  'incidents.resolve': ['POST', '/incidents/record/publish'],
  'incidents.delete': ['DELETE', '/incidents/record'],
  'incidents.assign': ['PUT', '/incidents/record/owner'],
  'updates.correct': ['POST', '/incidents/record/draft/correction'],
  'updates.schedule': ['POST', '/incidents/record/draft/schedule'],
  'updates.dispatch': ['POST', '/incidents/record/publish'],
  'deliveries.dispatch': ['POST', '/incidents/record/publish'],
  'impact.update': ['PUT', '/incidents/record/impact'],
  'reports.draft': ['POST', '/incidents/record/report/draft'],
  'reports.save': ['PUT', '/incidents/record/report'],
  'reports.publish': ['POST', '/incidents/record/report/publish'],
  'reports.waive': ['POST', '/incidents/record/report/waive'],
  'templates.apply': ['POST', '/incidents/record/templates/template/apply'],
  'claims.update': ['PUT', '/components/record/standing-claim'],
  'components.correct': ['PUT', '/components/record/history/entry/correction'],
  'maintenance.create': ['POST', '/maintenance'],
  'maintenance.update': ['PUT', '/maintenance/record/window'],
  'maintenance.start': ['POST', '/maintenance/record/start'],
  'maintenance.complete': ['POST', '/maintenance/record/complete'],
  'maintenance.cancel': ['POST', '/maintenance/record/cancel'],
  'subscribers.add': ['POST', '/subscribers'],
  'subscribers.invite': ['POST', '/subscribers/import/invite'],
  'subscribers.remove': ['DELETE', '/subscribers/record'],
  'privacy.erase': ['DELETE', '/subscribers/record'],
  'followups.retry': ['POST', '/overview/follow-ups/retry'],
  'followups.dismiss': ['POST', '/overview/follow-ups/dismiss'],
  'ai.suggest': ['POST', '/incidents/record/ai-suggestion'],
};
const reads: Record<string, string> = {
  status: 'overview', followups: 'overview', drafts: 'incidents', updates: 'incidents',
  impact: 'incidents', recovery: 'incidents', templates: 'incident-templates',
  groups: 'component-groups', page: 'page-settings', access: 'operators',
  credentials: 'management-tokens', importgrants: 'import-door', imports: 'statuspage-import',
  workspace: 'page-export', claims: 'components',
};

export function nativeAuthority(db: D1Database) {
  const roles = createOperatorRolesRepository(db);
  const allowed = async (person: string, method: string, path: string) => {
    const role = await roles.role(person);
    if (role && allowsOperatorRequest(role, method, `/api/app${path}`)) return true;
    await roles.denied(person, method, `/api/app${path}`);
    return false;
  };
  return {
    tool(tool: ToolDefinition): ToolDefinition {
      const name = tool.name.slice('lamp.'.length), area = name.split('.')[0]!;
      const [method, path] = tool.readOnly ? ['GET', `/${reads[area] ?? area}`]
        : writes[name] ?? ['POST', '/settings'];
      const admit = async (person: string) => {
        if (!await allowed(person, method, path)) throw new ToolRefusal('native_forbidden');
      };
      return { ...tool, clauses: [...new Set([...tool.clauses, 'TEAM-004'])],
        async classify(args, ctx, completed) { await admit(ctx.person.id); return tool.classify(args, ctx, completed); },
        async run(args, ctx) { await admit(ctx.person.id); return tool.run(args, ctx); },
        ...(tool.target ? { target: async (args, ctx) => { await admit(ctx.person.id); return tool.target!(args, ctx); } } : {}),
        ...(tool.revision ? { revision: async (args, ctx) => { await admit(ctx.person.id); return tool.revision!(args, ctx); } } : {}),
        ...(tool.summary ? { summary: async (args, ctx) => { await admit(ctx.person.id); return tool.summary!(args, ctx); } } : {}),
      };
    },
    resource(resource: ResourceDefinition): ResourceDefinition {
      const area = new URL(resource.uriTemplate).hostname;
      return { ...resource, async read(uri, ctx) {
        if (!await allowed(ctx.person.id, 'GET', `/${reads[area] ?? area}`)) return null;
        return resource.read(uri, ctx);
      } };
    },
  };
}
