# Vendor status format fixtures

These small fixtures preserve the fields read at each vendor's public status
source. Record names, titles and identifiers are synthetic. Each case changes
one native state in the recorded structure and records an independent expected
Lamp component state. They are deterministic format proof, not live provider
availability or delivery proof.

The public sources are listed in each fixture and in
`./src/core/features/dependencies/formats/catalog.json`, which also holds the
mapping table displayed to operators. Statuspage component and aggregate states
are checked separately. Empty public RSS feeds use the same recorded channel
structure with synthetic incident items for state variations.

AWS Health publishes service and region feeds on `https://status.aws.amazon.com`.
The catalog defaults to the EC2 us-east-1 feed; operators can choose the feed for
their service and region. The public dashboard on `https://health.aws.amazon.com`
does not serve those RSS paths. Auth0's machine-readable public source uses its
`https://auth0.statuspage.io` origin. Okta embeds its public incident records in
the incident span of its status document; Lamp reads only that document and
never calls an authenticated Okta API. PagerDuty publishes its current service
impacts at its public impacted-services endpoint and the corresponding enum
table at its public post-enums endpoint. The reader obtains both at the same
declared status origin; missing or unknown impact enums fail the read.

The generic RSS and Atom reader keeps the newest report for each incident
identity and combines the remaining active reports. It uses explicit status or
category values where present, then resolved, maintenance and outage markers in
the title. An unmarked incident report is Degraded performance. An empty valid
feed is Operational; malformed responses fail the read. Operators should select
a status feed whose updates retain the incident GUID, Atom ID or link, so a
recovery clears its own incident without clearing unrelated active incidents. JSON
sources require an explicit dotted state path and an explicit mapping; unknown
states and absent paths fail the read.

`node scripts/validate-release.mjs` loads every catalog fixture, requires a case
for every mapped native state and checks the parsed outcome against its saved
expectation. Missing fixture files or mapping tables refuse the release.
