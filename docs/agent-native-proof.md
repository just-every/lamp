# Native owner proof for agent actions

Company policy and native authentication answer separate questions. An approval
under company policy does not replace Lamp's current owner role, recovery rules,
or recent email proof. An agent never receives or creates a person's session.

Tools requiring recent native proof declare `proof: "native"` and
`proofKind: "step_up"`. Without a valid reference, the MCP refusal contains
`native_proof_required`, `kind: "step_up"` and a same-origin Settings link.
That link preserves the existing native owner and email-confirmation pages.
Proof issuance currently uses the person JSON endpoint described below.

The person signs in normally and completes the existing email proof through
`POST /auth/step-up`, using the tool's action:

| Tool | Native email-proof action |
|---|---|
| `lamp.operators.invite` | `owner:transfer` |
| `lamp.operators.revoke` | `owner:transfer` |
| `lamp.operators.restore` | `owner:transfer` |
| `lamp.operators.erase` | `delete` |
| `lamp.credentials.create` | `credentials:mint` |
| `lamp.importgrants.update` | `owner:transfer` |

The email confirmation must complete in the native session that requested it.
After checking the exact action and agent, the person can create an opaque
reference through `POST /api/rer/agent-native-proof` from their signed-in,
same-origin session. For example, this request disables the existing Business
import grant door; it does not import or erase data:

```js
const response = await fetch('/api/rer/agent-native-proof', {
  method: 'POST',
  credentials: 'same-origin',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    agent_id: 'the-requesting-agent-id',
    tool: 'lamp.importgrants.update',
    arguments: {enabled: false},
  }),
});
const proof = await response.json();
```

A successful response is `201` with `{reference, expiresAt}`. The reference is
bound to the current native person, native session, requesting agent, tool and
exact declared arguments. It contains no session cookie or credential. Omit the
door's `idempotency_key` and `expected_revision` when creating the reference;
they remain part of the normal tool call.

The agent retries the original MCP call with the reference in
`params._meta["com.runeditrun/native-proof"]`. The ordinary scopes, server risk
classification, native revision, company policy and named approvals still apply.
The proof is checked again at execution, including after a held approval.
Changed arguments, another person or agent, a revoked native session, changed
native admission, expired proof, and a lapsed ten-minute email-proof window
refuse without performing the action. Native development sessions retain only
the existing local key gate; production does not accept them as email proof.

`lamp.importgrants.update` uses the existing native import-settings writer and
repeats the live proof authority inside its database transaction. It can enable
or disable signed Business grants and permanently revoke public grant-key IDs.
It returns no key bytes and does not perform an import. Previously revoked
keys remain revoked.

## Owner administration API dependency

As of 29 October 2026, the Base source shipped with rer 0.2.88
still has the same native limitation. `base-copies.json` records the source revision. Its
`modules/operator-auth/accounts/delegated.mjs` exposes invitation, role change
and operator listing. Its invitation method explicitly rejects the `owner`
role, and its role method rejects owner targets and owner grants. It has no
delegated status, operator erasure or management-credential command, and accepts
no native-proof reference. Lamp's installed operator-auth API likewise offers
these mutations through real person sessions, without a corresponding native
agent admission API.

Lamp now preserves the current `TEAM-004` Owner/Admin, Communicator, Responder
and Viewer roles. Native owner invitations still grant Owner authority; the
delegated API only accepts Admin/member invitations. Converting an agent into a
person's session would bypass the real proof boundary. The registry therefore retains these named
operations and their proof requirements while reporting the explicit
`native_owner_agent_api_unavailable` dependency for owner invitation,
deactivation, reactivation and erasure. A valid native proof does not conceal
that missing execution API.

Creating the sponsor's own new management credential would widen the sponsor's
standing authority. `lamp.credentials.create` computes that native subject and
is refused as `self_escalation`, including under autonomous company policy.
Credential creation and secret reveal remain available to the real person on
the native screen. Existing scoped management credentials continue to support
only their original component/metric reads and metric-point submission; agents
cannot use them for owner administration. Native credential revocation and
chat-link removal remain supported narrowing tools.
