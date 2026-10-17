# Deploy to Cloudflare

- **Free:** you run Lamp's open source yourself in your own Cloudflare account,
  with no Run Edit Run charge. This page is that path, step by step.
- **Assisted:** Run Edit Run installs and maintains Lamp for you, while it stays
  in your own Cloudflare account and GitHub repository (early access).
- **Managed:** Run Edit Run hosts and runs Lamp for you, and provides its mail:
  you need no mail provider account, domain or key (waitlist only).

Compare them on [Run Edit Run plans](https://runeditrun.com/pricing).

A hosted Lamp sends real email: sign-in links to you and your team, and updates
to your subscribers. On the Free path that mail goes through your own SendGrid or
Resend account, from a domain you own and have authenticated there (step 6 shows
how). If you have no domain you can add DNS records to, choose Managed instead.

Do the steps in order. Each step names the inputs it gives you; `rer deploy
--dry-run` lists any you have not set yet by the same names, in the same order.
You need the Lamp folder that `rer dev just-every/run-lamp` made (run every
command below from it), a Cloudflare account, a mail account at SendGrid or
Resend, and a domain whose DNS records you can change.

## Step 1: Make a private input file

Your inputs live in one file outside the Lamp folder that only you can read. Run
these four lines once; the first also tells the later commands where the file is:

```sh
export LAMP_DEPLOY_ENV="$HOME/.config/lamp/production.env"
mkdir -p "$HOME/.config/lamp" && chmod 700 "$HOME/.config/lamp"
touch "$LAMP_DEPLOY_ENV" && chmod 600 "$LAMP_DEPLOY_ENV"
```

Open the file in any text editor. Each later step adds lines to it, one
`NAME=value` per line. Blank lines and `# comments` are allowed; do not add
`export`, quotes are optional, and a value cannot span lines. If you open a new
terminal later, run the first line again.

## Step 2: Cloudflare account ID and API token

`CLOUDFLARE_ACCOUNT_ID`: sign in at [dash.cloudflare.com](https://dash.cloudflare.com),
open **Workers & Pages**, and copy **Account ID** from the right-hand column (or
choose **Copy account ID** from the account's menu on **Account home**).

`CLOUDFLARE_API_TOKEN`: open [API Tokens](https://dash.cloudflare.com/profile/api-tokens),
choose **Create Token**, then **Create Custom Token**. Name it `Lamp deploy` and
add these four **Account** permissions, each set to **Edit**: **Workers Scripts**,
**D1**, **Workers R2 Storage** and **Queues**. Under **Account Resources** include
your account. If you will use your own domain (step 3), also add the **Zone**
permission **Workers Routes**: **Edit** for that domain's zone. Choose
**Continue to summary**, then **Create Token**, and copy the token: Cloudflare
shows it only once.

```text
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=synthetic-your-cloudflare-api-token
```

## Step 3: Your two addresses

Lamp has two addresses: `LAMP_APP_HOST`, where you and your team sign in, and
`LAMP_PAGE_HOST`, where customers read your status page. Write them as bare
host names, with no `https://`, port or path.

**Quickest: Cloudflare's free `workers.dev` addresses.** In **Workers & Pages**,
the overview shows your account's subdomain as `<subdomain>.workers.dev`; if it
asks you to choose one first, choose it. For the `production` installation use:

```text
LAMP_HOSTING=workers-dev
LAMP_APP_HOST=lamp-production.<subdomain>.workers.dev
LAMP_PAGE_HOST=lamp-production-page.<subdomain>.workers.dev
```

Replace `<subdomain>` with yours. The names must be exactly `lamp-<environment>`
and `lamp-<environment>-page`; for `--environment staging` they start with
`lamp-staging`. The [deployment reference](deployment-reference.md#find-your-workersdev-hostnames)
also shows a command that prints your subdomain.

**Your own domain:** leave out `LAMP_HOSTING`, set two different names on a domain
whose DNS is on Cloudflare, such as `ops.example.com` and `status.example.com`,
and follow [Hostnames and your own domain](domains.md) first.

## Step 4: Your page

```text
LAMP_PAGE_NAME=Acme Status
LAMP_PAGE_TAGLINE=Service updates for Acme customers
LAMP_PAGE_TIMEZONE=Europe/London
LAMP_ACCENT_COLOR=#16794C
```

`LAMP_PAGE_NAME` is the page's title (up to 120 characters) and
`LAMP_PAGE_TAGLINE` the sentence under it. `LAMP_PAGE_TIMEZONE` is the time zone
your page shows times in, as a name from the
[time zone list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
such as `America/New_York`. `LAMP_ACCENT_COLOR` is your brand colour: `#` and
six hex digits. You can change all four later in **Settings**.

## Step 5: You, the owner

```text
SETUP_OPERATOR_EMAIL=owner@example.com
OWNER_DISPLAY_NAME=Alex Morgan
```

`SETUP_OPERATOR_EMAIL` is your own address: you become the page's owner and sign
in with it. `OWNER_DISPLAY_NAME` is optional (the name shown for you; `Owner`
when left out).

## Step 6: Mail

Lamp sends mail through SendGrid or Resend from an address on a domain you have
authenticated there. Authenticate the exact domain of your sender address: for
`status@example.com` that is `example.com`; for `status@mail.example.com` it is
`mail.example.com`.

### Authenticate your domain at SendGrid

1. Sign in at [app.sendgrid.com](https://app.sendgrid.com) and open **Settings →
   Sender Authentication**. Under **Domain Authentication** choose **Get Started**
   (or **Authenticate Your Domain**).
2. Choose your DNS host (choose **Cloudflare** if your DNS is there), answer **No**
   to link branding, and choose **Next**.
3. Enter your sending domain. Leave **Use automated security** on and the DKIM
   selector as SendGrid offers it (`s1`). Choose **Next**.
4. SendGrid shows three **CNAME** records: `em…`, `s1._domainkey` and
   `s2._domainkey`. Add each at your DNS host with the name and value exactly as
   shown. In Cloudflare DNS, set each to **DNS only** (grey cloud), not proxied.
5. Add a DMARC record if your domain has none: a **TXT** record named `_dmarc`
   (on the same sending domain) with the value `v=DMARC1; p=none;`.
6. Back in SendGrid, tick that you added the records and choose **Verify**. DNS
   can take a few minutes; choose **Verify** again until every record is verified.
7. Open **Settings → API Keys → Create API Key**, name it `Lamp`, choose
   **Restricted Access**, set **Mail Send** to **Full Access** and **Sender
   Authentication** to **Read Access**, then **Create & View**. Copy the key:
   SendGrid shows it only once.

```text
MAIL_PROVIDER=sendgrid
MAIL_FROM_ADDRESS=status@example.com
MAIL_DKIM_SELECTOR=s1
MAIL_PROVIDER_API_KEY=synthetic-your-mail-provider-api-key
```

`MAIL_FROM_ADDRESS` is any address on the domain you authenticated; replies to
your emails go there. `MAIL_DKIM_SELECTOR` is the part before `._domainkey` in
the records SendGrid gave you (`s1`).

### Or use Resend

At [resend.com](https://resend.com), open **Domains → Add Domain**, enter your
sending domain and add the records it shows at your DNS host (one of them is a
**TXT** record named `resend._domainkey`), add the `_dmarc` record from step 5
above if you have none, then choose **Verify DNS Records**. Create a key under
**API Keys** with **Sending access**. Then set `MAIL_PROVIDER=resend`,
`MAIL_DKIM_SELECTOR=resend`, your sender address and the key. Leaving out
`MAIL_PROVIDER` also means Resend.

### Or use Managed hosting

With [Managed hosting](https://runeditrun.com/pricing) Run Edit Run provides the
mail: you skip this step, and Run Edit Run fills `MAIL_PROVIDER=rer`, `MAIL_FROM`,
`MAIL_RELAY_URL` and the private `MAIL_API_KEY` for you.

Before it creates anything, a real deploy checks that a DKIM key answers at
`<selector>._domainkey.<your sending domain>` and a DMARC policy at
`_dmarc.<your sending domain>`, and says which record to fix if one is missing.
SPF at your sending domain is not required.

## Step 7: Check, then deploy

From the Lamp folder:

```sh
rer deploy --dry-run --environment production --env-file "$LAMP_DEPLOY_ENV"
```

The dry run checks the file and builds Lamp on your computer without contacting
Cloudflare. If an input is missing it lists each one by name with the step that
explains it; add them and run it again. When it passes, deploy:

```sh
rer deploy --environment production --env-file "$LAMP_DEPLOY_ENV"
```

The deploy checks your mail DNS, creates Lamp's database, file storage and queue
in your Cloudflare account, uploads Lamp and checks it is healthy. It ends by
naming the address to sign in at (your `LAMP_APP_HOST`). It generates the four
signing secrets `SETUP_TOKEN`, `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET` and
`WEBHOOK_SIGNING_SECRET` and keeps them in `.rer/deploy/production.secrets.env`
in the Lamp folder; a later deploy reuses them.

`--environment` names this installation; it defaults to `production`. Use
another name, with its own input file and step 3 addresses, for a second one.

## Step 8: Sign in

Open `https://<LAMP_APP_HOST>`, enter your `SETUP_OPERATOR_EMAIL` and open the
link Lamp emails you. To get in without waiting for email, run this from the
same folder and open the link it prints within 15 minutes; it works once:

```sh
rer signin --environment production --env-file "$LAMP_DEPLOY_ENV"
```

First-run setup then walks you through your components. Your public page is at
`https://<LAMP_PAGE_HOST>`. See [terminal entry](operators-and-sign-in.md#terminal-entry-for-the-hosted-owner)
for details of `rer signin`.

## After the first deploy

Deploy again with the same command after you change inputs or update Lamp
([Update Lamp](updating.md) shows the backup to take first). A redeploy keeps the
`SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` each
Lamp Worker already holds, so emailed Manage and Unsubscribe links and operator
sessions keep working, and the deploy says which it kept. The same holds for
`OIDC_TRANSACTION_SECRET` with [single sign-on](operators-and-sign-in.md#optional-single-sign-on).

**Keep the secrets with your input file.** To restore into a new installation
([Backups and recovery](backups-and-recovery.md)) you need the original values.
`.rer/deploy/production.secrets.env` holds the three that last:
`SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` (the
setup token is used once, for the owner claim, and removed). Keep a copy of that
file with your input file, or generate all four into the input file before the
first deploy with this loop (it uses only `od` and `tr` and prints nothing):

```sh
for name in SETUP_TOKEN SESSION_SECRET SUBSCRIBER_TOKEN_SECRET WEBHOOK_SIGNING_SECRET; do
  printf '%s=%s\n' "$name" "$(od -An -vtx1 -N32 /dev/urandom | tr -d ' \n')" >> "$LAMP_DEPLOY_ENV"
done
```

To replace one on purpose (for example after a leak), put its new value in the
file and add `LAMP_REPLACE_SECRETS=SESSION_SECRET` (comma-separated names) for
that one deploy, or run `rer deploy --environment production --env-file "$LAMP_DEPLOY_ENV" --rotate-secret SESSION_SECRET`
for a value rer generated. Replacing `SUBSCRIBER_TOKEN_SECRET` ends every emailed
subscriber link; replacing `SESSION_SECRET` signs every operator out.

Instead of the file you can export the same names in your shell and run
`rer deploy` without `--env-file`; file values win over exported ones. Never
commit the file or paste its values into logs.

A healthy deploy does not prove email arrives. Subscribe yourself on the public
page, publish a test incident and check the email arrives. Without a provider
webhook key the delivery log's last status is **Accepted by SendGrid** (or
**Accepted by Resend**); to record delivered, bounced and complained, add
`SENDGRID_WEBHOOK_PUBLIC_KEY` or `RESEND_WEBHOOK_SECRET` and the provider webhook
described in [Owner inputs](../OPERATIONS.md#owner-inputs). Run `rer verify`
separately for Lamp's full source and browser checks; a deploy does not run them.
The [deployment reference](deployment-reference.md) lists every input, required
and optional.

## Remove an installation

Back up anything you want to keep first ([Backups and recovery](backups-and-recovery.md)).
Removal runs on Node 22 or later rather than through `rer`. Check with
`node --version`; if it is missing or older (the Run page's installer keeps its
Node private to `rer`), install Node 22 from [nodejs.org](https://nodejs.org/en/download)
or your package manager and open a new terminal. Then, from the Lamp folder that
deployed it, with the same environment and input file:

```sh
node scripts/remove-deployment.mjs --environment production --env-file "$LAMP_DEPLOY_ENV" --yes
```

It removes the public page Worker, then the app Worker with its database, files
and queue, saying which it is doing (each can take a few minutes), and reads back
that none remains. In custom-domain mode there is one Worker. `rer deploy --remove
--yes` alone does not remove the separate public page Worker of a `workers.dev`
installation, so use this command.

Removal only touches what its creation records prove this environment created;
it never matches by name. If an older installation has no creation records, the
command refuses; see the [removal limits](deployment-reference.md#removal-and-deployment-records).
