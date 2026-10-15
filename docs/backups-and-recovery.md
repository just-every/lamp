# Backups and recovery

For local installations, use the [safe local backup and restore sequence](../RUN-LOCALLY.md#back-up-and-restore-local-data). Stop a running development
server with `rer dev --stop` or a running preview with `rer preview --stop`
before exporting, transferring an archive or resetting data. Export before
reset, import only into an empty destination, then run `rer setup` with the
original or restored owner's email before restarting Lamp.

`rer export` and `rer import` operate on the local installation. They do not
archive a deployed Cloudflare environment. For a deployed installation, use the
technical [Cloudflare archive and restore procedure](../OPERATIONS.md#portable-backups-and-restore);
it documents the supported owner-side tooling and restore preconditions. A
remote Cloudflare export/import verb is not provided by the `rer` command.

Keep the archive and private deployment inputs together for recovery. A local
verification or export does not prove a deployed restore or provider acceptance.

## Retire a hosted installation

Back up and retain the private deployment inputs before deleting resources.
Use Lamp's [native removal command](deploy.md#remove-an-installation) with the
original checkout, account and environment. It removes both Workers in
`workers-dev` mode and the resources its creation records prove it owns. The
generic `rer deploy --remove --yes` alone leaves the separate public Worker.
Lamp's native archive record is separate; older installations without creation
records need the [manual removal limits and procedure](deployment-reference.md#removal-and-deployment-records).
