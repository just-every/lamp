import { z } from 'zod';
import { AuthError } from '@runeditrun/rer/modules/operator-auth';
import type { AgentDoorOptions } from '../../../../modules/agent-door/types.ts';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import { authConfig, authOrigin } from '../../platform/auth/config';
import { createNativeProofRepository, nativeArgumentsHash } from './native-proof.repository';
import { createPeopleAdapter } from './people';

export const nativeProofTools = [
  'lamp.operators.invite', 'lamp.operators.revoke', 'lamp.operators.restore', 'lamp.operators.erase',
  'lamp.credentials.create', 'lamp.importgrants.update',
] as const;
export const proofActions: Record<(typeof nativeProofTools)[number], 'owner:transfer' | 'delete' | 'credentials:mint'> = {
  'lamp.operators.invite': 'owner:transfer', 'lamp.operators.revoke': 'owner:transfer',
  'lamp.operators.restore': 'owner:transfer', 'lamp.operators.erase': 'delete',
  'lamp.credentials.create': 'credentials:mint', 'lamp.importgrants.update': 'owner:transfer',
};
const issuance = z.object({agent_id: z.string().trim().min(1).max(256), tool: z.enum(nativeProofTools), arguments: z.record(z.string(), z.unknown())}).strict();
async function readIssuance(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 100_000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

/** A person supplies their real native email proof. No agent can mint it. */
export function createNativeProof(services: AppServices, bindings: AppBindings) {
  const repository = createNativeProofRepository(bindings.DB), people = createPeopleAdapter(services, bindings);
  const local = Boolean(authConfig(bindings).local), origin = authOrigin(bindings);
  const hooks: NonNullable<AgentDoorOptions['nativeProof']> = {
    handoff({tool, principal}) {
      const url = new URL('/app/settings', origin);
      url.searchParams.set('native_proof_tool', tool);
      url.searchParams.set('native_proof_agent', principal.agent.id);
      return url.pathname + url.search;
    },
    async verify({kind, tool, args, principal, reference}) {
      if (kind !== 'step_up' || !nativeProofTools.includes(tool as (typeof nativeProofTools)[number]) || !(await people.person(principal.person.id))?.active) return false;
      return repository.verify({reference, personId: principal.person.id, agentId: principal.agent.id, tool,
        argumentsHash: await nativeArgumentsHash(args), local});
    },
  };
  return {hooks, async handle(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (url.pathname !== '/api/rer/agent-native-proof') return null;
    const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};
    if (request.method !== 'POST') return Response.json({code: 'method_not_allowed'}, {status: 405, headers: {...headers, allow: 'POST'}});
    if (url.origin !== origin || request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({code: 'same_origin_required'}, {status: 403, headers});
    if (!request.headers.get('Content-Type')?.startsWith('application/json') || Number(request.headers.get('Content-Length')) > 100_000) return Response.json({code: 'invalid_arguments'}, {status: 400, headers});
    const input = issuance.safeParse(await readIssuance(request));
    if (!input.success) return Response.json({code: 'invalid_arguments'}, {status: 400, headers});
    try {
      const session = await services.auth().requireStepUp(request, proofActions[input.data.tool]);
      if (!(await people.person(session.operator.id))?.active) return Response.json({code: 'sponsor_unavailable'}, {status: 401, headers});
      const {idempotency_key: _key, expected_revision: _revision, ...args} = input.data.arguments;
      const proof = await repository.create({session, agentId: input.data.agent_id, tool: input.data.tool, argumentsHash: await nativeArgumentsHash(args), local});
      return proof ? Response.json(proof, {status: 201, headers}) : Response.json({code: 'native_proof_required'}, {status: 403, headers});
    } catch (cause) {
      return Response.json({code: cause instanceof AuthError ? cause.code : 'native_proof_unavailable'}, {status: cause instanceof AuthError ? cause.status : 503, headers});
    }
  }};
}
