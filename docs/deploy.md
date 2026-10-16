# Deploy to Cloudflare

- **Free:** you run Lamp's open source yourself in your own Cloudflare account,
  with no Run Edit Run charge. The commands in this guide are this path.
- **Assisted:** Run Edit Run installs and maintains Lamp for you, while it stays
  in your own Cloudflare account and GitHub repository (early access).
- **Managed:** Run Edit Run hosts and runs Lamp for you (waitlist only).

Compare them on [Run Edit Run plans](https://runeditrun.com/pricing).

Managed hosting includes mail without an owner provider account or mail key.
RER fills and hides `MAIL_PROVIDER=rer`, `MAIL_FROM`, `MAIL_RELAY_URL` and private
`MAIL_API_KEY`. Free and Assisted hosting keep your own Resend or SendGrid account
and use `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR` and `MAIL_PROVIDER_API_KEY`.
Every hosted installation needs working mail.

The native Cloudflare deployment below requires your Cloudflare credentials and
a Resend or SendGrid provider with an authenticated sender. Prepare that sender
using [Install Lamp](install.md). A terminal sign-in link does not replace the
hosted mail service.

## Save private deployment inputs

Create a file outside the checkout, owned by your user and readable and writable
only by you (mode `0600`):

```sh
export LAMP_DEPLOY_ENV="$HOME/.config/lamp/production.env"
mkdir -p "$HOME/.config/lamp"
chmod 700 "$HOME/.config/lamp"
touch "$LAMP_DEPLOY_ENV"
chmod 600 "$LAMP_DEPLOY_ENV"
```

Edit that file with your actual values. The following is an example of its
contents, not a command to run; replace the credential placeholders and addresses:

```text
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=synthetic-your-cloudflare-api-token
LAMP_APP_HOST=ops.example.com
LAMP_PAGE_HOST=status.example.com
LAMP_PAGE_NAME=Acme Status
LAMP_PAGE_TAGLINE=Service updates for Acme customers
LAMP_PAGE_TIMEZONE=Europe/London
LAMP_ACCENT_COLOR=#16794C
SETUP_OPERATOR_EMAIL=owner@example.com
OWNER_DISPLAY_NAME=Alex Morgan
MAIL_PROVIDER=sendgrid
MAIL_FROM_ADDRESS=status@example.com
MAIL_DKIM_SELECTOR=s1
MAIL_PROVIDER_API_KEY=synthetic-your-mail-provider-api-key
```

`OWNER_DISPLAY_NAME` sets the first owner's name and defaults to `Owner` when
omitted. It does not rename an existing owner. The [input reference](deployment-reference.md#inputs-you-supply-and-values-rer-generates)
uses the same input names as the CLI's required-input list.

For `workers.dev`, replace the two hostnames and add `LAMP_HOSTING=workers-dev`
using [Find your workers.dev hostnames](deployment-reference.md#find-your-workersdev-hostnames).
The file uses one `KEY=VALUE` per line; blank lines and `#` comments are allowed.
An optional pair of double quotes around a value is removed. Do not add `export`,
shell substitutions or multiline values: `--env-file` reads data and does not
execute a shell script. File values override exported environment values.

On a first deployment, `rer` can generate `SETUP_TOKEN`, `SESSION_SECRET`,
`SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` when omitted. For a
repeatable native deployment and recovery, generate them once into this private
file before the first deploy and retain them. Run the following only once, before
those keys exist in the file; it appends random values without printing them:

```sh
node --input-type=module <<'NODE'
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const names = [
  "SETUP_TOKEN", "SESSION_SECRET",
  "SUBSCRIBER_TOKEN_SECRET", "WEBHOOK_SIGNING_SECRET",
];
appendFileSync(process.env.LAMP_DEPLOY_ENV, "\n" +
  names.map(name => `${name}=${randomBytes(32).toString("hex")}\n`).join(""));
NODE
```

Reuse the original secrets on redeploy or restore. The [input reference](deployment-reference.md#inputs-you-supply-and-values-rer-generates)
explains which are required, generated or optional.

You can instead export the same input names in the calling shell. For example,
`export LAMP_PAGE_NAME="Acme Status"` supplies that value without a file. Supply
credentials through your private shell or secret manager, then run `rer deploy`
without `--env-file`. Do not commit inputs or paste secret values into logs.

## Validate and deploy

Use `rer` from the project root; the checkout pins `@runeditrun/rer` 0.2.36. Before a
command that builds or verifies the checkout, stop a running development server
with `rer dev --stop` or a production preview with `rer preview --stop`.

Use the same environment and input file for validation and deployment:

```sh
rer install
rer deploy --dry-run --environment production --env-file "$LAMP_DEPLOY_ENV"
rer deploy --environment production --env-file "$LAMP_DEPLOY_ENV"
```

`--environment` defaults to `production`; choose a different name for a separate
installation and keep using it for that installation's commands. The dry run
validates and compiles locally without contacting Cloudflare, including without
checking DNS or credentials. It does not prove a real deploy will pass.

A real deploy checks inputs and sender DNS, provisions or reuses resources,
applies migrations, builds and uploads the Worker with secrets, initializes
ownership and checks health and retained public snapshot readiness. It does not
run the full verifier; use `rer verify` separately for source and browser checks.

Afterward, check the public page and operator email sign-in on their selected
hosts. Verify a received subscription or incident email and signed provider
receipts separately; a healthy Worker does not prove inbox delivery. To receive
verified delivery or bounce updates, also configure `SENDGRID_WEBHOOK_PUBLIC_KEY`
or `RESEND_WEBHOOK_SECRET` and the provider webhook as described in
[Owner inputs](../OPERATIONS.md#owner-inputs). Without that key or the optional signed SendGrid relay, provider acceptance
is the final evidence Lamp can record for a successful send; the delivery log
shows **Accepted by SendGrid** (or **Accepted by Resend**) with the acceptance
time. The persisted transport outcome in CSV remains queued.

To enter the hosted owner account from the deploying checkout without waiting
for email, run:

```sh
rer signin --environment production --env-file "$LAMP_DEPLOY_ENV"
```

Open the printed link privately before it expires. It works once for the recorded
owner, within 15 minutes; its use is audited. Use the same Cloudflare account and
environment as deployment. This command uses the default `lamp-<environment>`
resource prefix. For a custom prefix, use the compatibility command in the
[technical sign-in reference](../OPERATIONS.md#shared-operator-authentication).
See [terminal entry](operators-and-sign-in.md#terminal-entry-for-the-hosted-owner)
for details. Hosted mail remains required for operator email sign-in and subscriber
messages.

For a custom domain, follow [Hostnames and your own domain](domains.md). For
archives and recovery, see the [operations reference](../OPERATIONS.md).

## Remove an installation

Back up any data you intend to keep using [Backups and recovery](backups-and-recovery.md).
From the checkout that deployed it, use the same account, environment and private
inputs:

```sh
node scripts/remove-deployment.mjs --environment production --env-file "$LAMP_DEPLOY_ENV" --yes
```

This is Lamp's one-pass native removal command. In `workers-dev` mode it removes
the public Worker first, then the app Worker and the resources its creation
record proves belong to this environment, including their data. It checks that
the removed resources are gone. In custom-domain mode it removes the single app
Worker and its recorded resources. `rer deploy --remove --yes` alone does not
remove the separate public Worker in Lamp's native `workers-dev` topology.

Removal does not infer ownership from matching names. If an older installation
has no creation records, the command refuses; inspect and retire its confirmed
resources using the [removal limits](deployment-reference.md#removal-and-deployment-records).
A missing record after a failed preflight does not prove that the Cloudflare
account is empty.
