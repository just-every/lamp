# Deploy to Cloudflare

Hosted Lamp requires Cloudflare credentials and a Resend or SendGrid provider
with an authenticated sender. Prepare the sender using [Install Lamp](install.md).
A local outbox or terminal sign-in link does not provide a hosted mail service.

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
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
LAMP_APP_HOST=ops.example.com
LAMP_PAGE_HOST=status.example.com
LAMP_PAGE_NAME=Acme Status
LAMP_PAGE_TAGLINE=Service updates for Acme customers
LAMP_PAGE_TIMEZONE=Europe/London
LAMP_ACCENT_COLOR=#16794C
SETUP_OPERATOR_EMAIL=owner@example.com
MAIL_PROVIDER=sendgrid
MAIL_FROM_ADDRESS=status@example.com
MAIL_DKIM_SELECTOR=s1
MAIL_PROVIDER_API_KEY=your-mail-provider-api-key
```

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

Use `rer` from the project root; the checkout pins its CLI version. Before a
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
receipts separately; a healthy Worker does not prove inbox delivery.

For a custom domain, follow [Hostnames and your own domain](domains.md). For
archives and recovery, see the [operations reference](../OPERATIONS.md).

## Remove an installation

Back up any data you intend to keep using [Backups and recovery](backups-and-recovery.md).
From the checkout that deployed it, use the same account, environment and private
inputs:

```sh
rer deploy --environment production --env-file "$LAMP_DEPLOY_ENV" --remove --yes
```

Removal deletes only resources proven owned by that environment's `rer`
deployment record, including their data, and checks that they are gone. It does
not discover every resource by name. If there is no record, it deletes nothing
and currently exits nonzero; that message after a failed preflight does not mean
removal deleted or damaged resources. A missing record alone does not establish
that the Cloudflare account is empty. See the [removal limits](deployment-reference.md#removal-and-deployment-records)
for Lamp's native deployment records and manual retirement.
