# Candidate deployment declarations

`build-delivery-artifact.mjs` packages `deploymentSpec` alongside Worker modules
and assets. The emitted Wrangler configuration supplies the actual candidate
bindings, compatibility flags, Durable Objects, schedules and queue consumers.
D1 SQL is read with stable core/ext names and exact SHA-256 digests. Provider
resource names and account IDs are omitted; the broker assigns installation
identities, retains applied migration history and keeps owner initialization.

When adding a public configuration default, declare its name in `rer-packaging.json`
and its value in source Wrangler configuration. Add required secret names to
`secretNames`, or optional capabilities to `optionalSecretNames`. Values belong
only in the broker secret store; never commit them or inject them into the build.
A new BCC setting, for example, must declare its own binding in that candidate's
inputs as well as implementing the mail behavior and any database migration.
Run the producer from the candidate checkout so its declarations are selected.

Unsupported Durable Object migration forms fail explicitly until the broker
contract supports them. A built artifact is reviewed data, not deployment authority.

Lamp declares `providerEffects` IDs `outbound-mail`, `ai` and
`outbound-webhooks`. Mail covers Resend/SendGrid sign-in and subscriber delivery;
AI covers every configured OpenAI-compatible endpoint and model; webhooks cover
all configured delivery destinations.

Preview requires each exact ID in `controlledProviders`, as the owner's assertion
that provider accounts, credentials, recipients, destinations and data are
isolated, or that the optional capability is disabled. These IDs declare effects;
they are not proof that providers are sandboxed. Review the actual configuration
and selected provider controls before authorizing a preview.

The exported Base producer emits schema 2 with raw payload bytes. Its immutable
source pin and mapped files are recorded in edition.json and base-copies.json.
The setup manifest is shared with the local installer.
