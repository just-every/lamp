# Contract document workflow

Current acceptance text and status live in CONTRACT.md. Run its supported write and check commands before the edition lock; the shared parser also drives release and verification readers.

## Historical source workflow

The following paragraphs record the superseded bullet/heading convention; current-format clauses use the shared standard.

Lamp has two kinds of clause, and they look different on purpose.

*Released clauses* are bullet items whose bold lead is the clause ID and title. Each one is a guarantee of the current release and has at least one tagged test. `pnpm verify` refuses a released clause that has no planned tagged journey (`scripts/verification/check-plan.mjs`). `pnpm validate:release` requires `RELEASE.json` to record every released clause added, changed or removed since the previous snapshot in `release-history/`.

*Target clauses* are level-four headings (`#### AREA-NNN — Title.`) under each area's "target" heading. Each one gives the behavior a buyer gets, its acceptance evidence (the journey or test through a public door that proves it) and its status: done, partial or missing, judged from the code and tests at the commit named in the status table. A target clause is not yet a release guarantee. The release that builds one moves it into bullet form with its tagged test and an `added` entry in `RELEASE.json`. When a target clause replaces released wording (for example TEAM-004 replaces TEAM-001's "There are no roles"), that release records the released clause as `changed` and removes the matching `seed.json → nonGoals` entry.

Every released clause has a stable ID and at least one tagged test; `pnpm verify` reports each as satisfied, overridden, or broken. Security, privacy, and operational guarantees are in `BASELINE.md`; a released clause here may supersede one of them by naming its `BASE-` ID (PAGE-008, SUB-003, and SUB-005 do; target clauses API-001 and AUD-002 will once released). Capacity and rate limits are in `seed.json → limits`. Times are p95 at those limits, except the scheduled publication and automatic maintenance transition bounds: those 240-second bounds are declared promises based on one local stress observation, not p95 measurements over independent runs or hosted Cron guarantees. Clauses marked *Policy* have a default that buyers may replace through the named extension point.
