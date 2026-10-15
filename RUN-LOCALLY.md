# Run it locally

Use `rer` from the project root. The checkout pins its own `@runeditrun/rer`
version; `rer describe` reports the commands and tooling in use. Lamp runs on
your computer without a Cloudflare account or mail credentials; development mail
is captured in the local outbox.

## Start Lamp

```sh
rer dev
```

On first launch, `rer dev` installs locked dependencies and prepares a local
owner automatically. It prints the local operator entry address and a `RER_READY`
line when the app is ready. Open that entry
address to work as the owner. For email sign-in journeys, open `/signin` and
check the development outbox shown by `rer outbox`; local mail is not delivered
to an inbox.

The operator app uses `127.0.0.1`; the public status page uses `localhost` on the
same port. `rer dev --stop` stops development and `rer preview --stop` stops the
fixed production preview. If a port is already occupied, choose another with
`--port P`.

## Back up and restore local data

Stop the active server before exporting, importing, transferring an archive or
resetting data. If `rer dev` is running, stop it with `rer dev --stop`; if
`rer preview` is running, use `rer preview --stop` instead. Export the archive
before any reset. The following sequence restores this checkout and signs back
in as the owner recorded in the archive:

```sh
rer dev --stop
rer export --output exports/lamp.rer
rer reset --yes
rer import --input exports/lamp.rer --yes
rer setup
rer dev
```

When `rer setup` asks, use the original owner's email from before the reset.
After an import, run setup before restarting Lamp so its local private settings
match that restored owner.

To move the archive to a fresh checkout, stop the source server before exporting.
Copy the archive into the destination checkout at `exports/lamp.rer` (create the
folder there if needed). On the destination, keep the local install empty: do
not run setup or create records before import. Then install the project, import,
run setup with the same owner, and start Lamp:

```sh
rer install
rer import --input exports/lamp.rer --yes
rer setup
rer dev
```

These `rer export` and `rer import` commands move a local installation. They do
not back up or restore a deployed Cloudflare installation; see [Backups and
recovery](docs/backups-and-recovery.md) and the technical [Cloudflare archive
reference](OPERATIONS.md#portable-backups-and-restore).

Run `rer describe` for the installed command and flag reference.
