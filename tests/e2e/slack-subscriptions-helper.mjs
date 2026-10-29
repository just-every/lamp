import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

export const recordedSlackExchange=JSON.parse(readFileSync(new URL('../fixtures/slack-subscriptions/oauth-exchange.json',import.meta.url),'utf8'));
export const recordedSlackEvents=JSON.parse(readFileSync(new URL('../fixtures/slack-subscriptions/events.json',import.meta.url),'utf8'));
export const recordedSlackOAuth=recordedSlackExchange.response;
export const RECORDED_SLACK_WEBHOOK=recordedSlackOAuth.incoming_webhook.url;
export const RECORDED_SLACK_TEAM=recordedSlackOAuth.team.id;

/** Public subscription form, visitor-approved OAuth continuation and callback.
 * Only the enclosing fixture's recorded Slack HTTP exchange is substituted. */
export async function prepareSlackSubscription({componentId,publicOrigin,sql,onManage}) {
  const page = await fetch(publicOrigin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<form[^>]+action="\/subscribe\/slack"/);
  assert.equal(page.headers.get('set-cookie'), null, 'the public subscription page stores no visitor cookie');
  const start = await fetch(`${publicOrigin}/subscribe/slack`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '192.0.2.14' },
    body: new URLSearchParams({ componentId }),
  });
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('set-cookie'), null, 'the public Slack door stores no visitor cookie');
  const href = (await start.text()).match(/href="(https:\/\/slack\.com\/oauth\/v2\/authorize[^"]+)"/)[1].replaceAll('&amp;', '&');
  const authorization = new URL(href);
  assert.equal(authorization.origin, 'https://slack.com');
  assert.equal(authorization.pathname, '/oauth/v2/authorize');
  assert.equal(authorization.searchParams.get('scope'), 'incoming-webhook', 'the visitor authorizes only channel publication');
  const callback = new URL('/subscribe/slack/callback', publicOrigin);
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  callback.searchParams.set('code', recordedSlackExchange.request.code);
  const confirmed = await fetch(callback, { redirect: 'manual' });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal(confirmed.headers.get('set-cookie'), null, 'hashed OAuth state works without a visitor cookie');
  const management = (await confirmed.text()).match(/href="(\/manage\/[^"]+)"/);
  assert.ok(management, 'the channel visitor receives a management link after authorization');
  if (onManage) await onManage(new URL(management[1], publicOrigin).href);
  const row=(await sql("SELECT s.id,s.channel,s.state,s.destination,d.sealed_url,t.slack_team_id FROM subscriber_directory s JOIN subscriber_chat_destinations t ON t.subscriber_id=s.id JOIN delivery_channel_destinations d ON d.id=s.id WHERE s.channel='slack'"))[0];
  assert.equal(row.channel,'slack');assert.equal(row.state,'active');assert.equal(row.slack_team_id,RECORDED_SLACK_TEAM);
  assert.doesNotMatch(JSON.stringify(row),/synthetic-lamp-3/,'webhook is only stored encrypted');
  return row.id;
}
export function verifySlackPublication({received}){
  const delivered=received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname);
  assert.equal(delivered.length,1);
  assert.match(JSON.parse(delivered[0].body).text,/See <https:\/\/help\.example\.com\/kb\/123>\./);
}
export async function removeSlackSubscription({publicOrigin,signingSecret,id,sql,eventType='app_uninstalled'}){
  assert.ok(Object.hasOwn(recordedSlackEvents.payloads,eventType),'the signed event has a recorded provider-edge payload');
  const envelope=recordedSlackEvents.payloads[eventType];
  assert.equal(envelope.team_id,RECORDED_SLACK_TEAM);
  const raw=JSON.stringify(envelope),timestamp=String(Math.floor(Date.now()/1000));
  const signature='v0='+createHmac('sha256',signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex');
  const response=await fetch(`${publicOrigin}/subscribe/slack/events`,{method:'POST',headers:{'content-type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':signature},body:raw});
  assert.equal(response.status,200,await response.text());
  assert.deepEqual(await sql(`SELECT state,deactivation_reason FROM subscriber_directory AS subscribers WHERE id='${id}'`),[{state:'deactivated',deactivation_reason:eventType}]);
}
