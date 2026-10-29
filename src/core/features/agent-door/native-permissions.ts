import type { ResourceDefinition, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import { allowsOperatorRequest } from '../operators/permissions';
import { createOperatorRolesRepository } from '../operators/roles.repository';

// Each entry names the production person route whose permission the tool needs.
// Unknown mutations remain closed for non-administrators, as in native HTTP.
const writes: Record<string, [string, string]> = {
  'incidents.create': ['POST', '/incidents'],
  'incidents.update': ['PUT', '/incidents/record/draft'],
  'incidents.note': ['POST', '/incidents/record/internal-notes'],
  'incidents.publish': ['POST', '/incidents/record/publish'],
  'incidents.resolve': ['POST', '/incidents/record/publish'],
  'incidents.delete': ['DELETE', '/incidents/record'],
  'incidents.assign': ['PUT', '/incidents/record/owner'],
  'drafts.save': ['PUT', '/incidents/record/draft'],
  'impact.update': ['PUT', '/incidents/record/impact'],
  'updates.correct': ['POST', '/incidents/record/draft/correction'],
  'updates.schedule': ['POST', '/incidents/record/draft/schedule'],
  'updates.dispatch': ['POST', '/incidents/record/publish'],
  'deliveries.dispatch': ['POST', '/incidents/record/publish'],
  'reports.draft': ['POST', '/incidents/record/report/draft'],
  'reports.save': ['PUT', '/incidents/record/report'],
  'reports.publish': ['POST', '/incidents/record/report/publish'],
  'reports.waive': ['POST', '/incidents/record/report/waive'],
  'templates.apply': ['POST', '/incidents/record/templates/template/apply'],
  'ai.suggest': ['POST', '/incidents/record/ai-suggestion'],
  'ai.check': ['POST', '/incidents/record/ai-suggestion'],
  'claims.update': ['PUT', '/components/record/standing-claim'],
  'components.correct': ['PUT', '/components/record/history/change/correction'],
  'followups.retry': ['POST', '/overview/follow-ups/retry'],
  'followups.dismiss': ['POST', '/overview/follow-ups/dismiss'],
  'maintenance.create': ['POST', '/maintenance'],
  'maintenance.update': ['PUT', '/maintenance/record/window'],
  'maintenance.start': ['POST', '/maintenance/record/start'],
  'maintenance.complete': ['POST', '/maintenance/record/complete'],
  'maintenance.cancel': ['POST', '/maintenance/record/cancel'],
  'subscribers.add': ['POST', '/subscribers'],
  'subscribers.invite': ['POST', '/subscribers/import/invite'],
  'subscribers.remove': ['DELETE', '/subscribers/record'],
  'privacy.erase': ['DELETE', '/subscribers/record'],
  'access.update': ['DELETE', '/chat-links/record'],
};
const readPath = (family: string) => ({
  access: '/operators', credentials: '/management-tokens', operators: '/operators',
  importgrants: '/import-door', workspace: '/audit-log', page: '/page-settings',
  status: '/overview', recovery: '/incidents', groups: '/component-groups',
  followups: '/overview/follow-ups', templates: '/incident-templates',
}[family] ?? `/${family}`);

export function nativeDoorPermissions(db: D1Database) {
  const roles = createOperatorRolesRepository(db);
  const allowed = async (person: string, method: string, path: string) => {
    const role = await roles.role(person);
    return role !== null && allowsOperatorRequest(role, method, '/api/app' + path);
  };
  return {
    tool(tool: ToolDefinition): ToolDefinition {
      const job = tool.name.slice('lamp.'.length), family = job.split('.')[0];
      const [method, path] = tool.readOnly ? ['GET', readPath(family)] : writes[job] ?? ['POST', readPath(family)];
      const require = async (person: string) => {
        if (!await allowed(person, method, path)) throw new ToolRefusal('native_permission_denied');
      };
      return {...tool,
        classify: async (args, ctx) => { await require(ctx.person.id); return tool.classify(args, ctx); },
        run: async (args, ctx) => { await require(ctx.person.id); return tool.run(args, ctx); },
        ...(typeof tool.authority === 'function' ? {authority: async (args, ctx) => {
          await require(ctx.person.id); return (tool.authority as Exclude<typeof tool.authority, 'none' | undefined>)(args, ctx);
        }} : {}),
      };
    },
    resource(resource: ResourceDefinition): ResourceDefinition {
      const family = new URL(resource.uriTemplate).hostname;
      return {...resource, read: async (uri, ctx) =>
        await allowed(ctx.person.id, 'GET', readPath(family)) ? resource.read(uri, ctx) : null};
    },
  };
}
