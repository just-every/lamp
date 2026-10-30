// Test-only request-scoped configuration channel. The original fixture and its
// immutable Worker bindings are untouched; each dispatch constructs its own env.
import worker from './worker.mjs';
export default {
  async fetch(request, env, ctx) {
    const { harness, ...envelope } = await request.json();
    if (!harness || typeof harness.config !== 'object' || typeof harness.options !== 'object') {
      throw new Error('Conformance dispatch requires explicit case configuration.');
    }
    return worker.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(envelope) }), {
      ...env, TEST_CONFIG: JSON.stringify(harness.config), TEST_OPTIONS: JSON.stringify(harness.options),
    }, ctx);
  },
};
