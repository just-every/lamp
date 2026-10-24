import type { ComponentView } from '../../components/service';
import { fields, states } from '../form';
import type { createDesk } from '../desk';
type Result = Awaited<ReturnType<ReturnType<typeof createDesk>>>;
export function teamsCard(result: Result) {
  const preview = 'preview' in result ? result.preview : undefined;
  const card = { type: 'AdaptiveCard', version: '1.5', body: [
    { type: 'TextBlock', text: preview?.public.heading ?? ('message' in result ? result.message : 'Incident draft'), wrap: true, weight: 'Bolder' },
    ...(preview ? [{ type: 'TextBlock', text: `Status: ${preview.public.lifecycle}`, wrap: true }] : []),
    ...(preview?.public.fields.map(field => ({ type: 'TextBlock', text: `${field.label}: ${field.value}`, wrap: true })) ?? []),
    ...(preview ? [{ type: 'TextBlock', text: `Email subject: ${preview.email.subject}`, wrap: true }, { type: 'TextBlock', text: preview.email.plainText, wrap: true }] : []),
    ...('findings' in result ? (result.findings ?? []).map(finding => ({ type: 'TextBlock', text: finding.message, wrap: true })) : []),
    ...('editor' in result && result.editor ? editorInputs(result.editor) : []),
  ], actions: 'publish' in result && result.publish ? [{ type: 'Action.Execute', title: 'Publish update', associatedInputs: 'none', verb: 'lamp', data: result.publish }]
    : 'version' in result && result.version ? [{ type: 'Action.Execute', title: 'Save draft', verb: 'lamp', data: { action: 'save', form: true, incidentId: result.incidentId, version: result.version } }, { type: 'Action.Execute', title: 'Review draft', verb: 'lamp', associatedInputs: 'none', data: { action: 'review', incidentId: result.incidentId, version: result.version } }, { type: 'Action.Execute', title: 'Preview update', associatedInputs: 'none', verb: 'lamp', data: { action: 'preview', incidentId: result.incidentId, version: result.version } }] : [] };
  return { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card };
}

function editorInputs(editor: NonNullable<Extract<Result, { editor: unknown }>['editor']>) {
  return [
    ...fields.map(([id, label]) => ({ type: 'Input.Text', id, label, value: editor.update[id] ?? '' })),
    { type: 'Input.ChoiceSet', id: 'lifecycle', label: 'Incident state', value: editor.update.lifecycle, choices: ['Investigating', 'Identified', 'Monitoring', 'Resolved'].map(value => ({ title: value, value })) },
    ...editor.components.map(component => ({ type: 'Input.ChoiceSet', id: `component_${component.id}`, label: component.name, value: component.state ?? 'not-attached', choices: [{ title: 'Not attached', value: 'not-attached' }, ...states.map(value => ({ title: value, value }))] })),
  ];
}
export function teamsComposer(components: ComponentView[]) {
  return { task: { type: 'continue', value: { title: 'Open incident', card: { contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.5', body: [
    { type: 'Input.Text', id: 'title', label: 'Incident title' },
    ...fields.map(([id, label]) => ({ type: 'Input.Text', id, label })),
    { type: 'Input.ChoiceSet', id: 'components', label: 'Affected components', isMultiSelect: true, choices: components.map(component => ({ title: component.name, value: component.id })) },
    { type: 'Input.ChoiceSet', id: 'state', label: 'Component state', value: 'Degraded performance', choices: states.map(value => ({ title: value, value })) },
  ], actions: [{ type: 'Action.Submit', title: 'Open draft', data: {} }] } } } } };
}
