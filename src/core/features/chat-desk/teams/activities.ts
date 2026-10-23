import { formAction } from '../form';
import { z } from 'zod';
const activitySchema = z.object({ channelId: z.literal('msteams'), from: z.object({ aadObjectId: z.string().min(1).max(200) }), channelData: z.object({ tenant: z.object({ id: z.string().min(1).max(200) }) }), type: z.enum(['message', 'invoke']), name: z.string().optional(), text: z.string().optional(), value: z.unknown().optional(), serviceUrl: z.string().url() });
export function teamsActivity(body: unknown, claims: Record<string, unknown>) {
  const activity = activitySchema.parse(body);
  if (claims.serviceurl !== undefined && claims.serviceurl !== activity.serviceUrl) throw new Error('The activity service does not match its token.');
  const identity = { transport: 'teams' as const, tenant: activity.channelData.tenant.id, subject: activity.from.aadObjectId };
  if (activity.type === 'message') {
    const text = (activity.text ?? '').trim();
    return { identity, link: text.startsWith('link ') ? text.slice(5).trim() : undefined, action: undefined };
  }
  const value = z.record(z.string(), z.unknown()).parse(activity.value);
  if (activity.name === 'adaptiveCard/action') {
    const action = z.object({ type: z.literal('Action.Execute'), verb: z.literal('lamp'), data: z.unknown() }).parse(value.action);
    const data = z.record(z.string(), z.unknown()).parse(action.data);
    return { identity, action: data.form ? formAction(data, data) : data, link: undefined };
  }
  if (activity.name === 'composeExtension/fetchTask' && value.commandId === 'incident') return { identity, compose: true, action: undefined, link: undefined };
  if (activity.name === 'composeExtension/submitAction' && value.commandId === 'incident') {
    const parameters = z.array(z.object({ name: z.string(), value: z.unknown() })).parse(value.parameters);
    const data = Object.fromEntries(parameters.map(parameter => [parameter.name, parameter.value]));
    return { identity, extension: true, action: typeof data.components === 'string' ? formAction({ action: 'open' }, data) : { ...data, action: 'open' }, link: undefined };
  }
  throw new Error('Choose a Lamp incident command or card action.');
}
