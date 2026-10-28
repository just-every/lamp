import { validateDestination } from "../../../../modules/integrations/core/destination.ts";
import type { Outcome, TrustedTransport, WireRequest, WireResponse } from "../../../../modules/integrations/core/types.ts";

export type SocialNetwork = "x" | "bluesky" | "mastodon";
export interface SocialAccountConnection { network: SocialNetwork; host: string; identifier?: string | null }
export interface SocialReceipt { id: string; cid?: string }
export interface SocialPostInput { id: string; text: string; parent?: SocialReceipt | null; root?: SocialReceipt | null; createdAt: string }

/** The owner chooses a service origin, never a path, credentials or private host. */
export function socialOrigin(network: SocialNetwork, host?: string): string {
  const candidate = network === "x" ? "https://api.x.com" : host?.trim() || (network === "bluesky" ? "https://bsky.social" : "");
  const url = validateDestination(candidate.includes("://") ? candidate : `https://${candidate}`);
  if (url.pathname !== "/" || url.search) throw new Error("Choose a public HTTPS social service origin.");
  return url.origin;
}

export function socialPostUrl(account: SocialAccountConnection): string {
  const path = account.network === "x" ? "/2/tweets" : account.network === "bluesky" ? "/xrpc/com.atproto.repo.createRecord" : "/api/v1/statuses";
  return `${socialOrigin(account.network, account.host)}${path}`;
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
function json(value: string): Record<string, unknown> | null {
  try { const parsed: unknown = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}

/** Only safe response metadata crosses the authentication boundary. The
 * provider's response body may contain credentials and is deliberately omitted. */
export class SocialAuthenticationError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;
  constructor(response: WireResponse) {
    super("social_authentication_refused");
    this.name = "SocialAuthenticationError";
    this.status = response.status;
    const retryAfter = response.headers["retry-after"];
    this.headers = retryAfter && retryAfter.length <= 128 && /^(?:\d+|[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT)$/.test(retryAfter)
      ? { "retry-after": retryAfter } : {};
  }
}

async function blueskySession(account: SocialAccountConnection, credential: string, transport: TrustedTransport) {
  if (!account.identifier) throw new Error("social_identifier_required");
  const response = await transport.send({ url: `${socialOrigin("bluesky", account.host)}/xrpc/com.atproto.server.createSession`, headers: jsonHeaders, body: JSON.stringify({ identifier: account.identifier, password: credential }) });
  if (response.status < 200 || response.status >= 300) throw new SocialAuthenticationError(response);
  const result = json(response.body);
  if (typeof result?.accessJwt !== "string" || !result.accessJwt || /[\r\n]/.test(result.accessJwt) || typeof result.did !== "string" || !result.did.startsWith("did:")) throw new Error("social_authentication_failed");
  return { token: result.accessJwt, did: result.did };
}

/** Called before the durable envelope is frozen. This phase never contacts a
 * provider; Bluesky accepts its configured handle or DID as the repository.
 * Authentication belongs to the claimed durable dispatch attempt. */
export async function prepareSocialPost(account: SocialAccountConnection, credential: string, input: SocialPostInput, transport: TrustedTransport): Promise<WireRequest> {
  const origin = socialOrigin(account.network, account.host);
  if (account.network === "bluesky") {
    if (!account.identifier) throw new Error("social_identifier_required");
    if (input.parent && (!input.parent.cid || !input.root?.cid)) throw new Error("social_reply_receipt_unavailable");
    const record = { $type: "app.bsky.feed.post", text: input.text, createdAt: input.createdAt,
      ...(input.parent ? { reply: { root: { uri: input.root!.id, cid: input.root!.cid }, parent: { uri: input.parent.id, cid: input.parent.cid } } } : {}) };
    return { url: `${origin}/xrpc/com.atproto.repo.createRecord`, headers: jsonHeaders,
      body: JSON.stringify({ repo: account.identifier, collection: "app.bsky.feed.post", rkey: input.id.replace(/[^a-zA-Z0-9._~:-]/g, "-"), record }) };
  }
  const body = account.network === "x"
    ? JSON.stringify({ text: input.text, ...(input.parent ? { reply: { in_reply_to_tweet_id: input.parent.id } } : {}) })
    : JSON.stringify({ status: input.text, visibility: "public", ...(input.parent ? { in_reply_to_id: input.parent.id } : {}) });
  return prepareSocialRequest(account, credential, body, transport, input.id);
}

/** Protocol preparation refreshes only authorization. The durable body remains
 * byte-identical, retaining the selected reply and deterministic Bluesky rkey. */
export async function prepareSocialRequest(account: SocialAccountConnection, credential: string, body: string, transport: TrustedTransport, idempotencyKey?: string): Promise<WireRequest> {
  let token = credential;
  if (account.network === "bluesky") {
    const session = await blueskySession(account, credential, transport);
    const repo = json(body)?.repo;
    if (repo !== account.identifier && repo !== session.did) throw new Error("social_account_changed");
    token = session.token;
  }
  if (!token || /[\r\n]/.test(token)) throw new Error("social_credential_unavailable");
  return { url: socialPostUrl(account), headers: { ...jsonHeaders, authorization: `Bearer ${token}`, ...(account.network === "mastodon" && idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, body };
}

/** Receipts contain only bounded provider identifiers, never raw provider text. */
export function extractSocialReceipt(network: SocialNetwork, response: WireResponse): SocialReceipt | null {
  if (response.status < 200 || response.status >= 300) return null;
  const value = json(response.body);
  const data = network === "x" && value?.data && typeof value.data === "object" ? value.data as Record<string, unknown> : value;
  const id = network === "bluesky" ? value?.uri : data?.id;
  const cid = network === "bluesky" ? value?.cid : undefined;
  if (typeof id !== "string" || !id || id.length > 1024 || !/^[a-zA-Z0-9:./_~-]+$/.test(id)) return null;
  if (network === "bluesky" && (typeof cid !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(cid))) return null;
  return { id, ...(typeof cid === "string" ? { cid } : {}) };
}

export function classifySocialResponse(network: SocialNetwork, response: WireResponse, now = Date.now()): Outcome {
  if (extractSocialReceipt(network, response)) return { kind: "accepted", code: "social_post_accepted", status: response.status };
  if (response.status === 429 || response.status >= 500) {
    const value = response.headers["retry-after"];
    const seconds = value && /^\d+$/.test(value) ? Number(value) : null;
    const date = value ? Date.parse(value) : NaN;
    const retryAfterMs = seconds !== null ? seconds * 1000 : Number.isFinite(date) ? Math.max(0, date - now) : undefined;
    return { kind: "retryable", code: "social_provider_unavailable", status: response.status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
  if (response.status >= 200 && response.status < 300) return { kind: "uncertain", code: "social_receipt_missing", status: response.status };
  return { kind: "rejected", code: "social_provider_refused", status: response.status };
}
