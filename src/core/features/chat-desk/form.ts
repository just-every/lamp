import { INCIDENT_CLAIM_STATES } from '../../shared/incident-component-changes';
export const fields = [['affectedAudience', 'Affected audience'], ['customerImpact', 'Customer impact'], ['whatStillWorks', 'What still works'], ['details', 'Additional details'], ['nextUpdateAt', 'Next update time']] as const;
export const states = INCIDENT_CLAIM_STATES;
/** Translate chat form controls only; the shared action schema validates every value. */
export function formAction(base: Record<string, unknown>, values: Record<string, unknown>) {
  const update: Record<string, unknown> = { lifecycle: values.lifecycle ?? 'Investigating', ...Object.fromEntries(fields.map(([id]) => [id, values[id] ?? ''])) };
  update.nextUpdateAt ||= null;
  if (base.action === 'open') {
    const selected = typeof values.components === 'string' ? values.components.split(',').filter(Boolean) : values.components;
    return { action: 'open', title: values.title, components: Array.isArray(selected) ? selected.map(componentId => ({ componentId, state: values.state, relationship: 'Primary' })) : [], update };
  }
  update.componentChanges = Object.entries(values).filter(([name, value]) => name.startsWith('component_') && value !== '' && value !== 'not-attached').map(([name, state]) => ({ componentId: name.slice(10), state }));
  return { action: 'save', incidentId: base.incidentId, version: base.version, update };
}
