import { z } from 'zod';
import { postResponse } from './slack/response';
import type { Hono } from 'hono';
import type { AppEnv } from '../../app/types';
import { ulidSchema } from '../../shared/ids';
import type { createChatDeskService } from './service';
import { actionSchema } from './actions';
import { digest } from './links.service';
import { verifySlack } from './slack/verify';
import { slackAction } from './slack/actions';
import { slackComposer, slackResult } from './slack/blocks';
import { verifyTeams } from './teams/verify';
import { teamsActivity } from './teams/activities';
import { teamsCard, teamsComposer } from './teams/cards';
import type { ComponentsService } from '../components/service';
async function body(request: Request) {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65_536) throw new Error('The chat request is too large.'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function registerChatDeskRoutes(app: Hono<AppEnv>, service: ReturnType<typeof createChatDeskService>, components: ComponentsService) {
  app.get('/api/app/chat-links', async c => { c.header('Cache-Control', 'no-store'); return c.json({ links: await service.links.list(c.get('operator').id) }); });
  app.post('/api/app/chat-links', async c => { if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'An empty link-code request is required.' }, 400); c.header('Cache-Control', 'no-store'); return c.json(await service.links.mint(c.get('operator').id), 201); });
  app.delete('/api/app/chat-links/:id', async c => {
    const id = ulidSchema.safeParse(c.req.param('id')); if (!id.success) return c.json({ error: 'Invalid link identifier.' }, 400);
    return await service.links.remove(id.data, c.get('operator').id) ? c.body(null, 204) : c.json({ error: 'Chat link not found.' }, 404);
  });
  for (const transport of ['slack', 'teams'] as const) app.post(`/api/chat/${transport}`, async c => {
    c.header('Cache-Control', 'no-store');
    if (service.paused) return c.json({ error: 'Chat actions are paused during this move.' }, 503);
    const secret = transport === 'slack' ? service.config.SLACK_SIGNING_SECRET : service.config.BOT_FRAMEWORK_APP_ID;
    if (!secret) return c.json({ error: transport === 'slack' ? 'Slack signing is not configured.' : 'The Teams bot is not configured.' }, 503);
    let raw: string;
    try { raw = await body(c.req.raw); } catch { return c.json({ error: 'A bounded UTF-8 chat request is required.' }, 400); }
    const claims = transport === 'teams' ? await verifyTeams(c.req.header('Authorization') ?? null, secret) : null;
    if (transport === 'slack' ? !await verifySlack(raw, c.req.raw.headers, secret) : !claims) return c.json({ error: 'The chat request could not be authenticated.' }, 401);
    try {
      const input = transport === 'slack' ? slackAction(raw) : teamsActivity(JSON.parse(raw), claims!);
      if (input.link) return c.json(await service.links.link(input.link, input.identity));
      const operator = await service.repository.resolve(input.identity);
      if (!operator) return c.json({ error: 'Link this chat identity using a one-time code from the operator app.' }, 403);
      if ('compose' in input && input.compose) return c.json(transport === 'slack' ? slackComposer(await components.list()) : teamsComposer(await components.list()));
      const action = actionSchema.safeParse(input.action);
      if (!action.success) return c.json({ error: 'A complete Lamp action with valid update fields and component states is required.' }, 400);
      const requestKey = await digest(`${transport}:${input.identity.tenant}:${input.identity.subject}:${raw}`);
      if (!await service.repository.claimRequest(requestKey, Date.now())) return c.json({ error: 'This chat action was already received. Open the current incident to see its result.' }, 409);
      const result = await service.act(action.data, operator);
      if (transport === 'slack' && 'replyUrl' in input && input.replyUrl) await postResponse(input.replyUrl, slackResult(result));
      return c.json(transport === 'slack' ? { ...slackResult(result), result } : { ...teamsCard(result), result });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'The chat action could not be completed.' }, 409);
    }
  });
}
