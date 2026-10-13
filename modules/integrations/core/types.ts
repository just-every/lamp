export type DeliveryState = 'queued' | 'sending' | 'accepted' | 'rejected' | 'uncertain';
export interface Envelope {
  id: string; tenant: string; destinationId: string; event: string; protocol: string;
  /** Exact UTF-8 bytes to send; never reserialize during a retry. */
  body: string;
}
export interface Delivery extends Envelope {
  fingerprint: string; destinationHash: string; state: DeliveryState; attempts: number;
  createdAt: number; nextAt: number; claim: string | null; claimUntil: number | null;
  maxAttempts: number; retryDelaysMs: number[];
}
export interface WireRequest { url: string; headers: Record<string, string>; body: string }
export interface WireResponse { status: number; headers: Record<string, string>; body: string }
export interface Outcome {
  kind: 'accepted' | 'rejected' | 'retryable' | 'uncertain';
  /** Fixed safe machine code, not raw response/error/URL/token. */
  code: string; status?: number; retryAfterMs?: number;
}
export interface DeliveryProtocol {
  id: string;
  /** Trusted configuration lookup. Destination IDs must identify immutable versions. */
  prepare(envelope: Envelope, now: number): Promise<WireRequest>;
  classify(response: WireResponse, now: number): Outcome;
}
/** Security boundary: implementation MUST pin validated public DNS resolution to the connection,
 * reject private/reserved IPs, require verified TLS and never follow redirects. Use NodePinnedTransport
 * or a deployment-owned egress proxy that enforces those guarantees. Ordinary fetch is NOT sufficient. */
export interface TrustedTransport { send(request: WireRequest): Promise<WireResponse> }
export interface Attempt { id: string; deliveryId: string; number: number; startedAt: number; finishedAt: number | null; outcome: Outcome | null }
export interface TokenMetadata { id: string; name: string; scopes: string[]; createdAt: number; expiresAt: number | null; revokedAt: number | null }
/** Safe application identifiers supplied by the server handling the concrete request.
 * Do not pass bearer tokens, secret URLs, query strings or request bodies. */
export interface TokenRequestContext { requestId: string; resource: string }
export interface TokenUsage {
  id: string; tokenId: string | null; at: number; requiredScopes: string[]; allowed: boolean;
  /** Null only for historical receipts created before request context was required. */
  requestId: string | null; resource: string | null;
}
export interface TokenGrant {
  scopes: readonly string[];
  /** Trusted SELECT returning a row only while the authenticated issuer and the entire
   * grant snapshot remain authorized. Bind namespace, issuer identity and the durable
   * revision(s) read to derive scopes. Runs inside the token INSERT transaction on the
   * repository database; all authority changes must update those rows/revisions there.
   * Never use a constant SELECT or caller-provided SQL. No preflight-only grants. */
  commitGuard: { sql: string; params: readonly (string | number | null)[] };
}
/** The consumer authenticates context on the server; never pass caller-supplied roles as authority. */
export interface TokenAuthority<Context> {
  grant(context: Context): Promise<TokenGrant>;
  administer(context: Context, action: 'revoke' | 'list' | 'usage', tokenId?: string): Promise<void>;
}
