# Deployment reference

Use `rer deploy` from the project root. The checkout pins
`@runeditrun/rer` 0.2.20; use `rer describe` and `rer deploy --help` for the installed
command reference. The [deployment guide](deploy.md) gives a complete private
`0600` input file, validation, deploy and removal commands. `--env-file` values
override the calling shell's exported values.

## Inputs you supply and values rer generates

Hosted Lamp requires mail. Generated signing secrets do not replace a provider
API key or authenticated sender.

| Input | What you supply |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Credentials for the intended account; account ID is available on its overview. |
| `LAMP_APP_HOST`, `LAMP_PAGE_HOST` | Two distinct bare hostnames, without scheme, port or path. Both remain required with `LAMP_HOSTING=workers-dev`. |
| `LAMP_PAGE_NAME`, `LAMP_PAGE_TAGLINE` | Your business's page name and description. |
| `LAMP_PAGE_TIMEZONE`, `LAMP_ACCENT_COLOR` | An IANA time zone and a six-digit hex colour, such as `Europe/London` and `#16794C`. |
| `SETUP_OPERATOR_EMAIL` | The first owner's email address. Supply it explicitly for Lamp's native deployment. |
| `MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR`, `MAIL_PROVIDER_API_KEY` | Your provider-authenticated sender, its DKIM selector and the selected provider's API key. These are required owner inputs. |
| `MAIL_PROVIDER` | `resend` (native default) or `sendgrid`. Set explicitly to match the API key. |
| `SETUP_TOKEN`, `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET`, `WEBHOOK_SIGNING_SECRET` | Required runtime secrets. `rer deploy` generates fresh random values when absent; they are not mandatory manual inputs for a first deployment. For repeatable native redeploys, terminal recovery and restores, supply and retain your original values as shown in the deployment guide. Each must be at least 32 characters. |
| `OWNER_DISPLAY_NAME` | Optional first-owner name; the native default is `Setup operator`. |
| `LAMP_HOSTING` | `custom-domain` (default) or `workers-dev`. |
| `LAMP_RESOURCE_PREFIX` | Optional resource namespace: lowercase letters, digits and hyphens, at most 47 characters. Defaults to `lamp-<environment>`. |
| `SENDGRID_WEBHOOK_PUBLIC_KEY` or `RESEND_WEBHOOK_SECRET` | Optional at deploy time, required for accepting the selected provider's signed delivery receipts. Without it, feedback callbacks are rejected. |

The native pipeline's required-environment list includes the generated secrets
because the runtime needs them; `rer` supplies them before invoking that pipeline.
Direct `setup:cloudflare` or `deploy:cloudflare` scripts do not perform that CLI
generation. They need those values already exported. The native upload uses the
values supplied to that run, so retain the original session, subscriber and
webhook secrets rather than omitting them on a redeploy.

AI configuration, optional identity providers, event relay and external heartbeat
are described in the [technical operations reference](../OPERATIONS.md). They
are not required for a hosted status page.

## Find your workers.dev hostnames

Choose the intended Cloudflare account and open **Workers & Pages** in its
dashboard. Read **Your subdomain** on that account page; it identifies the
registered `workers.dev` subdomain, which is distinct from the account name and
account ID. If the account has none, create its Workers subdomain there before
deploying. Lamp does not create or change this account-wide setting. See
[Cloudflare's workers.dev instructions](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

You can also read the registered subdomain through the Cloudflare API. With
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` exported in your private shell,
the following makes a read-only request and prints only the subdomain:

```sh
curl --fail --silent --show-error \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
  | node --input-type=module -e '
    let body = "";
    for await (const chunk of process.stdin) body += chunk;
    const data = JSON.parse(body);
    if (!data.success || !data.result?.subdomain) {
      throw new Error("No Workers subdomain returned; check the account and token permissions.");
    }
    console.log(data.result.subdomain);
  '
```

The API token needs **Workers Scripts Read** or **Workers Scripts Write** for
this [subdomain lookup](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/).
A private `--env-file` is read by `rer`, not by `curl`; export these two
credentials for this alternative.

For environment `production`, the default prefix is `lamp-production`. If your
registered subdomain is `my-account`, use these input-file values:

```text
LAMP_HOSTING=workers-dev
LAMP_APP_HOST=lamp-production.my-account.workers.dev
LAMP_PAGE_HOST=lamp-production-page.my-account.workers.dev
```

For a different namespace, add `LAMP_RESOURCE_PREFIX=my-status` and set the hosts
to `my-status.my-account.workers.dev` and
`my-status-page.my-account.workers.dev`. The two hostname values are still
required; Lamp validates their exact match with the generated Worker names and
checks the registered account subdomain during real setup. A dry run checks the
naming pattern but does not query the account.

Use `--environment staging` for a separate installation; without an explicit
prefix its hosts start with `lamp-staging` and `lamp-staging-page`. An explicit
prefix replaces that environment-derived namespace, so give each installation
a distinct prefix. The app Worker is `<prefix>`, the public Worker is
`<prefix>-page`, D1 is `<prefix>-db`, R2 is `<prefix>-files` and the Queue is
`<prefix>-jobs`. Custom-domain hosting uses one Worker for both hosts.

## Removal and deployment records

Run Lamp's [native removal command](deploy.md#remove-an-installation) from the
deploying checkout with the original account, environment and private input file:

```sh
node scripts/remove-deployment.mjs --environment production --env-file "$HOME/.config/lamp/production.env" --yes
```

In `workers-dev` mode, this removes the public Worker first, then the app Worker
and its owned data resources, reading back their absence. Custom-domain mode has
one Worker. Removal uses separate creation records for the two Workers; it never
infers ownership from matching names. Reused or unrecorded resources need separate
inspection. There is no removal dry run. The generic `rer deploy --remove --yes`
handles the app's recorded topology and does not retire Lamp's separate public
Worker.

Lamp's native provisioning records live at `.seed/deployment/<environment>.json`.
They identify resources for archives and recovery but are not creation-ownership
records. New native deployments retain the app's ownership record under
`.rer/deploy/<environment>.json` and a separate public Worker record when using
`workers-dev` at `.rer/deploy/<environment>.page.json`. Keep these private records
with the deploying checkout. Older
installations without creation records are refused by automated removal; resource
names or the archive record alone cannot prove what Lamp created. A missing
record can also follow a preflight failure and does not prove that no resources
exist.

For a native installation without a `rer` ownership record, back up first,
inspect its `.seed/deployment/<environment>.json` and the Cloudflare dashboard,
and retire only the confirmed installation resources there. Include both app
and public Workers in `workers-dev` mode, their hostname attachments, the D1
database, R2 bucket and Queue. Preserve any reused resources belonging to another
installation. Keep the account's shared `workers.dev` subdomain. After removal,
check that the selected Workers and owned storage resources are gone.
