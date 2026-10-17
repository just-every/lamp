# Backups and recovery

Lamp gives you two kinds of copy:

- **Page data**, from the app: one JSON file with everything your status page
  holds. Download it any time from **Settings**, and restore it into a new Lamp,
  hosted or local, from the same place. No terminal needed.
- **A full archive**, from the terminal: every table, file and record of an
  installation, including sign-in and delivery records, for a like-for-like
  restore of a local or hosted installation.

## Export your page data from the app

Sign in and open **Settings → Export page data → Download page data**. The file,
`lamp-page-data-<date>.json`, holds:

- page settings (name, tagline, colour, time zone, footer credit, widget origins,
  AI tone) and the logo;
- component groups and components, with their current status and status history;
- incidents with every update, unpublished draft, internal note and post-incident
  report;
- maintenance windows with their notices;
- subscribers: email address or webhook, chosen components and consent state
  (subscribed, confirmed, or when and why they left);
- incident and maintenance reference numbers, so new ones continue from yours.

It leaves out operator sign-in and sessions, delivery logs, alert sources, Slack
and Teams channels, incident attachments, move-in history, and mail and AI
settings. The file holds your subscribers' addresses: keep it private.

### The file format

The file is JSON in Lamp's `lamp-page-data` format, version 1:

| Key | Holds |
|---|---|
| `format`, `version` | `"lamp-page-data"` and `1`. |
| `exportedAt`, `contents` | When it was made, and a sentence naming what it holds. |
| `page` | `pageName`, `tagline`, `accentColor`, `timezone`, `footerCreditEnabled`, `widgetAllowedOrigins`, `aiToneInstructions`, `feedId` (your Atom feed's identity) and `logo` (`contentType` and `base64` bytes, or `null`). |
| `people` | `email` and `displayName` of each operator who wrote a record. |
| `records` | One list of rows per Lamp table, keyed by table name, with each row's columns as Lamp stores them: `component_groups`, `components`, `component_standing_claims`, `component_claim_events`, `component_state_history`, `component_state_corrections`, `incidents`, `incident_components`, `incident_updates`, `incident_drafts`, `incident_internal_notes`, `incident_reports`, `maintenance`, `maintenance_components`, `maintenance_notices`, `import_maintenance_updates`, `subscribers`, `subscriber_components`, `reference_allocations` and `reference_counters`. |

Rows name their author by email (`operator_email`, `created_by_email`,
`author_email`) instead of an installation's operator ID. Each subscriber row
adds `confirmed_at`, the time they confirmed by email, or `null`; its `state` is
`pending`, `active` or `deactivated`, with `deactivation_reason` and
`deactivated_at` for someone who left.

### Restore page data into a new Lamp

Restore into a new installation before you add components, incidents,
maintenance or subscribers to it: a local one (`rer dev`) or a hosted one
([Deploy to Cloudflare](deploy.md)), after its first sign-in. Open **Settings →
Restore page data**, choose the file and **Check file**: Lamp counts what the
file holds and says whether this page can take it, without writing anything.
Then choose **Restore page data**. It restores everything in one step or nothing
at all, and rebuilds the public page.

Afterwards a fresh **Download page data** gives back the same file, apart from
`exportedAt`. Subscribers keep their state and are not emailed. Links in emails
the old page sent stop working; every later email carries new ones. Webhook
subscribers verify signatures with the new installation's signing secret. Authors
who are not operators on the new page are listed as former operators: their
records keep their name, and they cannot sign in unless you invite them.

## Back up a hosted installation

These commands run on Node 22 or later. Check with `node --version`; if it is
missing or older (the Run page's installer keeps its Node private to `rer`),
install Node 22 from [nodejs.org](https://nodejs.org/en/download) or your package
manager and open a new terminal. Run them from the Lamp folder that deployed the
installation, with its environment name and [private input file](deploy.md#step-1-make-a-private-input-file),
after `rer install`:

```sh
node scripts/export.mjs --remote --environment production --env-file "$LAMP_DEPLOY_ENV" --out "$HOME/lamp-backups/production-$(date +%Y%m%d-%H%M)"
```

It writes a new folder holding every database table, every stored file with its
metadata, and a `manifest.json` with checksums and the migrations the data needs.
The folder must not exist yet or be empty. Keep it private: it holds subscriber
addresses, sessions and sent mail. Pause operator work while it runs; the
database is read in one transaction, but files are copied after it. Keep your
input file and [its signing secrets](deploy.md#after-the-first-deploy)
with the archive.

## Restore a hosted installation

A full archive restores into a new, empty installation, never over a running
one. Give it a new environment name, such as `recovery`, and its own input file
with the original signing secrets, so emailed subscriber links and operator
sessions keep working. From the Lamp folder that deployed the original:

```sh
cp "$HOME/.config/lamp/production.env" "$HOME/.config/lamp/recovery.env"
cat .rer/deploy/production.secrets.env >> "$HOME/.config/lamp/recovery.env"
```

Skip the second line if your input file already holds `SESSION_SECRET`,
`SUBSCRIBER_TOKEN_SECRET` and `WEBHOOK_SIGNING_SECRET` (a name may appear only
once). Then edit `recovery.env` and set the new installation's two addresses
([step 3](deploy.md#step-3-your-two-addresses), with `recovery` in place of
`production`). Restore and publish:

```sh
node scripts/setup.mjs --environment recovery --env-file "$HOME/.config/lamp/recovery.env" --restore-from "$HOME/lamp-backups/production-20261017-0930"
rer deploy --environment recovery --env-file "$HOME/.config/lamp/recovery.env"
```

The first command creates the new database, storage and queue, checks the
archive's checksums and migrations, and imports it; it never publishes Lamp and
refuses a destination that already holds data. The second publishes the restored
installation. Sign in, check the public page and a publication, then move your
addresses or DNS to it. Keep the old installation running until you have. If a
restore stops part-way, keep the archive and restore into another new
environment name; do not route visitors to the partial one.

## Back up and restore a local installation

Use the [local backup and restore sequence](../RUN-LOCALLY.md#back-up-and-restore-local-data)
(`rer export` and `rer import`). Stop a running development server with
`rer dev --stop` or a running preview with `rer preview --stop` before exporting,
transferring an archive or resetting data. Export before reset, import only into
an empty destination, then run `rer setup` with the original or restored owner's
email before restarting Lamp. `rer export` and `rer import` work on the local
installation only; the commands above cover a hosted one.

The [operations reference](../OPERATIONS.md#portable-backups-and-restore) has
the technical details of the archive.

## Retire a hosted installation

Back up first, and keep your private input file. Then use Lamp's
[removal command](deploy.md#remove-an-installation) from the folder that
deployed it, with the same environment. It removes both Workers in `workers.dev`
mode and the resources its creation records prove it owns. The generic
`rer deploy --remove --yes` alone leaves the separate public page Worker. Older
installations without creation records need the [manual removal limits and procedure](deployment-reference.md#removal-and-deployment-records).
