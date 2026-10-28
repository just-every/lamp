import { createServerFn } from '@tanstack/react-start';
import { redirect } from '@tanstack/react-router';
import { Hono, type Context, type Next } from 'hono';
import { createOperatorAuth, createAuthHandler, type AuthConfig, type Database, type MailSender, type Session } from '../../index.mjs';
import { registerOperatorAuthConformance, type ConformanceTestRegistrar, type OperatorAuthConformanceAdapter } from '../index.mjs';

declare const test: ConformanceTestRegistrar;
declare const adapter: OperatorAuthConformanceAdapter;
declare const db: Database;
declare const sender: MailSender;
declare const config: AuthConfig;
declare const start: { fetch(request: Request): Promise<Response> };
declare function getRequestHeader(name: string): string | undefined;

registerOperatorAuthConformance({ test, adapter });

const auth = createOperatorAuth({ db, config, mailSender: sender, clientIp: request => request.headers.get('CF-Connecting-IP') ?? '' });
const handler = createAuthHandler(auth);
type WorkerBindings = { DB: Database; OWNER_EMAIL: string; SESSION_SECRET: string; SETUP_TOKEN?: string };
const app = new Hono<{ Bindings: WorkerBindings; Variables: { operatorSession: Session } }>();
app.all('/auth/*', async context => await handler(context.req.raw) ?? context.notFound());
const protectPrivate = async (context: Context<{ Variables: { operatorSession: Session } }>, next: Next) => {
  const session = await auth.getSession(context.req.raw);
  if (!session) return context.json({ error: 'unauthenticated' }, 401);
  context.set('operatorSession', session);
  await next();
};
app.use('/api/private', protectPrivate);
app.use('/api/private/*', protectPrivate);
app.get('/api/private/profile', context => {
  const session = context.get('operatorSession');
  return context.json({ operator: { id: session.operator.id, role: session.operator.role } });
});

export function dispatchWorker(request: Request, bindings: WorkerBindings, execution: ExecutionContext) {
  const path = new URL(request.url).pathname;
  return path === '/auth' || path.startsWith('/auth/') || path === '/api/private' || path.startsWith('/api/private/')
    ? app.fetch(request, bindings, execution)
    : start.fetch(request);
}

export const requireOperator = createServerFn({ method: 'GET' }).handler(async () => {
  const cookie = getRequestHeader('cookie') ?? '';
  const host = getRequestHeader('host');
  const headers = new Headers({ cookie });
  if (host) headers.set('host', host);
  const session = await auth.getSession(new Request('https://app.example.com/', { headers }));
  if (!session) throw redirect({ to: '/signin' });
  return { id: session.operator.id, role: session.operator.role };
});

void app;
