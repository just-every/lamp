# Update Lamp

Before changing source, keep a copy of the current source revision and use the
appropriate [backup and recovery procedure](backups-and-recovery.md) for the
installation you are updating. Preserve applied migration history and apply
later migrations in order.

## Update a local installation

Update the checkout to the source revision you plan to adopt. Keep its existing
local data in place; run the canonical backup and restore sequence if moving it
to another checkout. Before install, build or verification, stop the active
development server with `rer dev --stop` or the production preview with
`rer preview --stop`. Then run `rer install`, `rer setup` and `rer verify` from
the updated source, check the owner workflows affected by the update, and
resume local work with `rer dev`. The [local guide](../RUN-LOCALLY.md) has the
exact recovery commands.

## Update a Cloudflare installation

Keep the deployment's private owner inputs outside source control. Back up the
deployed data with the technical Cloudflare procedure before migration. Before
the deploy build, stop any local development server with `rer dev --stop` or
production preview with `rer preview --stop`. Run `rer deploy` from the updated
source to verify, apply migrations and publish the Worker, then check the public
page, operator sign-in and configured delivery paths. A source verifier pass
does not establish live provider acceptance.
