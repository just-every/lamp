import { configureClaim } from '../../../../modules/owner-claim/verify.mjs';
import type { AppBindings } from '../../app/types';
import { authConfig } from './config';

/** A single server-owned trust configuration for claims and Business grants. */
export function ownerClaimConfig(env: AppBindings) {
  if (!env.RER_OWNER_CLAIM_PUBLIC_KEYS) return null;
  const config = authConfig(env);
  return configureClaim({issuer:env.RER_OWNER_CLAIM_ISSUER ?? '',installationId:env.RER_OWNER_CLAIM_INSTALLATION_ID ?? '',
    appOrigin:config.origin,expectedEmail:config.OWNER_EMAIL,publicKeys:JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS)});
}
