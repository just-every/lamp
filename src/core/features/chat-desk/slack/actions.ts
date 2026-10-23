import { responseUrl } from './response';
import { formAction } from '../form';
import { z } from 'zod';
const identity = z.object({ team: z.object({ id: z.string().min(1).max(200) }), user: z.object({ id: z.string().min(1).max(200) }) });
export function slackAction(raw: string) {
  const form = new URLSearchParams(raw), encoded = form.get('payload');
  if (!encoded) {
    const team = form.get('team_id'), user = form.get('user_id');
    if (!team || !user || form.get('command') !== '/lamp') throw new Error('Use the Lamp command in your linked workspace.');
    const text = (form.get('text') ?? '').trim();
    return { replyUrl: responseUrl(form.get('response_url') ?? undefined), identity: { transport: 'slack' as const, tenant: team, subject: user }, link: text.startsWith('link ') ? text.slice(5).trim() : undefined, compose: text === 'incident', action: text.startsWith('incident ') ? { action: 'edit', incidentId: text.slice(9).trim() } : undefined };
  }
  const payload = JSON.parse(encoded), linked = identity.parse(payload);
  if (payload.type !== 'block_actions' || !Array.isArray(payload.actions) || payload.actions.length !== 1) throw new Error('Choose one Lamp action.');
  const selected = payload.actions[0];
  let action: unknown;
  if (selected.action_id === 'lamp-open' || selected.action_id === 'lamp-save') {
    const blocks = payload.state?.values ?? {}, values: Record<string, unknown> = {};
    for (const [id, block] of Object.entries(blocks)) {
      const control = (block as Record<string, { value?: string; selected_option?: { value: string }; selected_options?: Array<{ value: string }> }>)[id];
      values[id] = control?.selected_options?.map(item => item.value) ?? control?.selected_option?.value ?? control?.value ?? '';
    }
    action = formAction(selected.action_id === 'lamp-open' ? { action: 'open' } : JSON.parse(selected.value), values);
  } else if (selected.action_id === 'lamp') action = JSON.parse(selected.value);
  else throw new Error('Unknown Lamp action.');
  return { replyUrl: responseUrl(payload.response_url), identity: { transport: 'slack' as const, tenant: linked.team.id, subject: linked.user.id }, action, compose: false, link: undefined };
}
