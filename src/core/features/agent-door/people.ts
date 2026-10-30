import { operatorAuthPeople, type PeopleAdapter, type Person } from '../../../../modules/agent-door/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { authConfig } from '../../platform/auth/config';
import { createOperatorRolesRepository } from '../operators/roles.repository';

/** Business subjects select durable native IDs; current Lamp roles decide work. */
export function lampAgentPeople(bindings: AppBindings, services: AppServices): PeopleAdapter {
  const native = operatorAuthPeople({
    db: bindings.DB,
    allowList: authConfig(bindings).allowList,
    session: request => services.auth().getSession(request),
  });
  const roles = createOperatorRolesRepository(bindings.DB);
  async function current(person: Person | null): Promise<Person | null> {
    if (!person?.active) return person;
    const role = await roles.role(person.id);
    return { ...person, role: role ?? person.role, active: role !== null };
  }
  return {
    ...native,
    person: async id => current(await native.person(id)),
    sponsor: async claims => current(await native.sponsor(claims)),
    session: async request => current(await native.session(request)),
  };
}
