import { createApp } from '../../src/core/app/server';
import { prepareAppMailBindings } from '../../src/core/app/mail';
import { runScheduled } from '../../src/core/app/worker-lifecycle';
import type { AppBindings } from '../../src/core/app/types';
export { SnapshotCache } from '../../src/core/platform/blobs/snapshot-cache';

// The same Hono and Cron entry points served by the product. A test-owned HTTP
// trigger delivers Cron deterministically; all business mutations use its routes.
export default {
  async fetch(input: Request, env: AppBindings, context: ExecutionContext) {
    const request = new Request(input);
    request.headers.set('Host', new URL(request.url).host);
    const bindings = await prepareAppMailBindings(env);
    if (new URL(request.url).pathname === '/__test/tick') {
      const pending: Promise<unknown>[] = [];
      await runScheduled(bindings, { waitUntil(promise: Promise<unknown>) { pending.push(promise); }, passThroughOnException() {} } as ExecutionContext);
      const outcomes = await Promise.allSettled(pending);
      return new Response(null, { status: outcomes.every(row => row.status === 'fulfilled') ? 204 : 503 });
    }
    return createApp(bindings, request).app.fetch(request, bindings, context);
  },
};
