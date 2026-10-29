import type { D1Database } from '../../../node_modules/.pnpm/@cloudflare+workers-types@5.20260908.1/node_modules/@cloudflare/workers-types/index.js';
import { createOperatorAuth, type MailSender, type OperatorAuth } from '../index.mjs';
declare const db: D1Database;
declare const sender: MailSender;
const auth: OperatorAuth = createOperatorAuth({ db, mailSender: sender, config: { origin: 'https://example.com', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'opaque', branding: { productName: 'Example', accentColor: '#336699', signInPath: '/signin', mark: '/brand/mark.svg' } }, clientIp: () => '192.0.2.1' });
void auth;

const presentation: Readonly<{ productName: string; accentColor: string; signInPath: string }> = auth.presentation;
void presentation;
const preview = await auth.previewLink(new Request('https://example.com/auth/confirm'), null);
if (preview) { const minutes: number = preview.expiresInMinutes; void minutes; }
// @ts-expect-error presentation is immutable
auth.presentation.productName = 'Changed';
// @ts-expect-error optional branding fields retain strict types
createOperatorAuth({ db, config: { origin: 'https://example.com', OWNER_EMAIL: 'owner@example.com', SESSION_SECRET: 'opaque', branding: { accentColor: 3 } }, clientIp: () => '192.0.2.1' });
