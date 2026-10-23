import { fields, states } from '../form';
import type { ComponentView } from '../../components/service';
import type { createDesk } from '../desk';
type Result = Awaited<ReturnType<ReturnType<typeof createDesk>>>;
export function slackResult(result: Result) {
  const text = 'preview' in result && result.preview ? [result.preview.public.heading, ...result.preview.public.fields.map(field => `${field.label}: ${field.value}`), ...result.findings.map(finding => finding.message)].join('\n') : result.message ?? 'Draft updated.';
  return { response_type: 'ephemeral', text, blocks: [
    { type: 'section', text: { type: 'plain_text', text: text.slice(0, 3000) } },
    ...('editor' in result && result.editor ? editorBlocks(result) : []),
    ...('publish' in result && result.publish ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Publish update' }, action_id: 'lamp', value: JSON.stringify(result.publish) }] }] : []),
    ...('version' in result && result.version && !('publish' in result) ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Preview update' }, action_id: 'lamp', value: JSON.stringify({ action: 'preview', incidentId: result.incidentId, version: result.version }) }] }] : []),
  ] };
}
export function slackComposer(components: ComponentView[]) {
  if (!components.length) return { response_type: 'ephemeral', text: 'Add a component in the operator app before opening an incident.' };
  const input = (id: string, label: string) => ({ type: 'input', block_id: id, label: { type: 'plain_text', text: label }, element: { type: 'plain_text_input', action_id: id } });
  return { response_type: 'ephemeral', text: 'Open an incident draft', blocks: [
    input('title', 'Incident title'), select('state', 'Component state', states, 'Degraded performance'), input('affectedAudience', 'Affected audience'), input('customerImpact', 'Customer impact'), input('nextUpdateAt', 'Next update time'),
    { type: 'input', block_id: 'components', label: { type: 'plain_text', text: 'Affected components' }, element: { type: 'multi_static_select', action_id: 'components', options: components.slice(0, 100).map(component => ({ text: { type: 'plain_text', text: component.name.slice(0, 75) }, value: component.id })) } },
    { type: 'actions', elements: [{ type: 'button', action_id: 'lamp-open', text: { type: 'plain_text', text: 'Open draft' }, value: 'open' }] },
  ] };
}

function editorBlocks(result: Result) {
  if (!('editor' in result) || !result.editor) return [];
  const { update, components } = result.editor;
  return [
    ...fields.map(([id, label]) => ({ type: 'input', block_id: id, optional: true, label: { type: 'plain_text', text: label }, element: { type: 'plain_text_input', action_id: id, ...(update[id] ? { initial_value: update[id] } : {}) } })),
    select('lifecycle', 'Incident state', ['Investigating', 'Identified', 'Monitoring', 'Resolved'], update.lifecycle),
    ...components.slice(0, 30).map(component => select(`component_${component.id}`, component.name, ['', ...states], component.state ?? '')),
    { type: 'actions', elements: [{ type: 'button', action_id: 'lamp-save', text: { type: 'plain_text', text: 'Save draft' }, value: JSON.stringify({ action: 'save', incidentId: result.incidentId, version: result.version }) }, { type: 'button', action_id: 'lamp', text: { type: 'plain_text', text: 'Review draft' }, value: JSON.stringify({ action: 'review', incidentId: result.incidentId, version: result.version }) }] },
  ];
}
function select(id: string, label: string, values: readonly string[], current: string) {
  const option = (value: string) => ({ text: { type: 'plain_text', text: value || 'Not attached' }, value: value || 'not-attached' });
  return { type: 'input', block_id: id, label: { type: 'plain_text', text: label.slice(0, 100) }, element: { type: 'static_select', action_id: id, initial_option: option(current), options: values.map(option) } };
}
