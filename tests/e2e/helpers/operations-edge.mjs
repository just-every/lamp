import assert from 'node:assert/strict';
export const operationCredentials = {
  jsm: { site: 'https://synthetic-lamp.atlassian.net', email: 'operator@example.test', apiToken: 'synthetic-lamp-12' },
  opsgenie: { host: 'https://api.eu.opsgenie.com', apiKey: 'synthetic-lamp-14' },
};
export function operationsEdge() {
  const requests = [], statuses = { jsm: 202, opsgenie: 202 };
  return {
    requests, statuses,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.hostname === 'synthetic-lamp.atlassian.net') {
        assert.equal(url.pathname, '/_edge/tenant_info');
        assert.equal(request.headers.get('authorization'), null, 'tenant lookup has no credential');
        return Response.json({ cloudId: 'synthetic-lamp-13' });
      }
      const preset = url.hostname === 'api.atlassian.com' ? 'jsm' : 'opsgenie';
      assert.equal(url.hostname, preset === 'jsm' ? 'api.atlassian.com' : 'api.eu.opsgenie.com', 'only documented provider hosts receive credentials');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), preset === 'jsm'
        ? `Basic ${Buffer.from('operator@example.test:synthetic-lamp-12').toString('base64')}` : 'GenieKey synthetic-lamp-14');
      const base = preset === 'jsm' ? '/jsm/ops/api/synthetic-lamp-13/v1/alerts/synthetic-lamp-1' : '/v2/alerts/synthetic-lamp-1';
      assert.ok(url.pathname === `${base}/notes` || url.pathname === `${base}/close`);
      const text = await request.text();
      const body = text ? JSON.parse(text) : null;
      if (url.pathname.endsWith('/notes')) assert.equal(typeof body.note, 'string');
      else assert.deepEqual(body, preset === 'jsm' ? null : {});
      requests.push({ preset, path: url.pathname, body });
      return Response.json({ requestId: 'synthetic-lamp-15' }, { status: statuses[preset],
        ...(statuses[preset] === 302 ? { headers: { Location: 'https://redirect.example.test/forbidden' } } : {}) });
    },
  };
}
