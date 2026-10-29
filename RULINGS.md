# Lamp rulings

### RL-1 — Relative generation time retains absolute source instant

**Date:** 2026-10-20 · **Ruled by:** owner L10 (S4) · **Clauses governed:** PAGE-009.

The owner’s S4 public-page clarity exception permits the page generation timestamp to show a refreshed relative label while scripting runs. Its tooltip retains absolute configured-zone time and offset, its machine-readable value retains the exact instant, and initial HTML and script-disabled readers retain absolute time. Incident, maintenance, feed and notification timestamps remain absolute. The original authority is DIVERGENCE.md, Public page clarity — owner L10, 20 October 2026; no status changes.

### RL-2 — Short uptime coverage and No data labels

**Date:** 2026-10-20 · **Ruled by:** owner L10 (S4) · **Clauses governed:** UPTIME-003.

The owner’s S4 public-page clarity exception labels sub-day tracking coverage in elapsed hours and minutes (less than 1 minute below one minute), then whole days from a day onward. A component without data says No data. The original authority is DIVERGENCE.md, Public page clarity — owner L10, 20 October 2026; no status changes.

### RL-7 — Recovery proof boundary

**Date:** 2026-10-19 · **Ruled by:** ct · **Clauses governed:** AGENT-004.

every linked single-alert key and grouped member Lamp currently tracks participates. For webhook evidence, the hold means a reported recovery at least five minutes earlier (AUTO-002's default), with no later firing receipt; repeated group recovery conservatively restarts the recorded hold. This does not certify continuously sampled monitor passing. Absent vendor, traffic, support and continuous-monitor evidence is shown as **not tracked**, never as passing. DEP-001, HIST-006, INTEG-001 and COMP-008 must join this same pre-close check before those capabilities ship. Immediate, historical and scheduled resolutions all use the check; scheduled resolutions recheck when due and retain a failing draft. An override authorizes the current immediate publication only.

### RL-8 — Report proof boundary

**Date:** 2026-10-19 · **Ruled by:** ct · **Clauses governed:** AGENT-005.

every currently held brief alert and published update is included with its existing A/U reference. The incident's recorded opening-to-published-resolution window is labeled **recorded**, never monitor-measured customer downtime. Oncall (INTAKE-012), PagerDuty (INTAKE-009), and Jira Service Management/Opsgenie (INTAKE-014) timeline evidence must enter this same cited generator before those timeline capabilities ship; measured monitor evidence (COMP-008, UPTIME-007) must likewise join when available. Internal notes remain excluded. Cause and remediation are empty fields with human-input flags and cited evidence to review; publishing either untouched prompt or empty field is refused with 400. Draft generation never replaces an existing operator report.

### RL-3 — Setup performs its own readiness checks

**Date:** 2026-10-20 · **Ruled by:** owner · **Clauses governed:** SETUP-001.

Setup asks the owner nothing that Lamp can do itself (owner decision, 20 October 2026).

### RL-4 — Quiet local mail and one-click owner entry

**Date:** 2026-10-15 · **Ruled by:** owner · **Clauses governed:** SETUP-001.

Local development suppresses outgoing mail, offers no captured-mail inbox, and prepares automatic one-click owner entry without email (owner decision, 15 October 2026).

### RL-5 — Website first setup

**Date:** 2026-10-20 · **Ruled by:** owner · **Clauses governed:** SETUP-002.

A signed-in owner whose installation has no stored first-run completion is sent from every operator document to `/setup`, which asks for their website first (owner decision, 20 October 2026).

### RL-6 — Optional source incident history during setup

**Date:** 2026-10-22 · **Ruled by:** owner UI pass L11 · **Clauses governed:** SETUP-002.

When the site links to a Statuspage, Instatus or Better Stack page, or one answers at `status.<its domain>`, setup takes that page's own components and groups from its public feeds in place of the navigation's, labelled with where they came from, and offers "Bring its incident history too" (owner UI pass L11, 22 October 2026): off unless chosen, it imports the page's resolved incidents with their updates and times through Move in's keyless read, as MOVE-002's silent history; nothing open on that page, no maintenance and no subscriber comes, and a page whose feeds give no components changes nothing.

### RL-101 — Provider-native authentication and safe email failover

**Date:** 2026-10-28 · **Ruled by:** ct · **Clauses governed:** NOTIFY-013.

**Question:** Must failover preserve a provider-overwritten Message-ID or fabricate signatures, and may an ambiguous primary submission cross providers?

**Adopted/proposed default:** Safe explicit retryable rejections permit secondary submission after five minutes; ambiguous submissions stop; Postmark Basic authentication and SES-assigned Message-ID are honestly labelled.

**Outcome: replace.** Keep one durable Lamp notification identity and provider-attempt mapping; preserve the submitted Message-ID where supported, accept SES's assigned identifier, verify each provider's documented event authentication, and fail over only after non-acceptance is established or an outage precedes submission; uncertain acceptance stays pending for reconciliation without a second-provider send.

**Why:** Statuspage uses multiple delivery providers for resilience. No common norm makes all providers retain the same wire Message-ID or sign payloads: SES overwrites that header and Postmark documents HTTPS Basic authentication instead. Deduplication therefore belongs to Lamp's durable identity and safe submission state, not a promised mailbox deduplication effect. The 24 October 12:05Z ct ruling (lanes/sd/INBOX.md:4036; ct lane status record:3525) already approved the current authentication and ambiguous-send default; those riders are preserved. This replaces only the unsupported universal wire-header/signature requirements, not that prior approval.

**Sources:**
- [Statuspage uses multiple email and SMS providers for delivery resilience.](https://www.atlassian.com/software/statuspage/features/notifications)
- [SES overwrites supplied Message-ID and Date headers.](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendRawEmail.html)
- [Postmark documents Basic authentication and IP allowlisting, not signed payloads.](https://postmarkapp.com/developer/webhooks/webhooks-overview)

**Placement:** Replace the impossible provider-specific sentences in NOTIFY-013's own acceptance point; cite the existing NOTIFY-005 identity/duplicate door rule once. Retain reported-outage switching and every named provider.

**Current-main evidence:** CONTRACT.md:574 (clause), :1251 (Status row); `e2ff6ab16abd236602c5da3c3cf99d2068ff9140`.

**Engineering/proof boundary:** Reported-outage switching remains unbuilt. A 5xx is not universal proof of rejection; implement provider-specific safe/uncertain outcomes and reconciliation. Controlled fixtures do not prove mailbox delivery or exact-once delivery. Existing ct rider: authentication must not be labelled a payload signature, and ambiguous cross-provider submissions remain denied.

### RL-102 — Public webhook subscribers retain their format choice

**Date:** 2026-10-28 · **Ruled by:** ct · **Clauses governed:** SUB-018.

**Question:** Do operator creation, CSV and management of an existing token satisfy anyone subscribing a new public webhook endpoint?

**Adopted/proposed default:** Existing private creation/import/management doors expose Lamp or Statuspage; no public webhook form exists.

**Outcome: replace.** Anyone eligible to subscribe a new webhook endpoint must have a public self-service subscription door with the Lamp/Statuspage format choice and the existing verification and abuse controls; retain the current private doors and preserve existing recipient formats until explicitly changed.

**Why:** Atlassian explicitly exposes a webhook tab to public subscribers as well as an API. Restricting creation to operators or already-issued management tokens fails the clause's existing audience. This is an engineering gap, not an unresolved policy choice.

**Sources:**
- [Statuspage enables public webhook subscription and API creation.](https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/)

**Placement:** State the public creation requirement in SUB-018's own point, citing SUB-009's subscription/signature door rule once; MOVE-010 retains imported format ownership.

**Current-main evidence:** CONTRACT.md:544 (clause), :1236 (Status row); `e2ff6ab16abd236602c5da3c3cf99d2068ff9140`.

**Engineering/proof boundary:** Engineering-only classification: the disputed public-subscription audience is already explicit in the clause; the missing public door/chooser must be built, with no owner policy choice needed. Do not mark the row done or reinterpret 'anyone' as operators. Build and prove the missing public door and chooser.
