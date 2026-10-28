// A direct lifecycle adopter over the same real native persistence fixture.
import { createEmailLinkLifecycle } from '../../identity/email-link/index.mjs';
import { hashToken } from '../../crypto.mjs';

export function directEmail(options, auth) {
  const { accounts, proofs, config, clock } = options;
  return createEmailLinkLifecycle({ ...options, hash: (purpose, token) => hashToken(config.SESSION_SECRET, purpose, token), persistence: {
    ...proofs,
    authenticate: request => auth.getSession(request),
    requiredProvider: email => accounts.requiredProvider(email),
    byEmail: email => accounts.findByEmail(email),
    revokeSession: id => accounts.revokeSession(id),
    async authorizedLink(_request, digest) {
      const link = await proofs.preview(digest, clock());
      if (!link) return null;
      const person = await accounts.findById(link.operatorId);
      return person?.status === 'active' && person.version === link.version && person.email === link.email ? { link, person } : null;
    },
    async consumeLink({ request, digest, approval, now }) {
      await auth.admission.requireRoute(approval.person);
      return proofs.consumeLink({ request, digest, person: approval.person, now, returnTo: approval.link.returnTo });
    },
  } });
}
