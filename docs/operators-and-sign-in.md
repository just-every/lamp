# Operators and sign-in

Operators sign in with email links and manage access in **Settings → Operators**.
Every active operator has the same access; Lamp does not assign roles. Invite a
colleague there, or remove an operator's access. Access changes require email
identity confirmation.

Removing access revokes sessions and sign-in links. Erasing personal data is a
separate, irreversible action; it removes the operator's personal values while
keeping the opaque audit attribution.

## Terminal entry for the hosted owner

With the checkout's pinned `@runeditrun/rer` (0.2.32), the hosted owner can enter without receiving email.
From the checkout that deployed Lamp, use the same Cloudflare account, deployment
environment and [private input file](deploy.md#save-private-deployment-inputs):

```sh
rer signin --environment production --env-file "$HOME/.config/lamp/production.env"
```

The command uses `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from that file
or the calling shell. It issues a link for the recorded deployment owner, so it
does not take an email address. The link works once, expires within 15 minutes
and is printed only to this terminal; `rer` does not save it. Open it privately.
Its use is recorded in the installation's audit log.

Keep the deploying checkout and its deployment records. If the command refuses
a missing record, wrong installation or missing owner-sign-in table, correct that
condition before trying again. After updating older source, redeploy to apply its
migrations, including `0023_owner_signin.sql`. This command supports the default
resource prefix, `lamp-<environment>`. If you set `LAMP_RESOURCE_PREFIX` to another
value, use the compatibility command in the
[technical sign-in reference](../OPERATIONS.md#shared-operator-authentication)
with that installation's generated configuration instead. Hosted Lamp still
requires working mail. Managed hosting includes it without an owner provider
account or mail key: RER fills and hides `MAIL_PROVIDER=rer`, `MAIL_FROM`,
`MAIL_RELAY_URL` and private `MAIL_API_KEY`. Free and Assisted hosting retain
your own Resend or SendGrid account with `MAIL_FROM_ADDRESS`,
`MAIL_DKIM_SELECTOR` and `MAIL_PROVIDER_API_KEY`.

## Optional single sign-on

Single sign-on lets an already invited operator use a supported identity
provider. Linking a provider does not invite people or give them Lamp access.
Email sign-in stays available. The **Identity provider settings** checkbox
only enables provider sign-in; register and configure the provider first.
SCIM and role synchronization are not supported.

**Settings → Operators → Identity provider settings** says whether a provider
is set up and walks you through Google on the page itself: the exact redirect
URI, the two settings lines (with a fresh random secret), the deploy step and a
sign-in test, each with a copy button. Microsoft and Okta need the extra values
below.

### Register Google, Microsoft or Okta

The person deploying Lamp needs permission to create an application in the
identity provider and change Lamp's private deployment inputs.

1. Register a confidential **Web application** in the provider's admin console.
   Use its authorization-code flow with the `openid email` scopes. Create a
   client secret and retain the client ID. These are application credentials,
   different from an operator's password.
2. Register the exact callback address on Lamp's **operator** host. For the IDs
   below, use `https://ops.example.com/auth/oidc/google/callback`,
   `https://ops.example.com/auth/oidc/microsoft/callback` or
   `https://ops.example.com/auth/oidc/okta/callback`. Replace `ops.example.com`
   with your actual operator hostname. Use the same provider ID in the JSON.
3. Prepare the corresponding provider entry below. For Microsoft and Okta, ask
   the identity administrator for the operator's exact OIDC **subject** (`sub`)
   for this application. Add it to `subjectEmails`, mapped to that person's
   already invited Lamp email. Do not substitute the display name or assume a
   directory object ID is the application's subject.

| Provider | Registration and values |
| --- | --- |
| Google | In [Google Auth Platform → Clients](https://developers.google.com/identity/protocols/oauth2/web-server#create-authorization-credentials), create a Web application client and its authorized redirect URI. Configure its audience and test users as needed. Lamp trusts a verified Gmail address or a verified Workspace address with a matching hosted-domain (`hd`) claim; other addresses need an explicit `subjectEmails` map. |
| Microsoft | In [Microsoft Entra → App registrations](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app), register for your single tenant, add the Web redirect URI, then create a client secret under Certificates & secrets. Use the application/client ID, secret **value** and Directory/tenant ID. Lamp requires that specific tenant, not `common`, `organizations` or `consumers`, and an explicit subject map. |
| Okta | In [Okta Admin → Applications → Create App Integration](https://developer.okta.com/docs/guides/implement-grant-type/authcode/main/), select OIDC and Web Application, set the sign-in redirect URI and assign the operators. Use the exact issuer shown by its authorization server (including any path), client ID and secret. Set client authentication to match `client_secret_basic`; an explicit subject map is required. |

Use one or more entries in a single JSON array. These examples contain
placeholders, not usable credentials:

```json
[
  {"id":"google","preset":"google","clientId":"your-google-client-id","tokenAuthMethod":"client_secret_post","clientSecret":"your-google-client-secret"},
  {"id":"microsoft","preset":"microsoft","tenant":"your-tenant-id","clientId":"your-application-id","tokenAuthMethod":"client_secret_post","clientSecret":"your-client-secret-value","subjectEmails":{"exact-operator-subject":"operator@example.com"}},
  {"id":"okta","preset":"okta","issuer":"https://your-org.okta.com","clientId":"your-client-id","tokenAuthMethod":"client_secret_basic","clientSecret":"your-client-secret","subjectEmails":{"exact-operator-subject":"operator@example.com"}}
]
```

### Configure Lamp and check sign-in

1. Put the selected JSON array on **one line** as `AUTH_PROVIDERS=[...]` in your
   existing [private deployment input file](deploy.md#save-private-deployment-inputs).
   Include only the providers you registered; replace every placeholder. The
   array contains client secrets and must stay outside Git and shared logs.
2. Add `OIDC_TRANSACTION_SECRET` to the same file: a separate random value of at
   least 32 characters, different from `SESSION_SECRET`. To append one without
   printing it, run this once before that key exists in the file:

```sh
node --input-type=module <<'NODE'
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const file = process.env.HOME + "/.config/lamp/production.env";
appendFileSync(file, "\nOIDC_TRANSACTION_SECRET=" + randomBytes(32).toString("hex") + "\n");
NODE
```

3. Stop any local development or preview server, then validate and redeploy:

```sh
rer deploy --dry-run --environment production --env-file "$HOME/.config/lamp/production.env"
rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"
```

4. As the setup owner, open **Settings → Operators → Identity provider settings**.
   Enable **Allow provider sign-in** and save. This permits the configured
   providers; the checkbox alone does not establish a connection.
5. Keep your current owner session open. In a separate private browser window,
   open Lamp's sign-in page and choose the provider. Complete sign-in as an
   invited operator. A real sign-in that reaches the operator app checks the
   registration, callback, credentials, provider response and Lamp membership.
   A saved setting or discovered provider alone does not check all of these.

If the provider is missing or sign-in fails, check that the deployed values
contain the registered ID, callback, client secret and correct issuer/tenant.
For Microsoft and Okta also check the exact subject map and active invitation.
Use email sign-in while correcting the configuration. Previously linked
providers keep their pinned registration when configuration changes: an owner
must approve a re-link; see the [technical provider controls](../OPERATIONS.md#identity-provider-configuration).

### Connect a Run Edit Run Auth installation

`IDENTITY_PROVIDER` is for an installed Auth provider that supports RER's
`oidc-provider@1` link protocol. It is not a place to paste a Google, Microsoft
or Okta sign-in URL. The deployer sets it to the Auth installation's HTTPS
origin and redeploys. The Lamp owner then confirms their identity by email and
approves that exact Auth origin locally; the Auth owner separately approves
Lamp's exact operator origin and callback addresses. The completed link creates
its client registration and server key automatically. No manual client secret
is needed for this path.

The checkbox cannot perform that link. Give the [Auth linking procedure](../OPERATIONS.md#identity-provider-configuration)
to the person operating the two installations, then enable provider sign-in and
check a real invited-operator sign-in as above. A restored installation needs
fresh link approval and starts with provider sign-in disabled.
