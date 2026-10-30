import { createBusinessSettings } from '../../../../modules/business-settings/index.ts';
import type { BusinessManifest, TeamAdapter } from '../../../../modules/business-settings/types.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { createOperatorRolesRepository } from '../operators/roles.repository';
import type { OperatorRole } from '../operators/permissions';

// display_name is the shared protocol's required slot. This adoption binds
// signed people; it does not claim that Business branding changes Lamp's UI.
export const lampBusinessManifest: BusinessManifest = {
  settings: 1,
  values: ['display_name'],
  team: { roles: { admin: 'admin', member: 'member' } },
};

export function lampBusinessSettings(bindings: AppBindings, services: AppServices) {
  const native = services.auth().businessTeam;
  if (!native) throw new Error('Lamp native Business team integration is unavailable.');
  const roles = createOperatorRolesRepository(bindings.DB);
  const team: TeamAdapter = {
    ownerEmail: () => native.ownerEmail(),
    async prepare(input) {
      const managed = new Map(input.managed.map(person => [person.email, person]));
      const versions: Array<{ id: string; version: number }> = [];
      const members = [];
      let inactivePeople: Promise<Array<{ id: string; role: OperatorRole }>> | undefined;
      for (const member of input.members) {
        const person = managed.get(member.email);
        if (member.role !== 'admin' || !person?.operatorId) {
          members.push(member);
          continue;
        }
        // A Business admin still has Lamp's currently granted native role.
        // Read the version first and carry it into the same transaction as the
        // signed roster CAS, so a concurrent native demotion cannot be widened.
        const version = await services.operators.version(person.operatorId);
        let role = await roles.role(person.operatorId);
        if (role === null) {
          inactivePeople ??= Promise.all([services.operators.listInvitedOperators(), services.operators.listFormerOperators()]).then(groups => groups.flat());
          role = (await inactivePeople).find(operator => operator.id === person.operatorId)?.role ?? null;
        }
        if (version) versions.push({ id: person.operatorId, version: version.version });
        members.push(role === 'admin' || role === 'owner' ? member : { ...member, role: 'member' as const });
      }
      const guard = versions.length ? {
        sql: `(${input.guard.sql}) AND NOT EXISTS (
          SELECT 1 FROM json_each(?) expected LEFT JOIN oa_operators person
            ON person.id=json_extract(expected.value,'$.id')
          WHERE person.id IS NULL OR person.version<>json_extract(expected.value,'$.version')
        )`,
        args: [...input.guard.args, JSON.stringify(versions)],
      } : input.guard;
      return native.prepare({ ...input, members, guard });
    },
  };
  return createBusinessSettings({
    db: bindings.DB,
    trust: (bindings as AppBindings & { RER_BUSINESS_TRUST?: string }).RER_BUSINESS_TRUST,
    business: lampBusinessManifest,
    team,
  });
}
