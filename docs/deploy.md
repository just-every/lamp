# Deploy to Cloudflare

First configure the private values in [Install Lamp](install.md), then verify
the exact hosts and required inputs in the [deployment reference](deployment-reference.md).
Before commands that build or verify the checkout, stop a running development
server with `rer dev --stop` or a production preview with `rer preview --stop`.

```sh
rer deploy --dry-run
rer deploy
```

Lamp uses the npm package `@runeditrun/rer` 0.2.8. Deploy runs Lamp's build,
migration application and deployment health checks; the full verifier runs in
CI and through `rer verify`, independently of deployment.

The dry run validates and compiles locally without contacting Cloudflare. A
real deploy validates owner inputs, provisions or reuses resources, applies
migrations, builds and uploads the Worker with secrets, initializes ownership and
checks application health. Run `rer verify` separately for the full source and
browser checks. Afterward,
check the public page and operator sign-in on their selected hosts. A successful
health check does not prove inbox delivery; verify the installation's configured
mail path separately.

For a custom domain, follow [Hostnames and your own domain](domains.md). For
owner-side provisioning, backups and recovery, see the technical
[operations reference](../OPERATIONS.md).
