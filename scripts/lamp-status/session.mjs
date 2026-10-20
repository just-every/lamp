export const operatorOrigin = 'https://status-app.run-lamp.com';

export async function withSession(issueLink, action) {
  const link = await issueLink();
  const response = await fetch(operatorOrigin + '/auth/confirm', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { Origin: operatorOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: new URL(link).searchParams.get('token') }),
  });
  await response.body?.cancel();
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-operator_session='))?.split(';')[0];
  if (response.status !== 303 || !cookie) throw new Error('Lamp did not confirm the owner-terminal sign-in.');
  async function api(path, { method = 'GET', body } = {}) {
    const result = await fetch(operatorOrigin + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Cookie: cookie, Origin: operatorOrigin, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!result.ok) throw new Error(`Lamp operator request failed: ${method} ${path} (HTTP ${result.status}).`);
    return result.status === 204 ? null : result.json();
  }
  try { return await action(api); }
  finally { await api('/api/app/session/signout', { method: 'POST' }); }
}
