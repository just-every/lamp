/** Test-only provider boundaries. Every unlisted operation fails closed. */
export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.origin === 'https://agent-model.example.invalid' && url.pathname === '/v1/chat/completions' && request.method === 'POST') {
    const input = await request.json();
    if (input.messages?.some(message => String(message.content).includes('PRIVATE-DO-NOT-DISCLOSE'))) return new Response('Private note crossed provider boundary', { status: 400 });
    const field = text => ({ text, sources: [] });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ affectedAudience: field('API customers'), customerImpact: field('Some API requests are delayed.'), whatStillWorks: field('The dashboard remains available.'), details: field('The responder team is investigating the reported delay.') }) } }] });
  }
  if (url.origin === 'https://hooks.slack.com' && url.pathname.startsWith('/services/') && request.method === 'POST') {
    const input = await request.json();
    if (!Array.isArray(input.blocks)) return new Response('invalid_payload', { status: 400 });
    return new Response('ok');
  }
  return new Response('Undeclared provider operation', { status: 502 });
} };
