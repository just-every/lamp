/** Test-only external edge. This module receives no app bindings or network access. */
const requireShape = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const denied = () => new Response('No declared Lamp provider edge matches this request.', { status: 502 });
const jsonBody = async request => {
  requireShape(request.method === 'POST', 'Provider operation must use POST');
  requireShape(request.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'Provider operation must carry JSON');
  const body = await request.json();
  requireShape(object(body), 'Provider operation requires a JSON object');
  return body;
};

export default {
  async fetch(request, fixture = {}) {
    const url = new URL(request.url);
    if (url.origin === 'https://api.datadoghq.com' && url.pathname === '/api/v1/query') {
      requireShape(request.method === 'GET' && request.headers.has('DD-API-KEY') && request.headers.has('DD-APPLICATION-KEY'), 'Metric query requires native read-only provider credentials');
      requireShape(url.searchParams.get('query') === 'avg:synthetic.lamp.latency{*}.fill(null)', 'Metric query must preserve native no-fill aggregation');
      const from = Number(url.searchParams.get('from')), to = Number(url.searchParams.get('to'));
      requireShape(Number.isSafeInteger(from) && Number.isSafeInteger(to) && to - from === 3600, 'Metric query requires its native one-hour window');
      return Response.json({status: 'ok', series: [{interval: 60, pointlist: [[(to - 60) * 1000, 321]]}]});
    }
    if (url.origin === 'https://lamp-agent-provider.invalid' && url.pathname === '/v1/chat/completions') {
      const body = await jsonBody(request);
      requireShape(request.headers.get('authorization')?.startsWith('Bearer '), 'Configured AI provider credential is required');
      requireShape(typeof body.model === 'string' && body.model.length > 0, 'AI model must be explicit');
      requireShape(body.response_format?.type === 'json_object' && body.messages?.length === 2, 'AI request must retain the native structured contract');
      requireShape(body.messages[0]?.role === 'system' && body.messages[1]?.role === 'user', 'AI request must preserve instruction and evidence roles');
      const evidence = JSON.parse(body.messages[1].content);
      requireShape(object(evidence) && !Object.hasOwn(evidence, 'internalNotes'), 'Private notes must not enter AI evidence');
      const suggestion = fixture.suggestion ?? {
        affectedAudience: { text: 'Customers using the API', sources: [] },
        customerImpact: { text: 'Requests may fail while the team investigates.', sources: [] },
        whatStillWorks: { text: 'The dashboard remains available.', sources: [] },
        details: { text: 'The next update will follow the saved incident commitment.', sources: [] },
      };
      return Response.json({ choices: [{ message: { content: JSON.stringify(suggestion) } }] });
    }
    if (url.origin === 'https://hooks.slack.com' && /^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      const body = await jsonBody(request);
      requireShape(typeof body.text === 'string' && Array.isArray(body.blocks), 'Slack must receive the native rich-text message');
      requireShape(body.blocks.every(block => ['rich_text', 'section', 'context', 'divider'].includes(block.type)), 'Slack message contains an unexpected block');
      return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.origin === 'https://lamp-agent-conformance.logic.azure.com' && url.pathname === '/workflows/lamp/triggers/manual/paths/invoke') {
      const body = await jsonBody(request);
      requireShape(body.type === 'message' && Array.isArray(body.attachments) && body.attachments.length === 1, 'Teams requires one native message card');
      requireShape(body.attachments[0]?.contentType === 'application/vnd.microsoft.card.adaptive' && body.attachments[0].content?.type === 'AdaptiveCard', 'Teams must receive an Adaptive Card');
      return new Response('1', { headers: { 'Content-Type': 'text/plain' } });
    }
    if (url.origin === 'https://api.x.com' && url.pathname === '/2/tweets') {
      const body = await jsonBody(request);
      requireShape(request.headers.get('authorization')?.startsWith('Bearer '), 'X requires the native account credential');
      requireShape(typeof body.text === 'string' && body.text.length > 0, 'X requires the frozen public text');
      return Response.json({ data: { id: crypto.randomUUID().replaceAll('-', '') } }, { status: 201 });
    }
    if (url.origin === 'https://bsky.social' && url.pathname === '/xrpc/com.atproto.server.createSession') {
      const body = await jsonBody(request);
      requireShape(typeof body.identifier === 'string' && typeof body.password === 'string', 'Bluesky requires configured native account credentials');
      return Response.json({ accessJwt: 'synthetic-lamp-provider-session', did: 'did:plc:syntheticlamp' });
    }
    if (url.origin === 'https://bsky.social' && url.pathname === '/xrpc/com.atproto.repo.createRecord') {
      const body = await jsonBody(request);
      requireShape(request.headers.get('authorization') === 'Bearer synthetic-lamp-provider-session', 'Bluesky post must use the provider session');
      requireShape(body.collection === 'app.bsky.feed.post' && body.record?.$type === 'app.bsky.feed.post' && typeof body.record.text === 'string', 'Bluesky requires the frozen native record');
      requireShape(typeof body.rkey === 'string' && body.rkey.length > 0, 'Bluesky record must preserve its durable key');
      return Response.json({ uri: `at://did:plc:syntheticlamp/app.bsky.feed.post/${body.rkey}`, cid: 'syntheticlampcid' });
    }
    if (url.origin === 'https://mastodon.social' && url.pathname === '/api/v1/statuses') {
      const body = await jsonBody(request);
      requireShape(request.headers.get('authorization')?.startsWith('Bearer '), 'Mastodon requires configured native account authority');
      requireShape(body.visibility === 'public' && typeof body.status === 'string', 'Mastodon must receive the frozen public status');
      return Response.json({ id: crypto.randomUUID().replaceAll('-', '') });
    }
    return denied();
  },
};
