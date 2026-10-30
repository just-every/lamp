export const QUEUE_ORIGIN = 'https://lamp-agent-queue.example.invalid';

/** Network edge only: native outbox, Queue admission and provider attempts all
 * run in Lamp. The fixture can recover one exact synthetic destination. */
export function queueProvider(request, fixture) {
  const url = new URL(request.url);
  if (url.origin !== QUEUE_ORIGIN) return null;
  if (request.method !== 'POST' || !url.pathname.startsWith('/synthetic-lamp-')) return new Response(null, { status: 404 });
  return new Response(null, { status: fixture?.healthy?.includes(url.pathname) ? 204 : 503 });
}
