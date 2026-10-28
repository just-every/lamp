import type { Guard, ManagedMember, Statement, TeamAdapter } from '../../../../modules/business-settings/types.ts';
import { SettingsError } from '../../../../modules/business-settings/types.ts';
import type { AppServices } from '../../app/services';
import type { AppBindings } from '../../app/types';
import { authConfig } from '../../platform/auth/config';
import { createAgentIdentityRepository, type NativePerson } from './identity.repository';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));
async function inviteToken(secret: string) {
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const hash = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`link\0${token}`)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return {id: crypto.randomUUID(), token, hash, expiresAt: Date.now() + 7 * 86_400_000};
}

/** Signed roster provisioning retains Lamp's native equal-owner model. */
export function createLampBusinessTeam(services: AppServices, bindings: AppBindings): TeamAdapter {
  const repository = createAgentIdentityRepository(bindings.DB), config = authConfig(bindings);
  return {
    async ownerEmail() { return (await repository.owner())?.email ?? null; },
    async prepare({members, managed, ownerEmail, roles, guard}) {
      const owner = await repository.owner();
      if (!owner || owner.status !== 'active' || owner.role !== 'owner' || owner.email !== ownerEmail.trim().toLowerCase()
        || config.allowList && !config.allowList.includes(owner.email)) throw new SettingsError('owner_required');
      if (roles.admin !== 'operator' || roles.member !== 'operator') throw new SettingsError('native_roles_invalid', 503);
      const nativeGuard: Guard = {sql: `(${guard.sql}) AND EXISTS(SELECT 1 FROM oa_operators o JOIN oa_bootstrap b ON b.claim_id=o.id
        WHERE o.id=? AND o.email=? AND o.version=? AND o.status='active' AND o.role='owner')`, args: [...guard.args, owner.id, owner.email, owner.version]};
      const statements: Statement[] = [], rows: ManagedMember[] = [], pending: Array<{email: string; id: string; token: string; expiresAt: number}> = [];
      const add = (sql: string, ...args: unknown[]) => statements.push(bindings.DB.prepare(sql).bind(...args));
      const assert = (sql: string, args: unknown[]) => add(`INSERT INTO bs_assert(value) SELECT CASE WHEN (${nativeGuard.sql}) AND (${sql}) THEN 1 ELSE NULL END`, ...nativeGuard.args, ...args);
      assert('1', []);
      const audit = (id: string, action: string) => add(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
        SELECT ?,'operator',?,?,?, ?,?,? WHERE ${nativeGuard.sql}`, crypto.randomUUID(), id, action, owner.id,
        JSON.stringify({source: 'signed-business-settings', businessRoleAuthority: false}), new Date().toISOString(), new Date().toISOString(), ...nativeGuard.args);
      const desired = new Map(members.map(member => [member.email, member]));
      const previous = new Map(managed.map(member => [member.email, member]));
      for (const email of new Set([...desired.keys(), ...previous.keys()])) {
        const member = desired.get(email), prior = previous.get(email);
        let target = prior?.operatorId ? await repository.person(prior.operatorId) : await repository.byEmail(email);
        const conflict = !prior && target || prior?.operatorId && !target || target?.id === owner.id || target && target.role !== 'owner'
          || config.allowList && !config.allowList.includes(target?.email ?? email) || email.endsWith('@operator.invalid');
        if (conflict || prior?.state === 'conflict') {
          rows.push({email, operatorId: prior?.operatorId ?? null, invite: member?.invite ?? prior?.invite ?? 0, state: 'conflict'});
          continue;
        }
        const change = (person: NativePerson, status: NativePerson['status'], name = person.displayName) => {
          add(`UPDATE oa_operators SET status=?,display_name=? WHERE id=? AND version=? AND status=? AND role='owner' AND ${nativeGuard.sql}`,
            status, name, person.id, person.version, person.status, ...nativeGuard.args);
          const nextVersion = person.version + (status === person.status ? 0 : 1);
          assert("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status=? AND role='owner')", [person.id, nextVersion, status]);
          audit(person.id, status === person.status ? 'business-profile-updated' : `business-${status}`);
          return {...person, status, displayName: name, version: nextVersion};
        };
        if (!member) {
          if (target && target.status !== 'inactive') target = change(target, 'inactive');
          rows.push({email, operatorId: target?.id ?? null, invite: prior?.invite ?? 0, state: 'inactive'});
          continue;
        }
        const cancelled = target?.status === 'inactive' && await repository.cancellation(target.id);
        if (target?.status === 'inactive' && !cancelled) target = change(target, 'active', member.name);
        if (!target) {
          target = {id: crypto.randomUUID(), email, displayName: member.name, role: 'owner', status: 'invited', version: 1};
          add(`INSERT INTO oa_operators(id,email,display_name,role,status,created_at) SELECT ?,?,?,'owner','invited',? WHERE ${nativeGuard.sql}`,
            target.id, email, member.name, Date.now(), ...nativeGuard.args);
          assert("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND role='owner' AND status='invited' AND version=1)", [target.id, email]);
        } else if (cancelled) target = change(target, 'invited', member.name);
        else if (target.displayName !== member.name) target = change(target, target.status, member.name);
        if (target.status === 'invited' && (!prior || cancelled || member.invite > prior.invite)) {
          const token = await inviteToken(config.SESSION_SECRET);
          add(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at)
            SELECT ?,?,'invite',id,version,?,?, '/app',?,? FROM oa_operators WHERE id=? AND version=? AND status='invited' AND role='owner' AND ${nativeGuard.sql}`,
            token.id, token.hash, owner.id, owner.version, Date.now(), token.expiresAt, target.id, target.version, ...nativeGuard.args);
          assert('EXISTS(SELECT 1 FROM oa_tokens WHERE id=?)', [token.id]);
          add(`UPDATE oa_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE operator_id=? AND id<>? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM oa_tokens WHERE id=?)`, Date.now(), target.id, token.id, token.id);
          audit(target.id, 'invited');
          pending.push({email: target.email, ...token});
        }
        rows.push({email, operatorId: target.id, invite: member.invite, state: target.status as 'active' | 'invited' | 'inactive'});
      }
      return {statements, rows, async afterCommit() {
        for (const invitation of pending) {
          if (!await repository.invitationCurrent(invitation.id)) continue;
          const url = new URL('/auth/confirm', config.origin); url.searchParams.set('token', invitation.token);
          try {
            const mail = services.mail;
            if (!mail.configured || !config.MAIL_FROM) throw new Error('mail_unavailable');
            const result = await mail.send({from: config.MAIL_FROM, to: invitation.email, subject: "You're invited to Lamp",
              text: `Business invited you to Lamp. Open this link to review and confirm your invitation. This link works once and expires in 7 days.\n\n${url.href}`,
              html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your Lamp invitation</title></head><body><main><h1>Accept your invitation to Lamp</h1><p>Business invited you to Lamp. Review and confirm your invitation using this single-use link within 7 days.</p><p><a href="${escape(url.href)}" style="display:inline-block;padding:14px 24px">Review invitation</a></p></main></body></html>`,
              headers: {'Auto-Submitted': 'auto-generated'}, idempotencyKey: `operator-auth/${invitation.id}`});
            if ('disposition' in result && result.disposition === 'suppressed' && !config.local) throw new Error('mail_unavailable');
          } catch (error) {
            // The ordinary native lifecycle revokes a credential even for an
            // uncertain send; it must never leave an unreported live auth link.
            await repository.revokeInvitation(invitation.id);
            throw error;
          }
        }
      }};
    },
  };
}
