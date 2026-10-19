import { DoorError, enableDoorAtFirstClaim } from '../../../../modules/import-kit/src/door';
import { ownerClaimConfig } from '../../platform/auth/claim';
import type { AppBindings } from '../../app/types';
import { createImportDoorRepository } from './door.repository';

/** An install RER provisioned for a Business plan carries `RER_IMPORT_DOOR=on`
 * with its door trust. Its first owner claim opens the Business import door,
 * and so does every later owner claim answer or sign-in while the door has no
 * settings row yet, which heals a failure between the claim's commit and this
 * one. Once a row exists, the owner's own choice in Settings stands: nothing
 * here reopens a door the owner closed. Self-host deploys never set the
 * variable, so their door stays off until the owner turns it on. */
export async function openDoorAtFirstClaim(bindings: AppBindings) {
  if (bindings.RER_IMPORT_DOOR !== 'on') return;
  const claim = ownerClaimConfig(bindings);
  if (!claim) return;
  if (await bindings.DB.prepare('SELECT 1 FROM ik_door_settings LIMIT 1').first()) return;
  const key = await createImportDoorRepository(bindings.DB).key(bindings);
  try {
    await enableDoorAtFirstClaim(bindings.DB, key, {
      sql: "EXISTS(SELECT 1 FROM oa_operators WHERE email=? AND role='owner' AND status='active')",
      params: [claim.expectedEmail],
    });
  } catch (error) {
    // No owner has claimed this install yet: the door stays closed.
    if (error instanceof DoorError && error.code === 'owner_required') return;
    throw error;
  }
}
