import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerOperatorAuthConformance } from '../conformance/index.mjs';
import { openConformanceRuntime } from '../conformance/tests/runtime.mjs';

registerOperatorAuthConformance({
  test,
  adapter: {
    oidcIssuer: 'https://idp.conformance.test',
    open: openConformanceRuntime,
  },
});

test('the reusable suite rejects an incomplete adapter instead of silently skipping its contract', () => {
  assert.throws(() => registerOperatorAuthConformance({ test, adapter: { open: undefined } as never }), /runtime adapter/);
});
