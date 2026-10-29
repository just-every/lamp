import type { ResourceDefinition, ToolDefinition } from '../../../../modules/agent-door/types.ts';

// Resolve attribution through the same current native projections as resources.
// An argument or a returned link alone never proves that a record exists.
const records: Record<string, [string, string, string]> = {
  incidents: ['incidents', 'incident', 'incident'], drafts: ['incidents', 'incident', 'incident'],
  impact: ['incidents', 'incident', 'incident'], updates: ['incidents', 'incident', 'incident'],
  recovery: ['incidents', 'incident', 'incident'], reports: ['incidents', 'incident', 'incident'],
  components: ['components', 'component', 'component'], claims: ['components', 'component', 'component'],
  maintenance: ['maintenance', 'maintenance', 'maintenance'],
  groups: ['groups', 'group', 'group'], metrics: ['metrics', 'metric', 'metric'],
  subscribers: ['subscribers', '', 'subscriber'], deliveries: ['deliveries', '', 'delivery'],
};

export function withNativeTarget(tool: ToolDefinition, resources: ResourceDefinition[]): ToolDefinition {
  const spec = records[tool.name.split('.')[1]!];
  if (!spec || !Object.hasOwn(tool.inputSchema.properties ?? {}, 'id')) return tool;
  const [collection, field, kind] = spec;
  const resource = resources.find(item => item.uriTemplate === `lamp://${collection}/{id}`);
  if (!resource) return tool;
  return { ...tool, async target(args, ctx) {
    if (typeof args.id !== 'string') return null;
    const record = await resource.read(`lamp://${collection}/${encodeURIComponent(args.id)}`, { ...ctx, scopes: [...ctx.scopes] });
    const json = record?.json as Record<string, unknown> | undefined;
    const native = (field ? json?.[field] : json) as { id?: unknown } | undefined;
    return typeof native?.id === 'string' ? { kind, id: native.id } : null;
  } };
}
