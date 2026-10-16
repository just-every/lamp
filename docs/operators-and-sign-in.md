# Operators and sign-in

Operators sign in with email links and manage access in **Settings → Operators**.
Every active operator has the same access; Lamp does not assign roles. Invite a
colleague there, or remove an operator's access. Access changes require email
identity confirmation.

Removing access revokes sessions and sign-in links. Erasing personal data is a
separate, irreversible action; it removes the operator's personal values while
keeping the opaque audit attribution.

## Terminal entry for the hosted owner

With `@runeditrun/rer` 0.2.23, the hosted owner can enter without receiving email.
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

An owner can link and enable OpenID Connect through Auth, Google, Microsoft or
Okta. It is off until the owner configures it. Email sign-in links remain
available. SCIM and role synchronization are not supported.
