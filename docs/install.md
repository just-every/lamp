# Install Lamp

Lamp uses the checkout's pinned `@runeditrun/rer` 0.2.23 and can run locally or
in your Cloudflare account. For the local path, run
`npx -y @runeditrun/rer dev just-every/run-lamp`, which installs `rer`, clones Lamp, installs dependencies,
sets up the first owner and starts it; to start it again later, run `cd run-lamp && rer dev`.
The [local guide](../RUN-LOCALLY.md) has the details. Local mail is silently suppressed and
not retained. The local guide explains the `/__dev/outbox` compatibility notice;
use a hosted installation to exercise real email delivery.

## Prepare a hosted installation

Managed hosting includes mail without a provider account or mail key from you.
RER fills and hides `MAIL_PROVIDER=rer`, `MAIL_FROM`, `MAIL_RELAY_URL` and private
`MAIL_API_KEY`. Free and Assisted hosting keep your own Resend or SendGrid account,
authenticated sender and key, using `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR` and
`MAIL_PROVIDER_API_KEY`. Every hosted installation needs working mail for operator
sign-in and subscriber messages; terminal recovery links do not replace it.

Choose two distinct hostnames for the public status page and operator app. Use
custom domains in your Cloudflare account, or use that account's existing
`workers.dev` subdomain. Both hostname inputs are required in either mode.

Follow [Deploy to Cloudflare](deploy.md) for the complete private-input file and
commands. The [deployment reference](deployment-reference.md) distinguishes values
you supply from generated secrets and shows how to find the `workers.dev` hosts.

## Authenticate the sender

For Free, Assisted and native deployment, prepare your own sender as follows.
Managed hosting supplies the sender and relay credential automatically.

`MAIL_PROVIDER` selects `resend` (the native command's default) or `sendgrid`.
Set it explicitly to match your key. Authenticate the domain of
`MAIL_FROM_ADDRESS` in that provider, then copy its DNS records to your DNS host.
Set `MAIL_DKIM_SELECTOR` to the provider's selector, such as `s1` for SendGrid
when its domain-authentication settings use `s1` and `s2`.

Before provisioning, Lamp requires a reachable DKIM key at
`<selector>._domainkey.<From-domain>` (a provider CNAME is supported) and a DMARC
policy at `_dmarc.<From-domain>`. SPF may be on the provider's return-path domain;
Lamp does not require SPF at the From domain. Configure the provider to sign with
DKIM aligned to the From domain so DMARC can pass through DKIM.

The DNS check does not send mail or prove delivery, alignment in a sent message,
or DKIM header coverage. After deployment, verify a received message and the
[provider receipt configuration](../OPERATIONS.md#owner-inputs).

For SendGrid, the key used by **Check mail sender** also needs authenticated-domain
read permission (`whitelabel.read`). Lamp searches all matching domain pages and
shows the provider's outstanding DNS records when authentication is incomplete.
