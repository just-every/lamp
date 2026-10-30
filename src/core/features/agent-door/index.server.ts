import { createAgentDoor, type Trust } from '../../../../modules/agent-door/index.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { authOrigin } from '../../platform/auth/config';
import { ownerClaimConfig } from '../../platform/auth/claim';
import { lampAgentPeople } from './people';
import { componentTools } from './components';
import { incidentTools } from './incidents';
import { queueTools } from './queue';

export const lampAgentCapabilities = ['tools', 'policy', 'pause', 'audit', 'idempotency'] as const;

export function lampAgentDoor(bindings: AppBindings, services: AppServices) {
  const configured = ownerClaimConfig(bindings);
  const trust: Trust | null = configured ? {
    issuer: configured.issuer, installationId: configured.installationId,
    appOrigin: configured.appOrigin, publicKeys: configured.publicKeys,
  } : null;
  return createAgentDoor({
    seed: 'lamp', name: 'Lamp', specialist: 'incident communicator',
    origin: authOrigin(bindings), db: bindings.DB, trust,
    capabilities: lampAgentCapabilities,
    people: lampAgentPeople(bindings, services),
    tools: [...componentTools(bindings, services), ...incidentTools(bindings, services), ...queueTools(bindings)],
    limits: { requestsPerMinute: 6000, maxBodyBytes: 1048576 },
    notTools: [],
  });
}
