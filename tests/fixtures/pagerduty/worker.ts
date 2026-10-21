import { createApp } from '../../../src/core/app/server';
import type { AppBindings } from '../../../src/core/app/types';
export { SnapshotCache } from '../../../src/core/platform/blobs/snapshot-cache';

export default {
  async fetch(request: Request, bindings: AppBindings, context: ExecutionContext) {
    // Miniflare keeps the requested URL and rewrites Host to its local listener.
    request = new Request(request);
    request.headers.set('Host', new URL(request.url).host);
    return createApp(bindings).app.fetch(request, bindings, context);
  },
};
