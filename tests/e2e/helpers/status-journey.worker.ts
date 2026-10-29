import worker from './follow-ups-worker';
import { lampServerExtensions } from '../../../src/ext/index.server';
export { SnapshotCache } from '../../../src/core/platform/blobs/snapshot-cache';
let paused = false;
const executionBindings = (env: Parameters<typeof worker.fetch>[1]) => paused ? { ...env, EFFECTS_PAUSED: '1' } : env;
export default {
  ...worker,
  queue(batch: Parameters<typeof worker.queue>[0], env: Parameters<typeof worker.queue>[1]) {
    return worker.queue(batch, executionBindings(env));
  },
  scheduled(controller: ScheduledController, env: Parameters<typeof worker.fetch>[1], context: ExecutionContext) {
    return worker.scheduled(controller, executionBindings(env), context);
  },
  async fetch(request: Request, env: Parameters<typeof worker.fetch>[1], context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.hostname === env.LAMP_APP_HOST && url.pathname === '/test/effects' && request.method === 'PUT') {
      paused = (await request.json<{ paused: boolean }>()).paused;
      return new Response(null, { status: 204 });
    }
    Object.assign(lampServerExtensions.policies, {
      'update.review.v1': { requiresReview: () => (env as unknown as Record<string, string>).LAMP_TEST_REQUIRE_REVIEW === 'true' },
    });
    return worker.fetch(request, executionBindings(env), context);
  },
};
