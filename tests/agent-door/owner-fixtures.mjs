import assert from 'node:assert/strict';
import { retainFixture } from './fixture-state.mjs';
import { refreshOwnerEmailProof } from './owner-proof.mjs';

/** Harmless topology prepared only through native person/provider doors. */
export async function prepareNativeFixtures({ request, origin, cookie, email, token, mail }) {
  const call = async (path, method = 'GET', body) => {
    const response = await request(new URL(path, origin).href, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.ok, `Native fixture ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const { components } = await call('/api/app/components');
  const componentId = components.find(component => component.name === 'Conformance API')?.id;
  assert.ok(componentId, 'Ordinary first-run creates the native fixture component');
  const intake = await call('/api/app/intake/sources', 'POST', {
    name: 'Conformance signed alert', credentialKind: 'bearer-token', bearerToken: token,
    componentId, deduplicationPath: 'id', titlePath: 'title', statePath: 'state', recoveredValue: 'recovered',
  });
  await call('/api/app/channels', 'POST', {
    kind: 'slack', name: 'Conformance operations',
    url: 'https://hooks.slack.com/services/TCONFORMANCE/BCONFORMANCE/SyntheticLampWebhook',
    componentIds: [componentId], operatorAlerts: true,
  });
  const proofAt = await refreshOwnerEmailProof({ request, origin, cookie, mail });
  const { operator } = await call('/api/app/session');
  assert.equal(operator.email, email, 'Fixture authority belongs to the claimed owner');
  retainFixture({source: intake.source, token, componentId, mail, proofAt});
}
