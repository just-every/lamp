import { createAgentDoor } from '../../../../modules/agent-door/index.ts';
import type { ToolDefinition, Trust } from '../../../../modules/agent-door/types.ts';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import { authOrigin } from '../../platform/auth/config';
import { ownerClaimConfig } from '../../platform/auth/claim';
import { createPeopleAdapter, createLocalCredentials } from './people';
import { createBusinessSettings } from './settings';
import { createNativeProof } from './native-proof';
import { createIncidentTools } from './incidents';
import { createIncidentResources } from './incident-resources';
import { createMaintenanceTools, createMaintenanceResources } from './maintenance';
import { createCatalogueTools, createCatalogueResources } from './catalogue';
import { createCommunicationTools } from './communications';
import { createCommunicationResources } from './communication-resources';
import { createAccessTools, createAccessResources } from './access';
import { createQueuedDispatchTool, setAgentEffectDoor } from './final-dispatch';
import { createWitnessTool } from './witness';
import { withAgentActor } from './actor';
import { withNativeTarget } from './targets';
import { invokeQueuedAgentOperation } from './provenance.repository';
import { nativeAuthority } from './native-authority';

export const lampDoorCapabilities = ['tools', 'policy', 'pause', 'audit', 'idempotency', 'prompts'] as const;

function installationTrust(bindings: AppBindings): Trust | null {
  const configured = [bindings.RER_OWNER_CLAIM_PUBLIC_KEYS, bindings.RER_OWNER_CLAIM_ISSUER,
    bindings.RER_OWNER_CLAIM_INSTALLATION_ID, bindings.RER_OWNER_CLAIM_APP_ORIGIN].some(value => value !== undefined && value !== '');
  if (!configured) return null;
  const trust = ownerClaimConfig(bindings);
  if (!trust) throw new Error('Incomplete or foreign agent-door installation trust.');
  return trust;
}

export function createLampAgentRegistry(services: AppServices, bindings: AppBindings) {
  const tools = [...createIncidentTools(services, bindings), ...createMaintenanceTools(services, bindings),
    ...createCatalogueTools(services, bindings), ...createCommunicationTools(services, bindings),
    ...createAccessTools(services, bindings), createQueuedDispatchTool(bindings.DB), createWitnessTool(bindings.DB)];
  const resources = [...createIncidentResources(services, bindings), ...createMaintenanceResources(services, bindings),
    ...createCatalogueResources(services, bindings), ...createCommunicationResources(services, bindings), ...createAccessResources(services, bindings)];
  const authority = nativeAuthority(bindings.DB);
  const visibleResources = resources.map(resource => authority.resource(resource));
  return {tools: tools.map(tool => authority.tool(withNativeTarget(tool, visibleResources))), resources: visibleResources};
}

export function createLampAgentDoor(services: AppServices, bindings: AppBindings) {
  const registry = createLampAgentRegistry(services, bindings);
  const people = createPeopleAdapter(services, bindings);
  const settings = createBusinessSettings(services, bindings);
  const proof = createNativeProof(services, bindings);
  const tools: ToolDefinition[] = registry.tools.map(tool => ({...tool,
    run: (args, ctx) => withAgentActor(ctx, () => tool.run(args, ctx)),
  }));
  const door = createAgentDoor({seed: 'lamp', name: 'Lamp', specialist: 'incident-communicator', capabilities: lampDoorCapabilities,
    db: bindings.DB, origin: authOrigin(bindings), trust: installationTrust(bindings), people,
    tools, nativeProof: proof.hooks, resources: registry.resources, ...createLocalCredentials(services, bindings),
    notTools: [
      {clauses: ['MOVE-002'], reason: 'import-door'},
      {clauses: ['ACCESS-001', 'TEAM-001', 'TEAM-004'], reason: 'screen'},
      {clauses: ['SUB-003', 'SUB-005'], reason: 'screen'},
    ],
    prompts: [{name: 'incident-communication', title: 'Incident communicator',
      description: 'Use native evidence, save exact drafts, publish under company policy and report delivery and recovery honestly.',
      clauses: ['AGENT-008', 'AGENT-004', 'UPDATE-007'],
      messages: () => [{role: 'user', content: {type: 'text', text:
        'Read status, components and current incident evidence. Keep private notes out of public content. Save and preview the exact native draft before policy-decided publication. Preserve configured native review, subscriber consent and component claims. Inspect public state and delivery results; provider acceptance is not readership. Resolve only with native recovery evidence or the permitted recorded override. Draft the post-incident report. Native owner proof, connection secrets, import apply and subscriber confirmation retain their own doors. Provider spend caps are not enforced.'}}],
    }],
  });
  setAgentEffectDoor(bindings.DB, door);
  services.metrics.setAgentScheduledAdmission(async (kind, id, cycle) =>
    invokeQueuedAgentOperation(bindings.DB, door, {kind, id, cycle}));
  services.incidents.setAgentScheduledAdmission(async draft =>
    (await invokeQueuedAgentOperation(bindings.DB, door, {kind: 'incident-publish', id: draft.id})) !== null);
  services.maintenance.setAgentScheduledAdmission(async (kind, id) =>
    invokeQueuedAgentOperation(bindings.DB, door, {kind, id}));
  return {...door, people, settings, async handle(request: Request) {
    return await proof.handle(request) ?? await settings.handle(request) ?? await door.handle(request);
  }};
}
