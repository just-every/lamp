import { assertLabel, hex, randomId, sha256 } from './crypto.ts';
import { IntegrationsRepository } from './repository.ts';
import type { TokenAuthority, TokenMetadata, TokenRequestContext, TokenUsage } from './types.ts';
function scopes(input: readonly string[]) {
  if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid scopes');
  for (const value of input) assertLabel(value, 'scope');
  return [...new Set(input)].sort();
}
function metadata(row: Record<string, unknown>): TokenMetadata {
  return { id: String(row.id), name: String(row.name), scopes: JSON.parse(String(row.scopes)), createdAt: Number(row.created_at), expiresAt: row.expires_at === null ? null : Number(row.expires_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at) };
}
export class TokenService<Context> {
  private repository: IntegrationsRepository;
  private authority: TokenAuthority<Context>;
  private now: () => number;
  constructor(repository: IntegrationsRepository, authority: TokenAuthority<Context>, now: () => number = Date.now) { this.repository = repository; this.authority = authority; this.now = now; }
  async issue(context: Context, input: { name: string; scopes: readonly string[]; expiresAt?: number }) {
    const requested = scopes(input.scopes), { name, expiresAt } = input;
    const grant = await this.authority.grant(context), now = this.now();
    // A scope ceiling read before an await is insufficient. Require the native authority
    // snapshot's durable condition, evaluated by the INSERT itself in the fixed SQL batch.
    if (!grant || !grant.commitGuard || typeof grant.commitGuard.sql !== 'string' || !grant.commitGuard.sql.trim()
      || !Array.isArray(grant.commitGuard.params) || grant.commitGuard.params.some(p => p !== null && typeof p !== 'string' && (typeof p !== 'number' || !Number.isFinite(p)))) throw new Error('Token grant rejected: commit guard required');
    const granted = scopes(grant.scopes), guard = { sql: grant.commitGuard.sql, params: [...grant.commitGuard.params] };
    if (typeof name !== 'string' || !name || name.length > 200 || /[\x00-\x1f]/.test(name) || requested.some(scope => !granted.includes(scope))) throw new Error('Token grant rejected');
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= now)) throw new Error('Invalid token expiry');
    const id = randomId(), token = `int_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
    const rows = await this.repository.sql.batch([
      { sql: `INSERT INTO integration_tokens(namespace,id,token_hash,name,scopes,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) RETURNING *`, params: [this.repository.namespace, id, await sha256(token), name, JSON.stringify(requested), now, expiresAt ?? null, ...guard.params] },
      { sql: "INSERT INTO integration_token_events(namespace,id,token_id,at,action,feature) SELECT namespace,?,id,?,'issued','integrations.tokens' FROM integration_tokens WHERE namespace=? AND id=?", params: [randomId(), now, this.repository.namespace, id] },
    ]);
    if (!rows[0]!.length) throw new Error('Token grant rejected: authority changed');
    return { token, credential: metadata(rows[0]![0]!) };
  }
  async authorize(token: string, requiredScopes: readonly string[], context: TokenRequestContext): Promise<TokenMetadata | null> {
    const requestId = context?.requestId, resource = context?.resource;
    assertLabel(requestId, 'request ID'); assertLabel(resource, 'resource');
    const required = scopes(requiredScopes), now = this.now(), id = randomId();
    const hash = await sha256(typeof token === 'string' && token.length <= 1024 ? token : '');
    const ns = this.repository.namespace;
    // Authorization and its usage receipt have a single DB linearization point. Never authorize from a cached token row.
    const rows = await this.repository.sql.batch([
      { sql: `INSERT INTO integration_token_usage(namespace,id,token_id,at,required_scopes,request_id,resource,allowed)
        VALUES(?,?,(SELECT id FROM integration_tokens WHERE namespace=? AND token_hash=?),?,?,?,?,
          EXISTS(SELECT 1 FROM integration_tokens t WHERE t.namespace=? AND t.token_hash=? AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>?)
            AND NOT EXISTS(SELECT value FROM json_each(?) WHERE value NOT IN (SELECT value FROM json_each(t.scopes))))) RETURNING allowed`,
        params: [ns, id, ns, hash, now, JSON.stringify(required), requestId, resource, ns, hash, now, JSON.stringify(required)] },
      { sql: `SELECT t.* FROM integration_tokens t JOIN integration_token_usage u ON u.namespace=t.namespace AND u.token_id=t.id WHERE u.namespace=? AND u.id=? AND u.allowed=1`, params: [ns, id] },
    ]);
    return rows[1]![0] ? metadata(rows[1]![0]) : null;
  }
  async revoke(context: Context, id: string) {
    await this.authority.administer(context, 'revoke', id);
    const now = this.now(), ns = this.repository.namespace;
    const rows = await this.repository.sql.batch([
      { sql: "INSERT INTO integration_token_events(namespace,id,token_id,at,action,feature) SELECT namespace,?,id,?,'revoked','integrations.tokens' FROM integration_tokens WHERE namespace=? AND id=? AND revoked_at IS NULL", params: [randomId(), now, ns, id] },
      { sql: 'UPDATE integration_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE namespace=? AND id=? RETURNING id', params: [now, ns, id] },
    ]);
    if (!rows[1]!.length) throw new Error('Token not found');
    return { revoked: true };
  }
  async list(context: Context): Promise<TokenMetadata[]> {
    await this.authority.administer(context, 'list');
    return (await this.repository.query('SELECT * FROM integration_tokens WHERE namespace=? ORDER BY created_at,id')).map(metadata);
  }
  async usage(context: Context): Promise<TokenUsage[]> {
    await this.authority.administer(context, 'usage');
    return (await this.repository.query('SELECT * FROM integration_token_usage WHERE namespace=? ORDER BY at,id')).map(r => ({ id: String(r.id), tokenId: r.token_id === null ? null : String(r.token_id), at: Number(r.at), requiredScopes: JSON.parse(String(r.required_scopes)), allowed: r.allowed === 1,
      requestId: r.request_id === null ? null : String(r.request_id), resource: r.resource === null ? null : String(r.resource) }));
  }
}
