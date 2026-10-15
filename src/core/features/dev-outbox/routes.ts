import { canUseDevelopmentMail, type DevelopmentMailBindings } from './access';
import { createDevOutboxRepository, type CapturedEnvelope } from './repository';

export const DEV_OUTBOX_PATH = '/__dev/outbox';
const headers = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Development serves two loopback hosts on one port: the app host (sign-in,
 * operator app) and the page host (status page, subscriber links). The outbox
 * answers on both, so its links name each surface's own origin. */
type SurfaceOrigins = { app: string; page: string };
// The page keeps no-referrer; its links to the two surfaces send only this
// outbox's origin, which the development ingress requires to admit a
// navigation between the two loopback hosts (distinct sites on one port).

function surfaceOrigins(requestUrl: URL, bindings: DevelopmentMailBindings): SurfaceOrigins {
  const at = (hostname: string) => { const url = new URL(requestUrl.origin); url.hostname = hostname; return url.origin; };
  return { app: at(bindings.LAMP_APP_HOST), page: at(bindings.LAMP_PAGE_HOST) };
}

function document(title: string, body: string, origins: SurfaceOrigins, pageName: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Lamp</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:24px auto;padding:0 20px;max-width:900px;color:#18334d;background:#fafcff}a{color:#154a85;overflow-wrap:anywhere}article{border-top:1px solid #c9d4df;padding:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf2f7;padding:16px}h1{line-height:1.2}dt{font-weight:bold}dd{margin:0 0 8px;overflow-wrap:anywhere}</style></head><body><main><a href="${escapeHtml(`${origins.page}/`)}" referrerpolicy="origin">${escapeHtml(pageName)}</a> · <a href="${escapeHtml(`${origins.app}/signin`)}" referrerpolicy="origin">Sign in</a><h1>${escapeHtml(title)}</h1><p>Captured locally. These messages have not been sent to a mail provider or delivered to a recipient.</p>${body}</main></body></html>`, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

function envelopeView(envelope: CapturedEnvelope, origins: SurfaceOrigins): string {
  const message = envelope.message;
  // Never execute captured HTML. Offer only links from plain text on this
  // runtime's two configured loopback origins; a hostile envelope cannot turn
  // this privileged local page into an open URL.
  const links = [...new Set(message.text.match(/https?:\/\/[^\s<>]+/g) ?? [])].filter(value => {
    try { const url = new URL(value); return (url.origin === origins.app || url.origin === origins.page) && !url.username && !url.password; } catch { return false; }
  });
  return `<article><h2>${escapeHtml(message.subject)}</h2><dl><dt>To</dt><dd>${escapeHtml(message.to)}</dd><dt>From</dt><dd>${escapeHtml(message.from)}</dd><dt>Captured</dt><dd>${escapeHtml(envelope.capturedAt)}</dd></dl><pre>${escapeHtml(message.text)}</pre>${links.map(link => `<p><a href="${escapeHtml(link)}" referrerpolicy="origin">${escapeHtml(link)}</a></p>`).join('')}<details><summary>Envelope headers and HTML source</summary><pre>${escapeHtml(JSON.stringify(message.headers, null, 2))}</pre>${message.html ? `<pre>${escapeHtml(message.html)}</pre>` : ''}</details></article>`;
}

/** Returns null for unrelated routes; rejects every outbox path before storage
 * access unless both the build and the actual request qualify as local dev. */
export async function handleDevOutboxRequest(request: Request, bindings: DevelopmentMailBindings, getPageName: () => Promise<string> = async () => "Status page"): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== DEV_OUTBOX_PATH && !url.pathname.startsWith(`${DEV_OUTBOX_PATH}/`)) return null;
  const notFound = () => new Response('Not found.', { status: 404, headers });
  // A development server started without local mail capture (plain `vite`)
  // has no outbox. Say how to start one instead of a bare 404.
  if (import.meta.env?.DEV === true && !bindings.LAMP_DEV_OUTBOX) return new Response('No development outbox in this server: mail is captured only under rer dev (which runs scripts/dev.mjs with LAMP_DEV_OUTBOX_MODE=local).', { status: 404, headers });
  if (!canUseDevelopmentMail(bindings, request) || request.method !== 'GET') return notFound();
  const repository = createDevOutboxRepository(bindings.LAMP_DEV_OUTBOX!, bindings.LAMP_BASE_MAIL);
  const origins = surfaceOrigins(url, bindings);
  const json = url.searchParams.get('format') === 'json';
  if (url.pathname !== DEV_OUTBOX_PATH) {
    const envelope = await repository.get(url.pathname.slice(DEV_OUTBOX_PATH.length + 1));
    if (!envelope) return notFound();
    return json ? Response.json(envelope, { headers }) : document('Development outbox', `<a href="${DEV_OUTBOX_PATH}">All captured messages</a>${envelopeView(envelope, origins)}`, origins, await getPageName());
  }
  const result = await repository.list();
  if (json) return Response.json(result, { headers });
  const items = result.envelopes.map(envelope => `<article><a href="${DEV_OUTBOX_PATH}/${envelope.id}">${escapeHtml(envelope.message.subject)}</a><p>To ${escapeHtml(envelope.message.to)} · ${escapeHtml(envelope.capturedAt)}</p></article>`).join('');
  return document('Development outbox', `${items || '<p>No messages captured yet.</p>'}`, origins, await getPageName());
}
