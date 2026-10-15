import { createPublicKey } from 'node:crypto';
import { configureClaim } from '@runeditrun/rer/internal/modules/owner-claim/verify.mjs';

// Use the runtime's claim schema before a deploy can build or contact a provider.
// Diagnostics name the setting, never the supplied JSON or signing material.
export function validateOwnerClaim(env, appOrigin, expectedEmail) {
  if (!env.RER_OWNER_CLAIM_PUBLIC_KEYS) return;
  try {
    const config = configureClaim({
      issuer: env.RER_OWNER_CLAIM_ISSUER,
      installationId: env.RER_OWNER_CLAIM_INSTALLATION_ID,
      appOrigin, expectedEmail,
      publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS),
    });
    for (const key of Object.values(config.publicKeys)) {
      createPublicKey({ key, format: 'jwk' });
    }
  } catch {
    throw new Error('RER_OWNER_CLAIM_PUBLIC_KEYS must be a nonempty JSON object of public ES256 P-256 JWKs, with a valid RER_OWNER_CLAIM_ISSUER and RER_OWNER_CLAIM_INSTALLATION_ID.');
  }
}
