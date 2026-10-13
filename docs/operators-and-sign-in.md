# Operators and sign-in

Operators sign in with email links and manage access in **Settings → Operators**.
Every active operator has the same access; Lamp does not assign roles. Invite a
colleague there, or remove an operator's access. Access changes require email
identity confirmation.

Removing access revokes sessions and sign-in links. Erasing personal data is a
separate, irreversible action; it removes the operator's personal values while
keeping the opaque audit attribution.

## Optional single sign-on

An owner can link and enable OpenID Connect through Auth, Google, Microsoft or
Okta. It is off until the owner configures it. Email sign-in links remain
available. SCIM and role synchronization are not supported.

If the owner has installation database access but cannot receive email, see the
technical [terminal sign-in procedure](../OPERATIONS.md#shared-operator-authentication).
