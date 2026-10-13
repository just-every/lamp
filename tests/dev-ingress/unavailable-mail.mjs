import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { secret } from '../auth-adoption/runtime.mjs';

const operator = 'operator@ingress.example.test';
const erasedId = '01J00000000000000000000092';

export const authBindings = origin => ({
  AUTH_ORIGIN: origin, AUTH_LOCAL: 'true', SESSION_SECRET: secret,
  SETUP_OPERATOR_EMAIL: operator, MAIL_PROVIDER: '', MAIL_PROVIDER_API_KEY: '',
});

function execute(state, command) {
  return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', state,
    '--config', 'wrangler.jsonc', '--command', command, '--json'], { stdio: 'pipe', encoding: 'utf8' });
}

// The real migrations have already run. Supply an active operator and the
// retained inactive attribution row left by erasure, without issuing any proof.
export function seedMailOperators(state) {
  execute(state, `INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES
    ('01J00000000000000000000091','${operator}','Ingress operator','owner','active',${Date.now()}),
    ('${erasedId}','deleted-${erasedId.toLowerCase()}@operator.invalid','Erased operator','owner','inactive',${Date.now()});`);
}

export async function assertUnavailableMail({ origin, publicOrigin, state }) {
  // Base reports absent sender configuration uniformly, before looking up an
  // address. Native forms redirect to a notice; JSON exposes the actual 503.
  for (const email of [operator, 'unknown@ingress.example.test', 'erased@ingress.example.test', `deleted-${erasedId.toLowerCase()}@operator.invalid`]) {
    const json = await fetch(`${origin}/auth/magic-link`, {
      method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(json.status, 503, 'missing sender is unavailable for every identity');
    assert.deepEqual(await json.json(), { error: 'mail_unavailable' });
    assert.equal(json.headers.get('set-cookie'), null);
    const form = await fetch(`${origin}/auth/magic-link`, {
      method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: new URLSearchParams({ email }),
    });
    assert.equal(form.status, 303, 'native form uses the Base notice redirect');
    assert.equal(form.headers.get('set-cookie'), null);
    const notice = new URL(form.headers.get('location'), origin);
    assert.equal(notice.origin, origin);
    assert.equal(notice.pathname, '/signin');
    assert.equal(notice.searchParams.get('notice'), 'mail_unavailable');
    const page = await fetch(notice);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('set-cookie'), null);
    assert.match(await page.text(), /role="alert"/);
  }
  const subscriber = await fetch(`${publicOrigin}/subscribe`, {
    method: 'POST', headers: { Origin: publicOrigin }, body: new URLSearchParams({ email: 'subscriber@ingress.example.test' }),
  });
  assert.equal(subscriber.status, 503, 'subscriber mail remains honestly unavailable');
  assert.equal(subscriber.headers.get('set-cookie'), null);
  assert.equal((await fetch(`${origin}/auth/session`)).status, 401);
  assert.equal((await fetch(`${origin}/api/app/session`)).status, 401);
  const result = JSON.parse(execute(state, 'SELECT (SELECT COUNT(*) FROM oa_tokens) AS tokens, (SELECT COUNT(*) FROM oa_sessions) AS sessions;'));
  assert.deepEqual(result[0].results, [{ tokens: 0, sessions: 0 }], 'unavailable mail creates no auth link or session');
}
