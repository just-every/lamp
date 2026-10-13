import type { Session } from '@runeditrun/rer/modules/operator-auth';

// Base admits the request (including the dev key and review loopback gates).
// Keep that exact session, kind and person version authoritative at each later
// D1 boundary, including the provider link and generation that admitted it.
type PinnedSession = Session & { providerPin?: { id: string; issuer: string; clientId: string; linkedAt: number } };
export function sessionAuthority(session: Session, deactivatedSelfVersion?: number) {
  const pin = (session as PinnedSession).providerPin;
  const provider = pin ? {
    sql: `EXISTS(SELECT 1 FROM oa_provider_session_pins pin JOIN oa_identity_providers provider ON provider.provider_id=pin.provider_id
      WHERE pin.session_id=s.id AND pin.provider_id=? AND pin.issuer=? AND pin.client_id=? AND pin.linked_at=?
      AND provider.status='linked' AND provider.issuer=pin.issuer AND provider.client_id=pin.client_id AND provider.linked_at=pin.linked_at)`,
    params: [pin.id, pin.issuer, pin.clientId, pin.linkedAt],
  } : { sql: 'NOT EXISTS(SELECT 1 FROM oa_provider_session_pins pin WHERE pin.session_id=s.id)', params: [] };
  const person = deactivatedSelfVersion === undefined
    ? { sql: "o.status='active' AND o.version=?", params: [session.operator.version] }
    : { sql: "o.status='inactive' AND o.version=? AND EXISTS(SELECT 1 FROM oa_operators recovery WHERE recovery.id<>o.id AND recovery.role='owner' AND recovery.status='active')", params: [deactivatedSelfVersion] };
  return {
    sql: `EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id
      WHERE s.id=? AND o.id=? AND s.kind=? AND s.operator_version=? AND o.role='owner'
      AND s.revoked_at IS NULL AND s.expires_at>unixepoch('subsec')*1000 AND ${person.sql}
      AND ${provider.sql}
      AND (s.kind<>'oidc' OR EXISTS(SELECT 1 FROM oa_provider_sessions p JOIN oa_auth_settings settings ON settings.singleton=1
        WHERE p.session_id=s.id AND settings.idp_sign_in=1 AND p.generation=settings.generation)))`,
    params: [session.id, session.operator.id, session.kind, session.operator.version, ...person.params, ...provider.params],
  };
}
