<p align="center">
  <a href="https://justevery.com/#vol-lamp">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.webp">
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.webp">
      <img src=".github/assets/banner-light.webp" width="100%" alt="Lamp: When something breaks, turn the light on.">
    </picture>
  </a>
</p>

<p align="center"><a href="https://justevery.com">Part of Just Every</a> · <a href="LICENSE">MIT licensed</a></p>

# Lamp

Lamp is a self-hosted status page and incident communication desk for one
business. The operator app manages components, incidents, maintenance and
subscriber communication; its separate page host serves customer-facing status
information.

## Owner guides

The app host serves Lamp's public documentation at `/docs`. Start with the
[overview](docs/overview.md), then choose a task:

- [Install](docs/install.md) or [run Lamp locally](RUN-LOCALLY.md).
- [First-run setup](docs/first-run.md), [components and groups](docs/components-and-groups.md),
  [incidents and updates](docs/incidents-and-updates.md), and [maintenance](docs/maintenance.md).
- [Public page](docs/public-page.md), [subscribers and notifications](docs/subscribers-and-notifications.md),
  [monitoring alerts](docs/alerts-from-monitoring-tools.md), and [operators](docs/operators-and-sign-in.md).
- [Domains](docs/domains.md), [move-in](docs/moving-in.md),
  [backups and recovery](docs/backups-and-recovery.md), and [updating](docs/updating.md).

## Deploy and verify

Configure private deployment inputs outside the repository, then use the
installed commands. Before a command that builds or verifies the checkout,
stop a running development server with `rer dev --stop` or a production preview
with `rer preview --stop`.

```sh
rer deploy --dry-run
rer deploy
```

The dry run validates and compiles locally without contacting Cloudflare. A
deployment verifies the source, provisions or reuses resources, applies
migrations and checks application health. Follow the [deployment guide](docs/install.md)
for owner inputs and the [domain steps](docs/domains.md) before routing visitors.

Before `rer verify`, stop the active development server or production preview
with the corresponding command above. A passing source verifier does not
establish hosted readiness or provider delivery; record each installation's
acceptance evidence separately in [ACCEPTANCE.md](ACCEPTANCE.md).

## Your own domain

The public and operator hosts must be distinct. See [Hostnames and your own domain](docs/domains.md)
for Cloudflare zone and DNS steps.

## Maintainer references

- [CONTRACT.md](CONTRACT.md) defines Lamp's product behavior; [BASELINE.md](BASELINE.md)
  holds the shared security and data guarantees.
- [OPERATIONS.md](OPERATIONS.md) is the technical reference for Cloudflare
  provisioning, remote archives and recovery. Local data recovery uses the
  [canonical local sequence](RUN-LOCALLY.md#back-up-and-restore-local-data).
- [AUTHORING.md](AUTHORING.md) explains source selection and publication.
- [CHANGELOG.md](CHANGELOG.md), [RELEASE.json](RELEASE.json), and
  [HANDOVER.md](HANDOVER.md) record release and adoption information.

Preserve applied migration history. Back up data and the source revision before
an update, restore into an empty destination when needed, and verify the exact
candidate before adoption.
