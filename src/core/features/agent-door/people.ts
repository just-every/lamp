import { managementClientId } from './client';
import { isActiveOperator, type Operator } from '@runeditrun/rer/modules/operator-auth';
import type { PeopleAdapter, Person, Principal } from '../../../../modules/agent-door/types.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { authConfig } from '../../platform/auth/config';
import { createManagementApiService } from '../management-api/service';
import { createAgentIdentityRepository, type NativePerson } from './identity.repository';

export function createPeopleAdapter(services: AppServices, bindings: AppBindings): PeopleAdapter {
  const repository = createAgentIdentityRepository(bindings.DB), config = authConfig(bindings);
  const convert = (native: NativePerson): Person => ({id: native.id, email: native.email, name: native.displayName,
    role: native.role, active: isActiveOperator(native as Operator, config.allowList) && !native.email.endsWith('@operator.invalid')});
  const person = async (id: string): Promise<Person | null> => {
    const native = await repository.person(id);
    return native ? convert(native) : null;
  };
  return {
    person,
    async sponsor({sub}) {
      const id = await repository.businessId(sub);
      if (!id) return null;
      const current = await person(id);
      return current?.active ? current : null;
    },
    async session(request) {
      const session = await services.auth().getSession(request);
      if (!session) return null;
      const current = await person(session.operator.id);
      return current?.active ? current : null;
    },
    // Every admitted Lamp operator has the same native product authority.
    // Paired policy editors are resolved separately from signed Business IDs.
    businessRole: current => current.active ? 'owner' : null,
    async businessMember(current) {
      if (!(await person(current.id))?.active) return null;
      return repository.businessMember(current.id);
    },
  };
}

/** Retained API keys keep only their existing aggregate/point capabilities. */
export function createLocalCredentials(services: AppServices, bindings: AppBindings) {
  const management = createManagementApiService(bindings.DB, services.auth);
  const identities = createAgentIdentityRepository(bindings.DB);
  const scopes = (values: string[]) => [
    ...(values.includes('read') ? ['lamp.components.read', 'lamp.components.list', 'lamp.metrics.read'] : []),
    ...(values.includes('metrics:write') ? ['lamp.metrics.points'] : []),
  ];
  return {
    async localCredentials(request: Request) {
      const current = await management.authenticate(request);
      if (!current) return null;
      return {sponsor: {id: current.authority.personId}, agent: {id: `management:${current.token.id}`, name: current.token.name},
        clientId: current.token.id, scopes: scopes(current.token.scopes)};
    },
    async currentScopes(principal: Principal) {
      const clientId = managementClientId(principal);
      if (!clientId) return principal.scopes;
      const credential = await identities.credential(clientId, principal.person.id);
      if (!credential || credential.kind === 'dev' && !authConfig(bindings).local) return [];
      return scopes([...(credential.readScope ? ['read'] : []), ...(credential.scope ? [credential.scope] : [])]);
    },
  };
}
