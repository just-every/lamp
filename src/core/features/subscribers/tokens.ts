import { constantTimeEqual, hashOpaqueToken, hmacSha256 } from "../../platform/security/opaque-tokens";

export type SubscriberTokenScope = "confirm" | "manage" | "unsubscribe";

/** Stateless signed token text; the database record supplies revocation/expiry. */
export class SubscriberTokenCodec {
  constructor(private readonly secret: string) {
    if (!secret) throw new Error("SUBSCRIBER_TOKEN_SECRET is required for subscriber tokens.");
  }

  async encode(input: { id: string; scope: SubscriberTokenScope }) {
    const signature = await hmacSha256(this.secret, `lamp-subscriber-token.v1.${input.scope}.${input.id}`);
    return `v1.${input.scope}.${input.id}.${signature}`;
  }

  async hash(token: string) {
    return hashOpaqueToken(token);
  }

  async validatesShapeAndSignature(token: string, scope: SubscriberTokenScope) {
    const [version, tokenScope, id, signature, extra] = token.split(".");
    if (version !== "v1" || tokenScope !== scope || !id || !signature || extra) return false;
    const expected = await hmacSha256(this.secret, `lamp-subscriber-token.v1.${scope}.${id}`);
    return constantTimeEqual(signature, expected);
  }
}
