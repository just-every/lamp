# Install Lamp

Lamp can run in a local checkout or in your Cloudflare account. For the local
path, follow [Run it locally](../RUN-LOCALLY.md). A deployment creates separate
hostnames for the public status page and the operator app.

## Prepare a deployment

Choose two distinct hostnames and configure the private owner inputs for the
Cloudflare account, page branding, first operator, and verified email sender.
The required inputs are `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
`LAMP_PAGE_HOST`, `LAMP_APP_HOST`, `LAMP_PAGE_NAME`, `LAMP_PAGE_TAGLINE`,
`LAMP_PAGE_TIMEZONE`, `LAMP_ACCENT_COLOR`, `SETUP_OPERATOR_EMAIL`,
`MAIL_FROM_ADDRESS`, `MAIL_DKIM_SELECTOR`, `MAIL_PROVIDER_API_KEY`,
`SUBSCRIBER_TOKEN_SECRET`, and `WEBHOOK_SIGNING_SECRET`. Keep credentials and
secrets outside the repository.

`MAIL_PROVIDER` selects Resend (the default) or SendGrid. Lamp checks the sender
domain's SPF, DKIM and DMARC records during setup. That check does not prove
recipient delivery; verify the configured sender on the deployed installation.

For deployment steps and hostnames, see [Deploy Lamp](deploy.md). The
[deployment reference](deployment-reference.md) lists native command effects
and required private inputs; owner-side provisioning details are in the
technical [operations reference](../OPERATIONS.md).
