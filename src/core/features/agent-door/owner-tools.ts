import { z } from 'zod';
import { ToolRefusal } from '../../../../modules/agent-door/errors.ts';
import type { ClassAndFacts, ToolContext, ToolDefinition } from '../../../../modules/agent-door/types.ts';
import type { AppBindings } from '../../app/types';
import type { AppServices } from '../../app/services';
import { authConfig } from '../../platform/auth/config';
import { ownerClaimConfig } from '../../platform/auth/claim';
import { createImportDoorRepository } from '../statuspage-import/door.repository';
import { createAgentIdentityRepository } from './identity.repository';
import { nativeSchema, parseNative } from './catalogue-shared';
import { createNativeProofRepository, nativeArgumentsHash } from './native-proof.repository';

const idInput = z.object({id: z.string().min(1).max(128)}).strict();
const idToolSchema = {type: 'object' as const, properties: {id: {type: 'string', minLength: 1, maxLength: 128}}, required: ['id'], additionalProperties: false};
const inviteInput = z.object({email: z.email(), displayName: z.string().trim().min(1).max(120)}).strict();
const credentialInput = z.object({name: z.string().trim().min(1).max(80), scopes: z.array(z.enum(['read', 'metrics:write'])).max(2), expiresInSeconds: z.number().int().min(1).max(365 * 86400)}).strict();
const grantInput = z.object({enabled: z.boolean(), revokedKids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(100).optional()}).strict();
const output = {type: 'object', additionalProperties: true};

/** 2026-10-29: retained assertions for missing Base owner-proof native commands.
 * Published rer 0.2.88 delegated.mjs refuses every native owner invitation/target,
 * exports no status/erase/credential command, and accepts no native proof.
 * These named operations remain in the registry and journey until that API
 * supports Lamp's current native owner model. No fabricated session fills it. */
export const pendingOwnerNativeApi = {
  date: '2026-10-29', base: 'rer 0.2.88',
  code: 'native_owner_agent_api_unavailable',
  source: 'modules/operator-auth/accounts/delegated.mjs:33-46',
  required: 'Owner invitation/status/erasure and credential commands accepting current native email proof without minting a session',
} as const;

export function createOwnerTools(_services: AppServices, bindings: AppBindings): ToolDefinition[] {
  const identities = createAgentIdentityRepository(bindings.DB), proof = createNativeProofRepository(bindings.DB);
  const imports = createImportDoorRepository(bindings.DB), local = Boolean(authConfig(bindings).local);
  const requireOwner = async (ctx: ToolContext) => {
    const owner = await identities.person(ctx.person.id);
    if (!owner || owner.status !== 'active' || owner.role !== 'owner') throw new ToolRefusal('owner_required');
    return owner;
  };
  const pending = async () => { throw new ToolRefusal(pendingOwnerNativeApi.code, pendingOwnerNativeApi.required, {pending: pendingOwnerNativeApi}); };
  const target = async (args: Record<string, unknown>) => identities.person(String(args.id));
  const currentGrants = async (ctx: ToolContext) => {
    const owner = await requireOwner(ctx), key = await imports.key(bindings);
    return imports.settingsForAuthority(key, ownerClaimConfig(bindings), {
      sql: "EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role='owner')", params: [owner.id, owner.version],
    });
  };
  const proofAuthority = async (tool: string, args: Record<string, unknown>, ctx: ToolContext) => {
    await requireOwner(ctx);
    if (!ctx.nativeProof || ctx.nativeProof.kind !== 'step_up') throw new ToolRefusal('native_proof_required');
    const authority = await proof.authority({reference: ctx.nativeProof.reference, personId: ctx.person.id,
      agentId: ctx.agent.id, tool, argumentsHash: await nativeArgumentsHash(args), local});
    if (!authority) throw new ToolRefusal('native_proof_required');
    return authority;
  };
  const statusTool = (name: 'lamp.operators.revoke' | 'lamp.operators.restore' | 'lamp.operators.erase'): ToolDefinition => ({
    name, scope: name, title: name.endsWith('restore') ? 'Restore a native operator' : name.endsWith('erase') ? 'Erase a native operator' : 'Revoke a native operator',
    description: `${name.endsWith('erase') ? 'Permanently erase' : name.endsWith('restore') ? 'Reactivate' : 'Deactivate'} the named native operator while retaining setup-owner recovery, current version and real email-proof constraints. Pending native owner-agent API on the pinned Base source.`,
    inputSchema: idToolSchema, outputSchema: output, readOnly: false,
    classes: name.endsWith('erase') ? ['access', 'destructive'] : ['access'], clauses: ['TEAM-001', 'TEAM-003', 'TEAM-007', 'AGENT-008'],
    proof: 'native', proofKind: 'step_up',
    ...(name.endsWith('restore') ? {} : {widens: false as const, narrowing: {effect: 'revoke' as const, target: 'id'}}),
    async authority(args, ctx) { await requireOwner(ctx); const person = await target(args); return person ? {subject: person.id, widens: name.endsWith('restore') && person.status !== 'active'} : null; },
    async classify(args, ctx) {
      await requireOwner(ctx); const input = parseNative(idInput, args), person = await identities.person(input.id);
      if (!person) throw new ToolRefusal('record_not_found');
      const classes: ClassAndFacts[] = [{class: 'access', facts: {measure: 1, direction: name.endsWith('restore') && person.status !== 'active' ? 'widens' : 'narrows'}}];
      if (name.endsWith('erase')) classes.push({class: 'destructive', facts: {measure: 1}});
      return classes;
    },
    async revision(args) { return (await target(args))?.version ?? null; }, revisionType: 'integer',
    async summary(args, ctx) { await requireOwner(ctx); const person = await target(args); return {target: {id: String(args.id), name: person?.displayName, email: person?.email}, items: [name.endsWith('erase') ? 'Erase native personal data and retire access' : name.endsWith('restore') ? 'Restore native operator admission' : 'Retire native operator admission']}; },
    async run(args, ctx) { await proofAuthority(name, args, ctx); return pending(); },
  });
  return [
    {
      name: 'lamp.operators.invite', scope: 'lamp.operators.invite', title: 'Invite a native Lamp operator',
      description: 'Invite a teammate through Lamp’s native owner lifecycle, with an exact email summary and recent real person email proof. Pending Base native owner-agent API.',
      readOnly: false, inputSchema: nativeSchema(inviteInput), outputSchema: output, classes: ['access', 'external'], clauses: ['TEAM-001', 'TEAM-002', 'TEAM-003', 'AGENT-008'],
      proof: 'native', proofKind: 'step_up',
      async authority(args, ctx) { await requireOwner(ctx); const person = await identities.byEmail(String(args.email).trim().toLowerCase()); return {subject: person?.id ?? String(args.email).trim().toLowerCase(), widens: true}; },
      async classify(args, ctx) { await requireOwner(ctx); parseNative(inviteInput, args); return [{class: 'access', facts: {measure: 1, direction: 'widens'}}, {class: 'external', facts: {measure: 1, counterparty: 'new'}}]; },
      async summary(args, ctx) { await requireOwner(ctx); const input = parseNative(inviteInput, args); return {target: {name: input.displayName, email: input.email.trim().toLowerCase()}, recipients: [input.email.trim().toLowerCase()], role: 'Native Lamp operator'}; },
      async run(args, ctx) { await proofAuthority('lamp.operators.invite', args, ctx); return pending(); },
    },
    statusTool('lamp.operators.revoke'), statusTool('lamp.operators.restore'), statusTool('lamp.operators.erase'),
    {
      name: 'lamp.importgrants.read', scope: 'lamp.importgrants.read', title: 'Read native Business import grant settings',
      description: 'Read whether the signed Business import door is enabled and which public key IDs are permanently revoked. No key bytes or credentials are returned.',
      readOnly: true, inputSchema: {type: 'object', properties: {}, additionalProperties: false}, outputSchema: output,
      classes: ['standard'], clauses: ['MOVE-002', 'AGENT-008'],
      async classify(_args, ctx) { await requireOwner(ctx); return [{class: 'standard', facts: {measure: 1}}]; },
      async run(_args, ctx) { return {result: await currentGrants(ctx)}; },
    },
    {
      name: 'lamp.credentials.create', scope: 'lamp.credentials.create', title: 'Request a native management credential',
      description: 'Request the existing management credential lifecycle. Creating the sponsor’s own new standing authority is refused as self-escalation. Secret reveal remains on the real person screen; native delegated credential API is pending.',
      readOnly: false, inputSchema: nativeSchema(credentialInput), outputSchema: output, classes: ['access', 'security'], clauses: ['API-001', 'TEAM-007', 'AGENT-008'],
      proof: 'native', proofKind: 'step_up',
      async authority(_args, ctx) { await requireOwner(ctx); return {subject: ctx.person.id, widens: true}; },
      async classify(args, ctx) { await requireOwner(ctx); parseNative(credentialInput, args); return [{class: 'access', facts: {measure: 1, direction: 'widens'}}, {class: 'security', facts: {measure: 1, setting: 'management credential'}}]; },
      async summary(args, ctx) { await requireOwner(ctx); const input = parseNative(credentialInput, args); return {target: {id: ctx.person.id, name: ctx.person.name}, items: [input.name, ...input.scopes], role: 'Scoped management credential'}; },
      async run(args, ctx) { await proofAuthority('lamp.credentials.create', args, ctx); return pending(); },
    },
    {
      name: 'lamp.importgrants.update', scope: 'lamp.importgrants.update', title: 'Update native Business import grant settings',
      description: 'Enable or disable the existing signed Business import door and permanently revoke named public grant keys. Requires current native owner email proof; no import or mail occurs.',
      readOnly: false, inputSchema: nativeSchema(grantInput), outputSchema: output, classes: ['access', 'security'], clauses: ['MOVE-002', 'AGENT-008', 'TEAM-003'],
      proof: 'native', proofKind: 'step_up',
      async authority(args, ctx) { const before = await currentGrants(ctx), key = await imports.key(bindings); return {subject: `installation:${key}`, widens: parseNative(grantInput, args).enabled && !before.enabled}; },
      async classify(args, ctx) { const before = await currentGrants(ctx), input = parseNative(grantInput, args); return [{class: 'access', facts: {measure: 1, direction: input.enabled && !before.enabled ? 'widens' : 'narrows'}}, {class: 'security', facts: {measure: 1, setting: 'signed Business import grants'}}]; },
      async revision(_args, ctx) { return JSON.stringify(await currentGrants(ctx)); },
      async summary(args, ctx) { await requireOwner(ctx); const input = parseNative(grantInput, args); return {target: {id: await imports.key(bindings), name: 'Signed Business import door'}, items: [input.enabled ? 'Enable signed grants' : 'Disable signed grants', ...(input.revokedKids ?? []).map(kid => `Permanently revoke ${kid}`)]}; },
      async run(args, ctx) {
        const input = parseNative(grantInput, args), claim = ownerClaimConfig(bindings);
        if (!claim) throw new ToolRefusal('installation_not_paired');
        const authority = await proofAuthority('lamp.importgrants.update', args, ctx), key = await imports.key(bindings);
        await imports.saveForAuthority(key, input, authority);
        const result = await imports.settingsForAuthority(key, claim, authority);
        ctx.emit('import-grants.changed', 'lamp://importgrants/current', {prepared_by: ctx.actor, approvers: ctx.approvers});
        return {result};
      },
    },
  ];
}
