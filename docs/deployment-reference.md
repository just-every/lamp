# Deployment reference

Lamp's native deployment commands are:

```sh
rer deploy --dry-run
rer deploy
```

Before a command that builds or verifies the checkout, stop a running development
server with `rer dev --stop` or a production preview with `rer preview --stop`.
The dry run builds and validates locally without a Cloudflare request. A deploy
verifies the source, provisions or reuses Cloudflare resources, applies
migrations, initializes ownership and checks application health. These commands
are for a Cloudflare installation; the separate [local guide](../RUN-LOCALLY.md)
covers local launch and recovery.

Keep these required values in private deployment inputs outside the repository:
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `LAMP_PAGE_HOST`,
`LAMP_APP_HOST`, `LAMP_PAGE_NAME`, `LAMP_PAGE_TAGLINE`, `LAMP_PAGE_TIMEZONE`,
`LAMP_ACCENT_COLOR`, `SETUP_OPERATOR_EMAIL`, `MAIL_FROM_ADDRESS`,
`MAIL_DKIM_SELECTOR`, `MAIL_PROVIDER_API_KEY`, `SUBSCRIBER_TOKEN_SECRET` and
`WEBHOOK_SIGNING_SECRET`. The [install guide](install.md) explains sender checks,
hostnames and custom domains. A successful deploy health check does not prove
mailbox delivery.

For native `workers.dev` hosting, set `LAMP_HOSTING=workers-dev`. The app host
is `<prefix>.<subdomain>.workers.dev` and the page host is
`<prefix>-page.<subdomain>.workers.dev`, using the account's Workers subdomain.
The prefix comes from `LAMP_RESOURCE_PREFIX` or defaults to
`lamp-<environment>`; the environment defaults to `production`.

The [technical operations reference](../OPERATIONS.md) documents owner-side
Cloudflare provisioning, archives and recovery.
