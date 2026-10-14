import {sanitize, target, timestamp} from './demo-diagnostic-sanitize.mjs';

const base = `https://api.cloudflare.com/client/v4/accounts/${target.account}`;
const application = `/containers/applications/${target.applicationId}`;
const tails = `/workers/scripts/${target.worker}/tails`;
export const now = () => new Date().toISOString();

// Responses, continuation tokens, tail URL/id and DO actor IDs remain in memory.
// IDs are bearer cookies in this host: never log them, even hashed.
export function provider(record) {
  async function request(path, operation, method = 'GET', signal) {
    let providerRejected = false;
    try {
      const response = await fetch(base + path, {
        method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
        headers: {authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json'},
        ...(method === 'POST' ? {body: '{}'} : {}),
      });
      let text = '';
      for await (const chunk of response.body) {
        text += Buffer.from(chunk).toString('utf8');
        if (text.length > 2097152) throw Error('response-too-large');
      }
      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      record({category: 'provider-response', operation, httpStatus: response.status, success: body?.success === true});
      if (!response.ok || body?.success !== true) {
        providerRejected = response.status >= 400 && response.status < 500 && body?.success === false;
        for (const item of sanitize('api-error', body)) record({...item, operation});
        throw Error('provider-unavailable');
      }
      return body;
    } catch {
      record({category: 'capture-unavailable', operation});
      // A transport failure, malformed response or server error cannot prove
      // whether a mutation took effect. Keep only this fixed safe distinction.
      throw Object.assign(Error('provider-unavailable'), {providerRejected});
    }
  }
  const ordinals = new Map();
  async function snapshot(phase) {
    const rows = [], seen = new Set(), tokens = new Set();
    let token, complete = false, pages = 0;
    const signal = AbortSignal.timeout(20000);
    try {
      for (; pages < 10; pages++) {
        const query = new URLSearchParams({per_page: '100'});
        if (token) query.set('page_token', token);
        const body = await request(`${application}/instances-v2?${query}`, `instances-${phase}`, 'GET', signal);
        if (!Array.isArray(body.result)) throw Error('unexpected-shape');
        for (const item of body.result) {
          if (item?.application_id !== target.applicationId || !/^[a-f0-9]{64}$/.test(item?.id || '')) throw Error('unexpected-identity');
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const isNew = !ordinals.has(item.id);
          if (isNew) ordinals.set(item.id, ordinals.size + 1);
          rows.push({ordinal: ordinals.get(item.id), newSinceBaseline: phase === 'after' && isNew, ...sanitize('instance', item)[0]});
        }
        if (!body.result_info || typeof body.result_info !== 'object') throw Error('unexpected-pagination');
        token = body.result_info.next_page_token;
        if (token === undefined || token === null || token === '') { complete = true; pages++; break; }
        if (typeof token !== 'string' || token.length > 8192 || tokens.has(token)) throw Error('unexpected-pagination');
        tokens.add(token);
      }
    } catch { record({category: 'snapshot-unavailable', phase}); }
    return {at: now(), phase, pages, complete, truncated: !complete, instances: rows};
  }
  return {
    snapshot,
    async validateApplication() {
      const body = await request(application, 'application-read');
      const result = sanitize('application', body.result)[0];
      record(result);
      if (result.matches !== true) throw Error('identity-mismatch');
      return result;
    },
    async createTail() {
      const body = await request(tails, 'tail-create', 'POST');
      const id = body.result?.id;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw Error('unexpected-tail-id');
      return {id, url: body.result?.url, expiresAt: timestamp(body.result?.expires_at)};
    },
    async deleteTail(id) { await request(`${tails}/${id}`, 'tail-delete', 'DELETE'); },
  };
}
