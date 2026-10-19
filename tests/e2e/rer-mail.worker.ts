import { createApp } from '../../src/core/app/server';
import { prepareAppMailBindings } from '../../src/core/app/mail';
import type { AppBindings } from '../../src/core/app/types';
export { SnapshotCache } from '../../src/core/platform/blobs/snapshot-cache';

const transport = globalThis.fetch;
const redirects: string[] = [];
globalThis.fetch = (input, init) => {
  redirects.push(init?.redirect ?? (input instanceof Request ? input.redirect : "follow"));
  return transport(input, init);
};

export default {
  async fetch(request: Request, env: AppBindings, context: ExecutionContext) {
    // Miniflare rewrites Host to its loopback listener while retaining the URL.
    request = new Request(request);
    request.headers.set('Host', new URL(request.url).host);
    const bindings = await prepareAppMailBindings(env);
    const runtime = createApp(bindings);
    if (new URL(request.url).pathname === '/__test/transport') return Response.json(redirects);
    // Test harness equivalent of the scheduled delivery runner; no service is faked.
    if (new URL(request.url).pathname === '/__test/tick') {
      await runtime.services.deliveries.dispatchDue('https://status.example.test');
      return new Response(null, { status: 204 });
    }
    return runtime.app.fetch(request, bindings, context);
  },
};
