Old reference: `54e0e1dcfdc225ad17e42abff04b65d7f2bfdc72`.
| Clause | Point | Outcome | Asserting test | Result |
| --- | --- | --- | --- | --- |
| DOCS-001 | 1 | The unauthenticated documentation index returns HTTP 200 | `tests/e2e/start-runtime.test.mjs:367` | asserted |
| DOCS-001 | 1 | The documentation index’s usable guidance and navigation content are asserted | none | none |
| DOCS-001 | 1 | A representative selected VPAT page contains its released version and required chapter text | `tests/e2e/start-runtime.test.mjs:375` | asserted |
| DOCS-001 | 2 | The selected VPAT page renders the version and chapter text held in its repository Markdown | `tests/e2e/start-runtime.test.mjs:375` | asserted |
| DOCS-001 | 2 | The status-page host does not serve documentation | `tests/e2e/start-runtime.test.mjs:398` | asserted |
| PAGE-001 | 1 | Overall status appears | `tests/e2e/app-api.test.mjs:141` | asserted |
| PAGE-001 | 1 | Every visible component is present | none | none |
| PAGE-001 | 1 | Each visible component’s current state is present | none | none |
| PAGE-001 | 1 | Each visible component’s exact note is present | none | none |
| PAGE-001 | 2 | Every unresolved incident appears | none | none |
| PAGE-001 | 2 | Five most recent updates are shown in newest-first order | none | none |
| PAGE-001 | 2 | Each incident links its complete permanent timeline | none | none |
| PAGE-001 | 3 | All in-progress maintenance appears | none | none |
| PAGE-001 | 3 | The 14-day scheduled-maintenance inclusion boundary is asserted | none | none |
| PAGE-001 | 4 | The total daily-mark count is between six times ninety and six times ninety-one | `tests/e2e/app-api.test.mjs:146` | asserted |
| PAGE-001 | 4 | Daily-mark coverage is reconciled separately for every visible component | none | none |
| PAGE-001 | 4 | Each visible component uptime figure is asserted | none | none |
| PAGE-002 | 1 | Initial HTML contains the overall Operational label | `tests/e2e/public-contract.test.mjs:232` | asserted |
| PAGE-002 | 1 | Initial HTML contains the representative component name | `tests/e2e/public-contract.test.mjs:233` | asserted |
| PAGE-002 | 1 | Initial HTML contains a timestamp | `tests/e2e/public-contract.test.mjs:234` | asserted |
| PAGE-002 | 1 | Initial HTML contains the subscription form | `tests/e2e/public-contract.test.mjs:235` | asserted |
| PAGE-002 | 1 | Initial HTML contains its email input | `tests/e2e/public-contract.test.mjs:236` | asserted |
| PAGE-002 | 1 | All PAGE-001 content is reconciled in initial HTML | none | none |
| PAGE-002 | 2 | Every status, update and timestamp is readable with scripting disabled | none | none |
| PAGE-002 | 2 | The public subscription form successfully submits without scripting | none | none |
| PAGE-002 | 3 | The configured time-zone label survives live updates | `tests/e2e/public-contract.test.mjs:716` | asserted |
| PAGE-002 | 3 | Public timestamp text remains in the configured zone | none | none |
| PAGE-002 | 3 | Operator entry uses the configured zone | none | none |
| PAGE-002 | 3 | Timeline timestamps use the configured zone | none | none |
| PAGE-002 | 3 | Preview timestamps use the configured zone | none | none |
| PAGE-003 | 1 | Gzip size stays within 50 KiB at 200 populated components | `tests/e2e/public-contract.test.mjs:789` | asserted |
| PAGE-003 | 2 | Initial loading makes at most four subresource requests | `tests/e2e/public-contract.test.mjs:840` | asserted |
| PAGE-003 | 2 | Each initial subresource is an allowed stylesheet, font, logo or script | `tests/e2e/public-contract.test.mjs:841` | asserted |
| PAGE-003 | 2 | No third-party requests occur | `tests/e2e/public-contract.test.mjs:842` | asserted |
| PAGE-004 | 1 | The supplied rollup selects the most severe visible component state | none | none |
| PAGE-004 | 2 | The rollup label appears at the top of the page | `tests/e2e/public-contract.test.mjs:375` | asserted |
| PAGE-004 | 3 | The all-operational fixture displays Operational | `tests/e2e/public-contract.test.mjs:232` | asserted |
| PAGE-005 | 1 | A rendered public-page artifact exists | `tests/e2e/publishing-contract.test.mjs:1316` | asserted |
| PAGE-005 | 1 | An Atom-feed artifact exists | `tests/e2e/publishing-contract.test.mjs:1316` | asserted |
| PAGE-005 | 1 | A widget artifact exists | `tests/e2e/publishing-contract.test.mjs:1316` | asserted |
| PAGE-005 | 1 | Every PAGE-001 change triggers a complete snapshot | none | none |
| PAGE-005 | 2 | The public page remains readable without the database | none | none |
| PAGE-005 | 2 | The feed remains readable without the database | none | none |
| PAGE-005 | 2 | The widget remains readable without the database | none | none |
| PAGE-005 | 3 | A failed build remains stale until a retry | `tests/e2e/publishing-contract.test.mjs:1296` | asserted |
| PAGE-005 | 3 | The pending-build retry reports completion | `tests/e2e/publishing-contract.test.mjs:1298` | asserted |
| PAGE-005 | 3 | After retry the page artifact no longer carries the stale flag | `tests/e2e/publishing-contract.test.mjs:1299` | asserted |
| PAGE-005 | 3 | The old publication selector version remains after unrecoverable replica failure | `tests/e2e/snapshot-retained.test.mjs:112` | asserted |
| PAGE-005 | 3 | The old replica version remains after unrecoverable replica failure | `tests/e2e/snapshot-retained.test.mjs:113` | asserted |
| PAGE-005 | 3 | The old publication body is read back while the unrecoverable replica failure is in force | none | none |
| PAGE-006 | 1 | The page body still contains Partially unavailable after database removal | `tests/e2e/app-api.test.mjs:590` | asserted |
| PAGE-006 | 1 | The Atom feed survives database outage | none | none |
| PAGE-006 | 1 | The widget survives database outage | none | none |
| PAGE-006 | 1 | Page content survives queue outage | none | none |
| PAGE-006 | 1 | Atom feed content survives queue outage | none | none |
| PAGE-006 | 1 | Widget content survives queue outage | none | none |
| PAGE-006 | 1 | Page content survives object-storage outage | none | none |
| PAGE-006 | 1 | Atom feed content survives object-storage outage | none | none |
| PAGE-006 | 1 | Widget content survives object-storage outage | none | none |
| PAGE-006 | 1 | Origin outage uses the specified cached-response window | none | none |
| PAGE-006 | 2 | Page is unavailable only before first publication | none | none |
| PAGE-006 | 2 | Atom feed is unavailable only before first publication | none | none |
| PAGE-006 | 2 | Widget is unavailable only before first publication | none | none |
| PAGE-006 | 3 | Stale page content is labeled Last known state | `tests/e2e/public-contract.test.mjs:915` | asserted |
| PAGE-006 | 3 | The generation instant is visible in stale page content | `tests/e2e/public-contract.test.mjs:918` | asserted |
| PAGE-006 | 3 | The retained failure body contains Partially unavailable | `tests/e2e/app-api.test.mjs:600` | asserted |
| PAGE-006 | 3 | The same nonempty failure body contains no invented all-clear text | `tests/e2e/app-api.test.mjs:601` | asserted |
| PAGE-007 | 1 | A generation validator exists | `tests/e2e/app-api.test.mjs:154` | asserted |
| PAGE-007 | 1 | An unchanged generation returns a not-modified response | `tests/e2e/app-api.test.mjs:156` | asserted |
| PAGE-007 | 1 | Advancing a generation makes all earlier healthy cache entries ineligible | none | none |
| PAGE-007 | 2 | Update publication reaches public page within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches history within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches incident permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches maintenance permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches Atom feed within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches widget within ten seconds | none | none |
| PAGE-007 | 2 | Update publication reaches public JSON within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches public page within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches history within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches incident permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches maintenance permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches Atom feed within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches widget within ten seconds | none | none |
| PAGE-007 | 2 | Component-state change reaches public JSON within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches public page within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches history within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches incident permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches maintenance permanent page within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches Atom feed within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches widget within ten seconds | none | none |
| PAGE-007 | 2 | Maintenance transition reaches public JSON within ten seconds | none | none |
| PAGE-007 | 3 | Origin-failure retention lasts exactly the promised one-hour window | none | none |
| PAGE-008 | 1 | Repeated same-address public status reads all succeed | `tests/e2e/public-contract.test.mjs:736` | asserted |
| PAGE-008 | 1 | Repeated reads never return a rate-limit refusal | `tests/e2e/public-contract.test.mjs:737` | asserted |
| PAGE-008 | 2 | Healthy generation validation performs no database query | none | none |
| PAGE-008 | 2 | Artifact caching reduces object-byte reads | none | none |
| PAGE-009 | 1 | Initial public timestamp text uses the configured zone and exact instant | none | none |
| PAGE-009 | 1 | Scripted public timestamp retains the exact instant | `tests/e2e/public-contract.test.mjs:769` | asserted |
| PAGE-009 | 1 | Scripted public timestamp uses the configured zone and offset | none | none |
| PAGE-009 | 1 | Notification timestamps use the configured zone and offset | none | none |
| PAGE-009 | 2 | The initial scripted generation label is relative | `tests/e2e/public-contract.test.mjs:666` | asserted |
| PAGE-009 | 2 | The generation tooltip preserves the absolute instant and configured zone | none | none |
| PAGE-009 | 2 | The relative label’s later refresh is asserted rather than only awaited | none | none |
| PAGE-009 | 3 | Initial public HTML retains absolute timestamps | none | none |
| PAGE-009 | 3 | Script-disabled generation text remains absolute | none | none |
| PAGE-009 | 3 | Maintenance, feed and notification text remains absolute | none | none |
| PAGE-010 | 1 | The feed declares the Atom namespace | `tests/e2e/public-contract.test.mjs:886` | asserted |
| PAGE-010 | 1 | Full Atom 1.0 validation is asserted | none | none |
| PAGE-010 | 2 | Published incident-update identity appears | `tests/e2e/public-contract.test.mjs:878` | asserted |
| PAGE-010 | 2 | Completed-maintenance identity appears | `tests/e2e/public-contract.test.mjs:879` | asserted |
| PAGE-010 | 2 | Scheduled notice appears | `tests/e2e/public-contract.test.mjs:880` | asserted |
| PAGE-010 | 2 | Rescheduled notice appears | `tests/e2e/public-contract.test.mjs:880` | asserted |
| PAGE-010 | 2 | Started notice appears | `tests/e2e/public-contract.test.mjs:880` | asserted |
| PAGE-010 | 2 | Cancelled notice appears | `tests/e2e/public-contract.test.mjs:880` | asserted |
| PAGE-010 | 2 | Older-than-twelve-month updates are excluded | `tests/e2e/public-contract.test.mjs:881` | asserted |
| PAGE-010 | 2 | Feed events are newest first | `tests/e2e/public-contract.test.mjs:882` | asserted |
| PAGE-010 | 2 | Exactly one entry exists for each included event | none | none |
| PAGE-010 | 3 | An event identity survives hostname change | `tests/e2e/public-contract.test.mjs:899` | asserted |
| PAGE-010 | 3 | Event identities are never reused | none | none |
| PAGE-011 | 1 | The banner content asserts both overall state and unresolved incident | none | none |
| PAGE-011 | 2 | The widget is at most ten KiB gzipped | `tests/e2e/public-contract.test.mjs:603` | asserted |
| PAGE-011 | 2 | The nonempty widget source contains neither XMLHttpRequest nor importScripts | `tests/e2e/public-contract.test.mjs:604` | asserted |
| PAGE-011 | 2 | The widget performs no other foreign-origin or alternate network load | none | none |
| PAGE-011 | 2 | Every widget load is observed to stay on the installation origin | none | none |
| PAGE-012 | 1 | Changing the page name reaches the public page | `tests/e2e/app-api.test.mjs:323` | asserted |
| PAGE-012 | 1 | Logo is changed and read back | none | none |
| PAGE-012 | 1 | Accent color is changed and read back | none | none |
| PAGE-012 | 1 | Time zone is changed and read back | none | none |
| PAGE-012 | 1 | Hostname is changed and read back | none | none |
| PAGE-012 | 2 | Footer credit begins enabled | `tests/e2e/app-api.test.mjs:307` | asserted |
| PAGE-012 | 2 | Enabled credit displays Powered by Lamp | `tests/e2e/public-contract.test.mjs:521` | asserted |
| PAGE-012 | 2 | Disabling credit removes it | `tests/e2e/public-contract.test.mjs:526` | asserted |
| PAGE-012 | 2 | Disabling credit has no network effect | none | none |
| PAGE-012 | 3 | The first-party logo response declares PNG content | `tests/e2e/public-contract.test.mjs:578` | asserted |
| PAGE-012 | 3 | The public page embeds its branding mark from an own-origin address | `tests/e2e/public-contract.test.mjs:582` | asserted |
| PAGE-012 | 3 | The direct first-party logo response bytes are read back as the configured logo | none | none |
| PAGE-012 | 4 | The favicon contains the configured logo pixel | `tests/e2e/public-contract.test.mjs:597` | asserted |
| PAGE-012 | 4 | The Open Graph image contains the configured logo pixel | `tests/e2e/public-contract.test.mjs:597` | asserted |
| PAGE-012 | 4 | The favicon contains the Operational state-marker pixel | `tests/e2e/public-contract.test.mjs:598` | asserted |
| PAGE-012 | 4 | The Open Graph image contains the Operational state-marker pixel | `tests/e2e/public-contract.test.mjs:598` | asserted |
| PAGE-012 | 4 | The state mark matches the Operational state | `tests/e2e/public-contract.test.mjs:598` | asserted |
| PAGE-012 | 4 | Open Graph title states the current overall status | none | none |
| PAGE-013 | 1 | The default-src directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The script-src directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The style-src directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The img-src directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The connect-src directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The form-action directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | The base-uri directive names the own origin in the exact complete CSP | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | Framing is refused | `tests/e2e/public-contract.test.mjs:639` | asserted |
| PAGE-013 | 1 | Content-type sniffing is disabled | `tests/e2e/public-contract.test.mjs:640` | asserted |
| PAGE-013 | 1 | The documented referrer policy is present | `tests/e2e/public-contract.test.mjs:641` | asserted |
| PAGE-013 | 2 | A populated public page is checked for absence of CAPTCHA | none | none |
| PAGE-013 | 2 | A populated public page is checked for absence of consent banner | none | none |
| PAGE-014 | 1 | The page polls once at its thirty-second cadence | `tests/e2e/public-contract.test.mjs:698` | asserted |
| PAGE-014 | 1 | The changed overall status reaches the in-place region | `tests/e2e/public-contract.test.mjs:704` | asserted |
| PAGE-014 | 1 | The newest update reaches the in-place region | `tests/e2e/public-contract.test.mjs:705` | asserted |
| PAGE-014 | 2 | The refresh response has exactly the fixed field set | none | none |
| PAGE-014 | 2 | The refresh response size does not grow with component count | none | none |
| PAGE-014 | 3 | Initial HTML shows a generation instant | `tests/e2e/public-contract.test.mjs:234` | asserted |
| PAGE-014 | 3 | Scripting-disabled content never refreshes itself | none | none |
| PAGE-017 | 1 | RSS parses without XML errors | `tests/e2e/helpers/public-resources-flow.mjs:65` | asserted |
| PAGE-017 | 1 | RSS event identities equal Atom identities in order | `tests/e2e/helpers/public-resources-flow.mjs:65` | asserted |
| PAGE-017 | 1 | RSS 2.0 semantic validation is asserted | none | none |
| PAGE-017 | 2 | The history RSS alias equals the native RSS feed | `tests/e2e/helpers/public-resources-flow.mjs:51` | asserted |
| PAGE-017 | 2 | Both history aliases work on an installation with no import | none | none |
| PAGE-017 | 3 | A populated Web application component feed contains the affected incident | `tests/e2e/helpers/public-resources-flow.mjs:70` | asserted |
| PAGE-017 | 3 | An unrelated component’s populated feed excludes the incident while retaining its own event | none | none |
| PAGE-017 | 3 | Both feed forms of every visible component reconcile all applicable incident and maintenance events | none | none |
| PAGE-017 | 4 | All feed variants are asserted snapshot-backed | none | none |
| PAGE-017 | 4 | The W3C validator accepts every feed | none | none |
| PAGE-017 | 5 | A newly published event is asserted in the polled history RSS alias within ten seconds | none | none |
| PAGE-018 | 1 | Component-state SVG has the changed label | `tests/e2e/helpers/public-resources-flow.mjs:99` | asserted |
| PAGE-018 | 1 | The component-state SVG stays within two KiB | `tests/e2e/helpers/public-resources-flow.mjs:98` | asserted |
| PAGE-018 | 1 | The component-uptime SVG stays within two KiB | `tests/e2e/helpers/public-resources-flow.mjs:98` | asserted |
| PAGE-018 | 1 | The component-state badge uses its page state color or no-data ink | `tests/e2e/helpers/public-resources-flow.mjs:102` | asserted |
| PAGE-018 | 1 | The component-uptime badge uses its page state color or no-data ink | `tests/e2e/helpers/public-resources-flow.mjs:102` | asserted |
| PAGE-018 | 1 | The overall badge contains the endpoint’s state text | `tests/e2e/helpers/public-resources-flow.mjs:109` | asserted |
| PAGE-018 | 1 | The overall badge contains the endpoint’s state color | `tests/e2e/helpers/public-resources-flow.mjs:109` | asserted |
| PAGE-018 | 1 | Overall SVG stays within two KiB | `tests/e2e/helpers/public-resources-flow.mjs:108` | asserted |
| PAGE-018 | 2 | Endpoint schemaVersion equals one | `tests/e2e/helpers/public-resources-flow.mjs:105` | asserted |
| PAGE-018 | 2 | Every shields.io endpoint field and a shields.io rendering are asserted | none | none |
| PAGE-018 | 3 | Badge responses carry the selected snapshot generation | `tests/e2e/helpers/public-resources-flow.mjs:73` | asserted |
| PAGE-018 | 3 | Changed badges are readable within ten seconds | `tests/e2e/helpers/public-resources-flow.mjs:110` | asserted |
| PAGE-018 | 4 | Badges remain nonempty with object storage unavailable through retained serving | `tests/e2e/snapshot-retained.test.mjs:171` | asserted |
| PAGE-018 | 4 | Database-unavailable badge serving is directly asserted | none | none |
| PAGE-019 | 1 | The floating notice starts hidden without an incident | `tests/e2e/helpers/widget-variants-flow.mjs:26` | asserted |
| PAGE-019 | 1 | A floating incident notice appears on publication | `tests/e2e/helpers/widget-variants-flow.mjs:39` | asserted |
| PAGE-019 | 1 | A maintenance alone displays the floating notice | none | none |
| PAGE-019 | 1 | Every variant can be configured to hide when operational | none | none |
| PAGE-019 | 2 | The dot state equals the public snapshot state | `tests/e2e/helpers/widget-variants-flow.mjs:25` | asserted |
| PAGE-019 | 2 | Every variant stays within ten KiB | none | none |
| PAGE-019 | 3 | Four status sections render after the four allowed-origin embed installations | `tests/e2e/helpers/widget-variants-flow.mjs:24` | asserted |
| PAGE-019 | 3 | Each installed variant is individually identified as the banner, dot, floating notice or compatibility embed | none | none |
| PAGE-019 | 3 | An unlisted origin renders nothing | `tests/e2e/helpers/widget-variants-flow.mjs:43` | asserted |
| PAGE-019 | 4 | A floating notice contains the incident title | `tests/e2e/helpers/widget-variants-flow.mjs:39` | asserted |
| PAGE-019 | 4 | The configured top position is applied | `tests/e2e/helpers/widget-variants-flow.mjs:41` | asserted |
| PAGE-019 | 4 | The configured foreground and background colors are asserted | none | none |
| PAGE-019 | 4 | Resolution-driven disappearance is asserted rather than only awaited | none | none |
| COMP-001 | 1 | The component-state vocabulary is exact | `tests/e2e/public-contract.test.mjs:285` | asserted |
| COMP-001 | 2 | Degraded performance outranks Under maintenance | `tests/e2e/public-contract.test.mjs:286` | asserted |
| COMP-001 | 2 | Degraded performance outranks Operational | `tests/e2e/public-contract.test.mjs:286` | asserted |
| COMP-001 | 2 | Major outage outranks Partially unavailable | `tests/e2e/public-contract.test.mjs:287` | asserted |
| COMP-002 | 1 | Multiple group membership is refused or excluded | none | none |
| COMP-002 | 2 | Group order controls public order | `tests/e2e/public-contract.test.mjs:207` | asserted |
| COMP-002 | 2 | Within-group component order controls public order | `tests/e2e/public-contract.test.mjs:208` | asserted |
| COMP-003 | 1 | A history row records the previous Operational state | `tests/e2e/public-contract.test.mjs:470` | asserted |
| COMP-003 | 1 | The same history row records the new Operational state | `tests/e2e/public-contract.test.mjs:470` | asserted |
| COMP-003 | 1 | The same history row records a standing-claim cause | `tests/e2e/public-contract.test.mjs:470` | asserted |
| COMP-003 | 1 | A correction row names the operator | `tests/e2e/public-contract.test.mjs:471` | asserted |
| COMP-003 | 1 | A correction row retains its exact change instant | `tests/e2e/public-contract.test.mjs:414` | asserted |
| COMP-003 | 1 | Every public-state change records the causing operator or incident | none | none |
| COMP-003 | 2 | A prior history fact remains after a correction | `tests/e2e/public-contract.test.mjs:413` | asserted |
| COMP-003 | 2 | A superseding correction fact is appended | `tests/e2e/public-contract.test.mjs:414` | asserted |
| COMP-003 | 2 | Prior history values are unchanged rather than only present | none | none |
| COMP-004 | 1 | A new component’s omitted note defaults to empty | none | none |
| COMP-004 | 2 | An exact 250-character note appears in public HTML | `tests/e2e/public-contract.test.mjs:295` | asserted |
| COMP-004 | 2 | A note above 250 characters is refused | `tests/e2e/public-contract.test.mjs:297` | asserted |
| COMP-005 | 1 | The populated internal-component fixture is absent from the page | `tests/e2e/public-contract.test.mjs:306` | asserted |
| COMP-005 | 1 | The populated internal-component fixture is absent from Atom | `tests/e2e/public-contract.test.mjs:306` | asserted |
| COMP-005 | 1 | The populated internal-component fixture is absent from the widget | `tests/e2e/public-contract.test.mjs:306` | asserted |
| COMP-005 | 1 | Internal components are absent from every uptime figure | none | none |
| COMP-005 | 2 | An internal severe claim leaves the public overall state unchanged | none | none |
| COMP-006 | 1 | An operator standing claim determines the component state | `tests/e2e/app-api.test.mjs:218` | asserted |
| COMP-006 | 1 | An incident attachment chooses an independent state | `tests/e2e/app-api.test.mjs:271` | asserted |
| COMP-006 | 1 | In-progress maintenance contributes its chosen claim | none | none |
| COMP-006 | 2 | Clearing a standing claim reveals a remaining claim | `tests/e2e/app-api.test.mjs:226` | asserted |
| COMP-006 | 2 | Detaching an incident reveals the next-most-severe claim | `tests/e2e/app-api.test.mjs:262` | asserted |
| COMP-006 | 2 | No claims gives Operational | none | none |
| COMP-006 | 3 | Incident resolution recomputes public state within ten seconds | none | none |
| COMP-006 | 3 | Maintenance completion recomputes public state within ten seconds | none | none |
| COMP-006 | 3 | Component attachment recomputes public state within ten seconds | none | none |
| COMP-006 | 3 | Component detachment recomputes public state within ten seconds | none | none |
| COMP-006 | 3 | Setting a standing claim recomputes public state within ten seconds | none | none |
| COMP-006 | 3 | Clearing a standing claim recomputes public state within ten seconds | none | none |
| COMP-007 | 1 | Stored state-history rows are absent after component deletion | `tests/e2e/public-contract.test.mjs:365` | asserted |
| COMP-007 | 1 | Component and uptime disappearance is observed on the public page within ten seconds | none | none |
| COMP-007 | 2 | Published incident history retains the deleted name | `tests/e2e/public-contract.test.mjs:363` | asserted |
| COMP-007 | 2 | Published maintenance history retains the deleted name | none | none |
| COMP-009 | 1 | Table creation is asserted for components | none | none |
| COMP-009 | 1 | Table creation is asserted for groups | none | none |
| COMP-009 | 1 | Table editing is asserted for components | none | none |
| COMP-009 | 1 | Table editing is asserted for groups | none | none |
| COMP-009 | 1 | Table reordering is asserted for components | none | none |
| COMP-009 | 1 | Table reordering is asserted for groups | none | none |
| COMP-009 | 1 | Table deletion is asserted for components | none | none |
| COMP-009 | 1 | Table deletion is asserted for groups | none | none |
| COMP-009 | 1 | CSV creation is asserted for components | none | none |
| COMP-009 | 1 | CSV creation is asserted for groups | none | none |
| COMP-009 | 1 | CSV editing is asserted for components | none | none |
| COMP-009 | 1 | CSV editing is asserted for groups | none | none |
| COMP-009 | 1 | CSV reordering is asserted for components | none | none |
| COMP-009 | 1 | CSV reordering is asserted for groups | none | none |
| COMP-009 | 1 | CSV deletion is asserted for components | none | none |
| COMP-009 | 1 | CSV deletion is asserted for groups | none | none |
| COMP-009 | 2 | Preview reports fifty created components | `tests/e2e/helpers/catalogue-history-flow.mjs:82` | asserted |
| COMP-009 | 2 | Preview reports zero changed components | `tests/e2e/helpers/catalogue-history-flow.mjs:82` | asserted |
| COMP-009 | 2 | Preview reports zero deleted components | `tests/e2e/helpers/catalogue-history-flow.mjs:82` | asserted |
| COMP-009 | 2 | Preview reports two created groups | `tests/e2e/helpers/catalogue-history-flow.mjs:83` | asserted |
| COMP-009 | 2 | Preview reports zero changed groups | `tests/e2e/helpers/catalogue-history-flow.mjs:83` | asserted |
| COMP-009 | 2 | Preview reports zero deleted groups | `tests/e2e/helpers/catalogue-history-flow.mjs:83` | asserted |
| COMP-009 | 2 | After preview the complete persisted catalog is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:84` | asserted |
| COMP-009 | 2 | After preview the persisted catalog revision is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:84` | asserted |
| COMP-009 | 2 | After preview the component count is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:85` | asserted |
| COMP-009 | 2 | After preview the group count is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:85` | asserted |
| COMP-009 | 2 | After preview the claim-event count is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:85` | asserted |
| COMP-009 | 2 | After preview the state-history count is unchanged | `tests/e2e/helpers/catalogue-history-flow.mjs:85` | asserted |
| COMP-009 | 2 | Apply adds exactly fifty components | `tests/e2e/helpers/catalogue-history-flow.mjs:97` | asserted |
| COMP-009 | 3 | CSV positions determine public order | `tests/e2e/helpers/catalogue-history-flow.mjs:103` | asserted |
| COMP-009 | 3 | The native disclosure contains escaped plain description text | `tests/e2e/helpers/catalogue-history-flow.mjs:104` | asserted |
| COMP-009 | 3 | The exact five-hundred-character description is retained | `tests/e2e/helpers/catalogue-history-flow.mjs:100` | asserted |
| COMP-009 | 4 | The chosen tracking start date is retained | `tests/e2e/helpers/catalogue-history-flow.mjs:101` | asserted |
| COMP-010 | 1 | After recovery the conditional component is absent from the populated page | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 1 | After recovery the conditional component is absent from the populated incident Atom feed | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 1 | After recovery the conditional component is absent from the populated v2 component list | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 1 | The widget omits an Operational conditional component | none | none |
| COMP-010 | 1 | The uptime figure and daily record are hidden | none | none |
| COMP-010 | 2 | The affected component appears publicly | `tests/e2e/helpers/catalogue-history-flow.mjs:129` | asserted |
| COMP-010 | 2 | Recovery-driven disappearance is checked through the bounded predicate | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 3 | Existing history entries remain after hide/reveal | `tests/e2e/helpers/catalogue-history-flow.mjs:134` | asserted |
| COMP-010 | 3 | Uptime is retained throughout | none | none |
| COMP-010 | 3 | The conditional component always contributes to overall status | none | none |
| COMP-010 | 4 | While affected the v2 component row has its conditional-visibility flag set | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 4 | While affected the v2 component row reports Major outage | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 4 | After recovery the v2 component row is absent | `tests/e2e/helpers/catalogue-history-flow.mjs:69` | asserted |
| COMP-010 | 5 | Statuspage conditional visibility survives native import | `tests/e2e/statuspage-import.test.mjs:189` | asserted |
| UPTIME-001 | 1 | The ninety-day window includes its complete partial boundary | `tests/e2e/public-contract.test.mjs:465` | asserted |
| UPTIME-001 | 2 | A one-minute outage displays 99.99 percent instead of 100.00 | `tests/e2e/public-contract.test.mjs:481` | asserted |
| UPTIME-002 | 1 | Degraded performance receives half weight | `tests/e2e/public-contract.test.mjs:491` | asserted |
| UPTIME-002 | 1 | Maintenance receives zero weight | `tests/e2e/public-contract.test.mjs:492` | asserted |
| UPTIME-002 | 1 | The supplied policy’s Major outage weight is asserted | none | none |
| UPTIME-002 | 1 | The supplied policy’s Partially unavailable weight is asserted | none | none |
| UPTIME-003 | 1 | The public percentage denominator starts at the fixture’s first history record rather than inventing ninety days | `tests/e2e/public-contract.test.mjs:427` | asserted |
| UPTIME-003 | 2 | Sub-day coverage is labeled in hours | `tests/e2e/public-contract.test.mjs:453` | asserted |
| UPTIME-003 | 2 | Longer coverage is labeled in whole days | `tests/e2e/public-contract.test.mjs:500` | asserted |
| UPTIME-003 | 2 | Minute-based short-coverage labels are asserted | none | none |
| UPTIME-003 | 2 | Less-than-one-minute coverage labels are asserted | none | none |
| UPTIME-003 | 3 | A zero-elapsed fixture displays No data | `tests/e2e/public-contract.test.mjs:459` | asserted |
| UPTIME-004 | 1 | The corrected state is retained | `tests/e2e/public-contract.test.mjs:411` | asserted |
| UPTIME-004 | 1 | The stored correction retains the exact interval start | `tests/e2e/public-contract.test.mjs:411` | asserted |
| UPTIME-004 | 1 | The stored correction retains the exact interval end | `tests/e2e/public-contract.test.mjs:411` | asserted |
| UPTIME-004 | 1 | The reason is retained | `tests/e2e/public-contract.test.mjs:411` | asserted |
| UPTIME-004 | 1 | A missing reason is refused | `tests/e2e/public-contract.test.mjs:409` | asserted |
| UPTIME-004 | 2 | The original history entry remains | `tests/e2e/public-contract.test.mjs:413` | asserted |
| UPTIME-004 | 2 | A correction fact is appended | `tests/e2e/public-contract.test.mjs:414` | asserted |
| UPTIME-004 | 3 | A rebuilt public figure reflects the weighted correction | `tests/e2e/public-contract.test.mjs:427` | asserted |
| UPTIME-004 | 3 | Every affected figure is observed within sixty seconds | none | none |
| UPTIME-004 | 4 | Audit identifies the operator | `tests/e2e/public-contract.test.mjs:417` | asserted |
| UPTIME-004 | 4 | Audit retains the reason | `tests/e2e/public-contract.test.mjs:418` | asserted |
| UPTIME-004 | 4 | The audit payload retains the corrected state | `tests/e2e/public-contract.test.mjs:419` | asserted |
| UPTIME-004 | 4 | The audit payload retains the exact interval start | `tests/e2e/public-contract.test.mjs:419` | asserted |
| UPTIME-004 | 4 | The audit payload retains the exact interval end | `tests/e2e/public-contract.test.mjs:419` | asserted |
| UPTIME-005 | 1 | Initial HTML states the selected Major outage weight | `tests/e2e/public-contract.test.mjs:396` | asserted |
| UPTIME-005 | 1 | Initial HTML states the selected maintenance weight | `tests/e2e/public-contract.test.mjs:397` | asserted |
| UPTIME-005 | 1 | Initial HTML identifies the ninety-day window | `tests/e2e/public-contract.test.mjs:421` | asserted |
| UPTIME-005 | 1 | Every state’s selected weight is asserted | none | none |
| UPTIME-005 | 2 | Every published incident’s component claim affects the displayed uptime | none | none |
| UPTIME-006 | 1 | The aggregate mark count divided by two hundred lies between ninety and ninety-one | `tests/e2e/public-contract.test.mjs:792` | asserted |
| UPTIME-006 | 1 | The complete trailing daily-record length is reconciled for every component separately | none | none |
| UPTIME-006 | 2 | A day’s sixty downtime minutes are retained | `tests/e2e/public-contract.test.mjs:543` | asserted |
| UPTIME-006 | 2 | The rendered downtime-day label contains its exact minute count | none | none |
| UPTIME-006 | 3 | Untracked days have null downtime | `tests/e2e/public-contract.test.mjs:541` | asserted |
| UPTIME-006 | 3 | Tracked healthy days have zero downtime | `tests/e2e/public-contract.test.mjs:542` | asserted |
| UPTIME-006 | 3 | Rendered output identifies No data | `tests/e2e/public-contract.test.mjs:544` | asserted |
| UPTIME-006 | 3 | Rendered untracked days are visually distinct from healthy days | none | none |
| UPTIME-008 | 1 | The read-only Datadog query fixture fills its expected inline chart | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 1 | The read-only New Relic query fixture fills its expected inline chart | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 1 | The read-only Pingdom query fixture fills its expected inline chart | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 1 | The read-only Prometheus query fixture fills its expected inline chart | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 1 | Authenticated Uptime timing fills its chart | `tests/e2e/helpers/metrics-flow.mjs:108` | asserted |
| UPTIME-008 | 1 | A new management-bearer series is read back in the next public snapshot with its expected value | `tests/e2e/helpers/metrics-flow.mjs:63` | asserted |
| UPTIME-008 | 2 | The pushed 160 ms series appears in the next snapshot | `tests/e2e/helpers/metrics-flow.mjs:63` | asserted |
| UPTIME-008 | 2 | Each provider’s expected value appears | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 3 | Minute-resolution data just inside one day is preserved | `tests/e2e/helpers/metrics-flow.mjs:143` | asserted |
| UPTIME-008 | 3 | The expired minute’s aggregate bucket is its expected containing hour | `tests/e2e/helpers/metrics-flow.mjs:145` | asserted |
| UPTIME-008 | 3 | The expired minute’s value sum is retained | `tests/e2e/helpers/metrics-flow.mjs:145` | asserted |
| UPTIME-008 | 3 | The expired minute’s sample count is retained | `tests/e2e/helpers/metrics-flow.mjs:145` | asserted |
| UPTIME-008 | 3 | Hourly data just inside thirty days is preserved | `tests/e2e/helpers/metrics-flow.mjs:146` | asserted |
| UPTIME-008 | 3 | Expired hourly observations roll into the expected daily bucket | `tests/e2e/helpers/metrics-flow.mjs:149` | asserted |
| UPTIME-008 | 3 | The daily aggregate preserves the expected weighted value sum | `tests/e2e/helpers/metrics-flow.mjs:149` | asserted |
| UPTIME-008 | 3 | The daily aggregate preserves the expected sample count | `tests/e2e/helpers/metrics-flow.mjs:149` | asserted |
| UPTIME-008 | 3 | Daily data inside ninety days remains | `tests/e2e/helpers/metrics-flow.mjs:150` | asserted |
| UPTIME-008 | 3 | Older daily data expires | `tests/e2e/helpers/metrics-flow.mjs:151` | asserted |
| UPTIME-008 | 3 | No unexpected aggregates remain | `tests/e2e/helpers/metrics-flow.mjs:152` | asserted |
| UPTIME-008 | 4 | Inline charts remain present with scripting disabled | `tests/e2e/helpers/metrics-flow.mjs:163` | asserted |
| UPTIME-008 | 4 | A provider chart includes its expected observed-value text summary | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| UPTIME-008 | 5 | The twenty-minute gap has disconnected paths | `tests/e2e/helpers/metrics-flow.mjs:65` | asserted |
| UPTIME-008 | 5 | The gap is labeled with the stopped instant | `tests/e2e/helpers/metrics-flow.mjs:66` | asserted |
| UPTIME-008 | 5 | The gap is labeled with the resumed instant | `tests/e2e/helpers/metrics-flow.mjs:67` | asserted |
| UPTIME-008 | 5 | A stopped source’s timestamp is shown | `tests/e2e/helpers/metrics-flow.mjs:77` | asserted |
| UPTIME-008 | 5 | No interpolated points are created | `tests/e2e/helpers/metrics-flow.mjs:78` | asserted |
| UPTIME-008 | 6 | Ten charts appear at component capacity | `tests/e2e/public-contract.test.mjs:786` | asserted |
| UPTIME-008 | 6 | Ten charts remain within fifty KiB | `tests/e2e/public-contract.test.mjs:789` | asserted |
| UPTIME-008 | 6 | Initial requests remain within four assets | `tests/e2e/public-contract.test.mjs:840` | asserted |
| UPTIME-009 | 1 | CSV is an attached CSV document | `tests/e2e/helpers/availability-report-flow.mjs:105` | asserted |
| UPTIME-009 | 1 | PDF is an attached PDF document | `tests/e2e/helpers/availability-report-flow.mjs:158` | asserted |
| UPTIME-009 | 1 | The CSV summary contains the computed uptime | `tests/e2e/helpers/availability-report-flow.mjs:106` | asserted |
| UPTIME-009 | 1 | The CSV summary contains the expected weighted downtime | `tests/e2e/helpers/availability-report-flow.mjs:106` | asserted |
| UPTIME-009 | 1 | The JSON month report’s incident-membership set exactly equals the nonempty expected set | `tests/e2e/helpers/availability-report-flow.mjs:95` | asserted |
| UPTIME-009 | 1 | The CSV browser download contains a representative retained incident reference | `tests/e2e/helpers/availability-report-browser-flow.mjs:43` | asserted |
| UPTIME-009 | 1 | The CSV month and quarter incident lists are completely reconciled | none | none |
| UPTIME-009 | 1 | The PDF month and quarter incident lists are completely reconciled | none | none |
| UPTIME-009 | 1 | The JSON month report’s maintenance-membership set exactly equals the two expected windows | `tests/e2e/helpers/availability-report-flow.mjs:96` | asserted |
| UPTIME-009 | 1 | Complete maintenance membership is reconciled in the CSV report | none | none |
| UPTIME-009 | 1 | Complete maintenance membership is reconciled in the PDF report | none | none |
| UPTIME-009 | 1 | The quarter includes the before-month incident | `tests/e2e/helpers/availability-report-flow.mjs:111` | asserted |
| UPTIME-009 | 1 | The quarter includes the after-month incident | `tests/e2e/helpers/availability-report-flow.mjs:111` | asserted |
| UPTIME-009 | 1 | The quarter includes the detached incident | `tests/e2e/helpers/availability-report-flow.mjs:111` | asserted |
| UPTIME-009 | 1 | The complete quarter incident-membership set is reconciled | none | none |
| UPTIME-009 | 2 | Report uptime equals the page’s same-window math | `tests/e2e/helpers/availability-report-flow.mjs:103` | asserted |
| UPTIME-009 | 2 | The combined weighted overlap/correction/maintenance fixture has exactly 142.50 downtime minutes | `tests/e2e/helpers/availability-report-flow.mjs:93` | asserted |
| UPTIME-009 | 3 | The month starts at its exact inclusive boundary | `tests/e2e/helpers/availability-report-flow.mjs:91` | asserted |
| UPTIME-009 | 3 | The month ends at its exact exclusive boundary | `tests/e2e/helpers/availability-report-flow.mjs:91` | asserted |
| UPTIME-009 | 3 | The quarter starts at its exact inclusive boundary | `tests/e2e/helpers/availability-report-flow.mjs:110` | asserted |
| UPTIME-009 | 3 | The quarter ends at its exact exclusive boundary | `tests/e2e/helpers/availability-report-flow.mjs:110` | asserted |
| UPTIME-009 | 3 | The local month starts at its exact configured-zone boundary | `tests/e2e/helpers/availability-report-flow.mjs:125` | asserted |
| UPTIME-009 | 3 | The local month ends at its exact configured-zone boundary | `tests/e2e/helpers/availability-report-flow.mjs:125` | asserted |
| UPTIME-009 | 3 | The report names the configured page time zone | `tests/e2e/helpers/availability-report-flow.mjs:124` | asserted |
| UPTIME-009 | 3 | Configured tracking start dates preserve local calendar parity | `tests/e2e/helpers/availability-report-flow.mjs:145` | asserted |
| UPTIME-009 | 4 | The future-period uptime is null | `tests/e2e/helpers/availability-report-flow.mjs:115` | asserted |
| UPTIME-009 | 4 | The future-period downtime is null | `tests/e2e/helpers/availability-report-flow.mjs:115` | asserted |
| UPTIME-009 | 4 | Absent history has no invented uptime | `tests/e2e/helpers/availability-report-flow.mjs:116` | asserted |
| UPTIME-009 | 4 | Short tracked coverage counts only elapsed history | `tests/e2e/helpers/availability-report-flow.mjs:119` | asserted |
| UPTIME-009 | 4 | A current-period report stops at elapsed current time | none | none |
| UPTIME-009 | 5 | Every overlapping scheduled maintenance retains its state label | none | none |
| UPTIME-009 | 5 | Every overlapping cancelled maintenance retains its state label | none | none |
| UPTIME-009 | 5 | Every overlapping completed maintenance retains its state label | none | none |
| UPTIME-009 | 6 | The exact JSON incident-membership set includes the masked claim | `tests/e2e/helpers/availability-report-flow.mjs:95` | asserted |
| UPTIME-009 | 6 | The exact JSON incident-membership set includes legacy public claim history | `tests/e2e/helpers/availability-report-flow.mjs:95` | asserted |
| UPTIME-009 | 6 | The exact JSON incident-membership set includes the legacy release-only claim | `tests/e2e/helpers/availability-report-flow.mjs:95` | asserted |
| UPTIME-010 | 1 | Linked measured availability appears in CSV | none | none |
| UPTIME-010 | 1 | Linked measured availability appears in PDF | none | none |
| UPTIME-010 | 1 | Claimed results remain unchanged when measured figures are added | none | none |
| UPTIME-011 | 1 | The selected audience receives the report on its private page | none | none |
| UPTIME-011 | 1 | The shared numbers equal the component page’s figures | none | none |
| PAGE-005 | 2 | Public snapshot reads issue no database query rather than merely surviving missing tables | none | none |
| COMP-001 | 2 | Partially unavailable outranks Degraded performance | none | none |
| COMP-001 | 2 | Under maintenance outranks Operational | none | none |
| UPTIME-008 | 1 | An eleventh-metric refusal creates no definition | `tests/e2e/helpers/metric-weight-flow.mjs:13` | asserted |
| UPTIME-008 | 1 | An eleventh metric is refused | `tests/e2e/helpers/metric-weight-flow.mjs:12` | asserted |
| INCIDENT-001 | 1 | Investigating | `tests/e2e/publishing-contract.test.mjs:494` | asserted |
| INCIDENT-001 | 1 | Identified | `tests/e2e/publishing-contract.test.mjs:497` | asserted |
| INCIDENT-001 | 1 | Monitoring | none | none |
| INCIDENT-001 | 1 | Resolved | `tests/e2e/publishing-contract.test.mjs:502` | asserted |
| INCIDENT-001 | 1 | exactly one lifecycle | none | none |
| INCIDENT-001 | 2 | starts Investigating | `tests/e2e/publishing-contract.test.mjs:494` | asserted |
| INCIDENT-001 | 3 | published lifecycle | `tests/e2e/publishing-contract.test.mjs:497` | asserted |
| INCIDENT-001 | 3 | no unpublished lifecycle change | none | none |
| INCIDENT-002 | 1 | peak impact | `tests/e2e/publishing-contract.test.mjs:511` | asserted |
| INCIDENT-002 | 2 | resolved peak impact | `tests/e2e/publishing-contract.test.mjs:511` | asserted |
| INCIDENT-002 | 3 | no-component impact absent | none | none |
| INCIDENT-002 | 3 | no-component publication refused | none | none |
| INCIDENT-003 | 1 | numeric reference | `tests/e2e/publishing-contract.test.mjs:518` | asserted |
| INCIDENT-003 | 1 | The numeric-reference permalink returns that incident’s title | `tests/e2e/publishing-contract.test.mjs:522` | asserted |
| INCIDENT-003 | 2 | increasing sequence | `tests/reference-storage/references.test.mjs:30` | asserted |
| INCIDENT-003 | 2 | manual and intake share sequence | none | none |
| INCIDENT-003 | 3 | legacy reference unchanged | `tests/reference-storage/references.test.mjs:22` | asserted |
| INCIDENT-003 | 3 | public address unchanged | none | none |
| INCIDENT-003 | 4 | deletion avoids reuse | `tests/reference-storage/references.test.mjs:26` | asserted |
| INCIDENT-003 | 4 | restart avoids reuse | `tests/reference-storage/references.test.mjs:39` | asserted |
| INCIDENT-003 | 4 | failed reservation safe | `tests/reference-storage/references.test.mjs:48` | asserted |
| INCIDENT-003 | 5 | legacy timestamps do not set sequence | `tests/reference-storage/references.test.mjs:25` | asserted |
| INCIDENT-004 | 1 | original wording retained | `tests/e2e/publishing-contract.test.mjs:546` | asserted |
| INCIDENT-004 | 1 | published deletion refused | none | none |
| INCIDENT-004 | 2 | correction identifies original | `tests/e2e/publishing-contract.test.mjs:543` | asserted |
| INCIDENT-004 | 3 | both updates retained | `tests/e2e/publishing-contract.test.mjs:545` | asserted |
| INCIDENT-004 | 3 | public publication order | none | none |
| INCIDENT-005 | 1 | reopened lifecycle | `tests/e2e/publishing-contract.test.mjs:556` | asserted |
| INCIDENT-005 | 2 | resolution retained | `tests/e2e/publishing-contract.test.mjs:559` | asserted |
| INCIDENT-005 | 2 | reopening retained | `tests/e2e/publishing-contract.test.mjs:558` | asserted |
| INCIDENT-005 | 2 | both public | none | none |
| INCIDENT-006 | 1 | operator overdue | `tests/e2e/publishing-contract.test.mjs:566` | asserted |
| INCIDENT-006 | 2 | no public overdue label | `tests/e2e/publishing-contract.test.mjs:568` | asserted |
| INCIDENT-006 | 2 | public committed time | none | none |
| INCIDENT-007 | 1 | missing reason refused | `tests/e2e/publishing-contract.test.mjs:575` | asserted |
| INCIDENT-007 | 2 | public page removal | none | none |
| INCIDENT-007 | 2 | history removal after demonstrated pre-deletion public visibility | none | none |
| INCIDENT-007 | 2 | Atom removal after demonstrated pre-deletion public visibility | none | none |
| INCIDENT-007 | 2 | ten-second removal | none | none |
| INCIDENT-007 | 3 | deletion actor | none | none |
| INCIDENT-007 | 3 | deletion reason | none | none |
| INCIDENT-007 | 3 | deletion time | none | none |
| INCIDENT-008 | 1 | stored operator note read | none | none |
| INCIDENT-008 | 2 | populated note absent publicly after reading back the stored private note | none | none |
| INCIDENT-008 | 2 | populated note absent from Atom after reading back the stored private note | none | none |
| INCIDENT-008 | 2 | populated note absent from widget after reading back the stored private note | none | none |
| INCIDENT-008 | 2 | note absent from notifications | none | none |
| INCIDENT-008 | 2 | note absent from AI requests | none | none |
| INCIDENT-009 | 1 | first original time | `tests/e2e/publishing-contract.test.mjs:660` | asserted |
| INCIDENT-009 | 1 | resolution original time | `tests/e2e/publishing-contract.test.mjs:667` | asserted |
| INCIDENT-009 | 2 | history first time | `tests/e2e/publishing-contract.test.mjs:689` | asserted |
| INCIDENT-009 | 2 | history resolution time | `tests/e2e/publishing-contract.test.mjs:690` | asserted |
| INCIDENT-009 | 2 | public timeline original times | none | none |
| INCIDENT-009 | 3 | The component has an Operational → Degraded performance transition at the historical start | `tests/e2e/publishing-contract.test.mjs:675` | asserted |
| INCIDENT-009 | 3 | The component has a Degraded performance → Operational transition at the historical end | `tests/e2e/publishing-contract.test.mjs:676` | asserted |
| INCIDENT-009 | 3 | Exactly two rows use those two publication instants | `tests/e2e/publishing-contract.test.mjs:679` | asserted |
| INCIDENT-009 | 3 | A component-bound historical cross-midnight degraded interval contributes fifteen weighted minutes to its first day | `tests/e2e/publishing-contract.test.mjs:760` | asserted |
| INCIDENT-009 | 3 | The same historical interval contributes fifteen weighted minutes to its second day | `tests/e2e/publishing-contract.test.mjs:761` | asserted |
| INCIDENT-009 | 4 | historical zero deliveries | `tests/e2e/publishing-contract.test.mjs:670` | asserted |
| INCIDENT-009 | 4 | later update zero deliveries | `tests/e2e/publishing-contract.test.mjs:697` | asserted |
| INCIDENT-010 | 1 | before lead no reminder | `tests/e2e/update-reminders.test.mjs:92` | asserted |
| INCIDENT-010 | 1 | due at lead | `tests/e2e/update-reminders.test.mjs:188` | asserted |
| INCIDENT-010 | 2 | list due time | `tests/e2e/update-reminders.test.mjs:189` | asserted |
| INCIDENT-010 | 2 | Overview due | `tests/e2e/update-reminders.test.mjs:190` | asserted |
| INCIDENT-010 | 2 | composer and brief action | none | none |
| INCIDENT-010 | 3 | one due email | `tests/e2e/update-reminders.test.mjs:95` | asserted |
| INCIDENT-010 | 3 | one overdue email | `tests/e2e/update-reminders.test.mjs:211` | asserted |
| INCIDENT-010 | 4 | scheduled trigger without browser | `tests/e2e/update-reminders.test.mjs:95` | asserted |
| INCIDENT-010 | 5 | resolved suppression | none | none |
| INCIDENT-010 | 5 | newer-publication suppression | none | none |
| INCIDENT-010 | 5 | retroactive suppression | none | none |
| INCIDENT-010 | 6 | old expired commitment silent | none | none |
| INCIDENT-010 | 7 | public commitment | `tests/e2e/update-reminders.test.mjs:221` | asserted |
| INCIDENT-010 | 7 | no due or overdue label | `tests/e2e/update-reminders.test.mjs:199` | asserted |
| INCIDENT-012 | 1 | Slack private draft | `tests/chat-desk/flow.mjs:95` | asserted |
| INCIDENT-012 | 1 | Teams private draft | `tests/chat-desk/flow.mjs:95` | asserted |
| INCIDENT-012 | 2 | Both selected Teams component identities are staged | `tests/chat-desk/flow.mjs:102` | asserted |
| INCIDENT-012 | 2 | Each selected Teams component is staged as Major outage | `tests/chat-desk/flow.mjs:102` | asserted |
| INCIDENT-012 | 2 | The published update identifies the selected component | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-012 | 2 | The immutable selected component change retains Major outage as its previous state | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-012 | 2 | The immutable selected component change retains Degraded performance as its new state | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-012 | 2 | Slack component choices | none | none |
| INCIDENT-012 | 3 | preview public heading | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 3 | preview lifecycle | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 3 | The visible chat card contains the fixture’s customer-impact wording | `tests/chat-desk/flow.mjs:108` | asserted |
| INCIDENT-012 | 3 | The visible chat card contains every field returned by the web renderer | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 3 | Every required UPDATE-001 field is independently asserted present in that web-renderer field list | none | none |
| INCIDENT-012 | 3 | preview email subject | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 3 | preview complete email text | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 4 | premature publish refused | `tests/chat-desk/flow.mjs:104` | asserted |
| INCIDENT-012 | 4 | operator attribution | `tests/chat-desk/flow.mjs:112` | asserted |
| INCIDENT-012 | 4 | The public page contains the explicitly published incident title | `tests/chat-desk/flow.mjs:113` | asserted |
| INCIDENT-012 | 4 | The public page contains that incident’s customer-impact wording | `tests/chat-desk/flow.mjs:113` | asserted |
| INCIDENT-012 | 4 | chat review parity | none | none |
| INCIDENT-012 | 5 | Teams draft card | `tests/chat-desk/flow.mjs:93` | asserted |
| INCIDENT-012 | 5 | Teams preview card | `tests/chat-desk/flow.mjs:110` | asserted |
| INCIDENT-012 | 6 | one history entry | `tests/chat-desk/flow.mjs:126` | asserted |
| INCIDENT-012 | 6 | The new history row’s previous state is Major outage | `tests/chat-desk/flow.mjs:129` | asserted |
| INCIDENT-012 | 6 | The new history row’s state is Degraded performance | `tests/chat-desk/flow.mjs:129` | asserted |
| INCIDENT-012 | 6 | The history cause type is incident | `tests/chat-desk/flow.mjs:129` | asserted |
| INCIDENT-012 | 6 | The history cause id is the published incident | `tests/chat-desk/flow.mjs:129` | asserted |
| INCIDENT-012 | 6 | The history instant equals that update’s publication time | `tests/chat-desk/flow.mjs:129` | asserted |
| INCIDENT-012 | 6 | The immutable change identifies the transitioned component | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-012 | 6 | Its previous state is Major outage | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-012 | 6 | Its new state is Degraded performance | `tests/chat-desk/flow.mjs:130` | asserted |
| INCIDENT-014 | 1 | Slack linked in Settings | `tests/e2e/helpers/chat-links-browser-flow.mjs:35` | asserted |
| INCIDENT-014 | 1 | A second redemption of the same successfully redeemed code is refused | `tests/chat-desk/flow.mjs:89` | asserted |
| INCIDENT-014 | 1 | After both transport link flows exactly two durable links exist | `tests/chat-desk/flow.mjs:136` | asserted |
| INCIDENT-014 | 1 | Entra linked from Settings | none | none |
| INCIDENT-014 | 2 | unlinked actor creates no incident | `tests/chat-desk/flow.mjs:84` | asserted |
| INCIDENT-014 | 2 | unlinked actor creates no draft | `tests/chat-desk/flow.mjs:84` | asserted |
| INCIDENT-014 | 2 | unlinked actor creates no update | `tests/chat-desk/flow.mjs:84` | asserted |
| INCIDENT-014 | 2 | unlinked actor creates no audit | `tests/chat-desk/flow.mjs:84` | asserted |
| INCIDENT-014 | 3 | invalid Slack signature refused | `tests/chat-desk/flow.mjs:85` | asserted |
| INCIDENT-014 | 3 | stale Slack request refused | `tests/chat-desk/flow.mjs:85` | asserted |
| INCIDENT-014 | 3 | altered Slack body refused | `tests/chat-desk/flow.mjs:85` | asserted |
| INCIDENT-014 | 4 | wrong Teams audience refused | `tests/chat-desk/flow.mjs:85` | asserted |
| INCIDENT-014 | 4 | invalid Teams signature refused | `tests/chat-desk/flow.mjs:85` | asserted |
| INCIDENT-014 | 5 | A formerly linked refused chat actor creates no incident | `tests/chat-desk/flow.mjs:156` | asserted |
| INCIDENT-014 | 5 | A formerly linked refused chat actor creates no update | `tests/chat-desk/flow.mjs:156` | asserted |
| INCIDENT-014 | 5 | A formerly linked refused chat actor creates no draft | `tests/chat-desk/flow.mjs:156` | asserted |
| INCIDENT-014 | 5 | A formerly linked refused chat actor creates no audit entry | `tests/chat-desk/flow.mjs:156` | asserted |
| INCIDENT-014 | 6 | archive retains durable links | `tests/auth-adoption/portability.test.mjs:82` | asserted |
| INCIDENT-014 | 6 | Previously populated link-code authority is absent after archive restore | `tests/auth-adoption/portability.test.mjs:80` | asserted |
| INCIDENT-014 | 6 | Previously populated preview authority is absent after archive restore | `tests/auth-adoption/portability.test.mjs:80` | asserted |
| INCIDENT-014 | 6 | Previously populated replay authority is absent after archive restore | `tests/auth-adoption/portability.test.mjs:80` | asserted |
| INCIDENT-013 | 1 | above derived impact | `tests/e2e/helpers/incident-impact-flow.mjs:52` | asserted |
| INCIDENT-013 | 1 | none below derived impact | `tests/e2e/helpers/incident-impact-flow.mjs:84` | asserted |
| INCIDENT-013 | 1 | clear restores derived | `tests/e2e/helpers/incident-impact-flow.mjs:88` | asserted |
| INCIDENT-013 | 1 | critical choice | none | none |
| INCIDENT-013 | 2 | The incident-specific permalink contains the overridden major impact | `tests/e2e/helpers/incident-impact-flow.mjs:66` | asserted |
| INCIDENT-013 | 2 | The public page’s major-impact marker is bound to this overridden incident | none | none |
| INCIDENT-013 | 2 | The history page’s major-impact marker is bound to this overridden incident | none | none |
| INCIDENT-013 | 2 | public incident API | `tests/e2e/helpers/incident-impact-flow.mjs:61` | asserted |
| INCIDENT-013 | 2 | notifications | none | none |
| INCIDENT-013 | 2 | operator both impacts | `tests/e2e/helpers/incident-impact-flow.mjs:52` | asserted |
| INCIDENT-013 | 3 | Each of the three explicitly enumerated impact changes retains its operator id | `tests/e2e/helpers/incident-impact-flow.mjs:91` | asserted |
| INCIDENT-013 | 3 | Each explicitly enumerated impact change retains the operator name | `tests/e2e/helpers/incident-impact-flow.mjs:91` | asserted |
| INCIDENT-013 | 3 | Each explicitly enumerated impact change retains a valid timestamp | `tests/e2e/helpers/incident-impact-flow.mjs:91` | asserted |
| INCIDENT-013 | 4 | component state unchanged | `tests/e2e/helpers/incident-impact-flow.mjs:72` | asserted |
| INCIDENT-013 | 4 | overall status unchanged | `tests/e2e/helpers/incident-impact-flow.mjs:81` | asserted |
| INCIDENT-013 | 4 | Populated historical uptime day values remain unchanged by the override | none | none |
| INCIDENT-013 | 4 | current uptime figure unchanged | none | none |
| INCIDENT-013 | 5 | imported recorded impact | none | none |
| UPDATE-001 | 1 | component required | none | none |
| UPDATE-001 | 1 | affected audience required | none | none |
| UPDATE-001 | 1 | customer impact required | none | none |
| UPDATE-001 | 1 | unresolved next-update time required | `tests/reference-storage/incident-publishing.test.mjs:135` | asserted |
| UPDATE-001 | 2 | resolved needs no next-update time | `tests/reference-storage/incident-publishing.test.mjs:174` | asserted |
| UPDATE-001 | 2 | A legacy resolved promise is absent from public renderer fields | `tests/reference-storage/incident-publishing.test.mjs:192` | asserted |
| UPDATE-001 | 2 | A legacy resolved promise is absent from email renderer text | `tests/reference-storage/incident-publishing.test.mjs:193` | asserted |
| UPDATE-001 | 3 | what-still-works optional and bounded | none | none |
| UPDATE-001 | 3 | details optional and bounded | none | none |
| UPDATE-001 | 4 | HTML literal | none | none |
| UPDATE-001 | 4 | Markdown literal | none | none |
| UPDATE-001 | 5 | invalid publish refused | `tests/e2e/publishing-contract.test.mjs:303` | asserted |
| UPDATE-001 | 5 | no update | `tests/e2e/publishing-contract.test.mjs:305` | asserted |
| UPDATE-001 | 5 | no recipients | `tests/e2e/publishing-contract.test.mjs:306` | asserted |
| UPDATE-001 | 6 | communication commitment not resolution estimate | none | none |
| UPDATE-002 | 1 | The public root page renders every populated update field | none | none |
| UPDATE-002 | 1 | Atom renders affected-audience wording | `tests/e2e/publishing-contract.test.mjs:350` | asserted |
| UPDATE-002 | 1 | Atom renders customer-impact wording | `tests/e2e/publishing-contract.test.mjs:351` | asserted |
| UPDATE-002 | 1 | Atom renders what-still-works wording | `tests/e2e/publishing-contract.test.mjs:352` | asserted |
| UPDATE-002 | 1 | Atom renders details wording | `tests/e2e/publishing-contract.test.mjs:353` | asserted |
| UPDATE-002 | 1 | Atom renders the populated next-update commitment | none | none |
| UPDATE-002 | 1 | widget renders affected-audience wording | `tests/e2e/publishing-contract.test.mjs:350` | asserted |
| UPDATE-002 | 1 | widget renders customer-impact wording | `tests/e2e/publishing-contract.test.mjs:351` | asserted |
| UPDATE-002 | 1 | widget renders what-still-works wording | `tests/e2e/publishing-contract.test.mjs:352` | asserted |
| UPDATE-002 | 1 | widget renders details wording | `tests/e2e/publishing-contract.test.mjs:353` | asserted |
| UPDATE-002 | 1 | widget renders the populated next-update commitment | none | none |
| UPDATE-002 | 1 | The email preview renders the populated details wording | `tests/e2e/publishing-contract.test.mjs:343` | asserted |
| UPDATE-002 | 1 | The email renders the populated affected-audience wording | none | none |
| UPDATE-002 | 1 | The email renders the populated customer-impact wording | none | none |
| UPDATE-002 | 1 | The email renders the populated what-still-works wording | none | none |
| UPDATE-002 | 1 | The email renders the populated next-update commitment | none | none |
| UPDATE-002 | 2 | absent fields omitted everywhere | none | none |
| UPDATE-003 | 1 | published lifecycle | `tests/e2e/publishing-contract.test.mjs:364` | asserted |
| UPDATE-003 | 2 | end time | `tests/e2e/publishing-contract.test.mjs:365` | asserted |
| UPDATE-003 | 3 | component recomputation | `tests/e2e/publishing-contract.test.mjs:367` | asserted |
| UPDATE-004 | 1 | public preview customer impact | `tests/e2e/app-api.test.mjs:299` | asserted |
| UPDATE-004 | 2 | email preview customer impact | `tests/e2e/app-api.test.mjs:300` | asserted |
| UPDATE-005 | 1 | page excludes populated draft | `tests/e2e/publishing-contract.test.mjs:406` | asserted |
| UPDATE-005 | 1 | Atom excludes populated draft | `tests/e2e/publishing-contract.test.mjs:406` | asserted |
| UPDATE-005 | 1 | widget excludes populated draft | `tests/e2e/publishing-contract.test.mjs:406` | asserted |
| UPDATE-005 | 2 | two-second save | `tests/e2e/publishing-browser.test.mjs:449` | asserted |
| UPDATE-005 | 2 | Reload retains the exact details value | `tests/e2e/publishing-browser.test.mjs:453` | asserted |
| UPDATE-005 | 2 | Reload retains the next-update instant in the configured local-time control | `tests/e2e/publishing-browser.test.mjs:454` | asserted |
| UPDATE-005 | 2 | Reload independently asserts unchanged audience | none | none |
| UPDATE-005 | 2 | Reload independently asserts unchanged impact | none | none |
| UPDATE-005 | 2 | Reload independently asserts unchanged what-still-works | none | none |
| UPDATE-005 | 2 | Reload independently asserts unchanged lifecycle | none | none |
| UPDATE-005 | 3 | After publication the next draft’s affected-audience input is empty | `tests/e2e/publishing-browser.test.mjs:290` | asserted |
| UPDATE-005 | 3 | After publication the next draft’s other wording fields are independently asserted empty | none | none |
| UPDATE-005 | 3 | lifecycle prompts | none | none |
| UPDATE-005 | 4 | stale tab cannot revive publication | none | none |
| UPDATE-005 | 4 | stale tab cannot overwrite newer draft | none | none |
| UPDATE-005 | 5 | draft write requires acknowledged version | none | none |
| UPDATE-005 | 5 | template requires acknowledged version | none | none |
| UPDATE-005 | 5 | schedule requires acknowledged version | none | none |
| UPDATE-005 | 5 | publication requires acknowledged version | none | none |
| UPDATE-005 | 6 | fresh draft not falsely saved | none | none |
| UPDATE-005 | 6 | Publish requires acknowledged complete draft | none | none |
| UPDATE-005 | 7 | attempted write identified | none | none |
| UPDATE-005 | 7 | later workflow changes retained | none | none |
| UPDATE-006 | 1 | After its scheduled trigger the specific incident permalink contains the scheduled draft’s unique wording | `tests/e2e/publishing-contract.test.mjs:427` | asserted |
| UPDATE-006 | 1 | 240-second bound | none | none |
| UPDATE-006 | 2 | public privacy before time | `tests/e2e/publishing-contract.test.mjs:424` | asserted |
| UPDATE-006 | 2 | no early notification | none | none |
| UPDATE-006 | 3 | review hold stays draft | none | none |
| UPDATE-006 | 3 | operator notice for held schedule | none | none |
| UPDATE-007 | 1 | unreviewed publication refused | none | none |
| UPDATE-007 | 2 | reviewer recorded | none | none |
| UPDATE-007 | 2 | review time recorded | none | none |
| UPDATE-007 | 3 | review-disabled publication succeeds | none | none |
| UPDATE-008 | 1 | update once | `tests/e2e/publishing-contract.test.mjs:330` | asserted |
| UPDATE-008 | 1 | recipients once | `tests/e2e/publishing-contract.test.mjs:329` | asserted |
| UPDATE-008 | 2 | narrowing preserves delivery | none | none |
| UPDATE-008 | 2 | unsubscribe suppresses delivery | none | none |
| UPDATE-008 | 3 | failed update not public | none | none |
| UPDATE-008 | 3 | no failed recipient | `tests/e2e/publishing-contract.test.mjs:306` | asserted |
| UPDATE-008 | 4 | retry to success | none | none |
| UPDATE-008 | 4 | dispatch does not block | none | none |
| UPDATE-009 | 1 | lifecycle retained | `tests/e2e/publishing-contract.test.mjs:480` | asserted |
| UPDATE-009 | 1 | details retained | `tests/e2e/publishing-contract.test.mjs:481` | asserted |
| UPDATE-009 | 1 | other fields retained | none | none |
| UPDATE-009 | 1 | components and claims retained | none | none |
| UPDATE-009 | 2 | no publication | `tests/e2e/publishing-contract.test.mjs:482` | asserted |
| UPDATE-009 | 2 | not public | `tests/e2e/publishing-contract.test.mjs:483` | asserted |
| UPDATE-009 | 2 | composer and staged choices | none | none |
| UPDATE-011 | 1 | resolution-time promise finding | none | none |
| UPDATE-011 | 1 | internal hostname finding | none | none |
| UPDATE-011 | 1 | IP address finding | none | none |
| UPDATE-011 | 1 | email address finding | none | none |
| UPDATE-011 | 1 | owner-blocked term finding | none | none |
| UPDATE-011 | 1 | owner length finding | none | none |
| UPDATE-011 | 2 | beside field | none | none |
| UPDATE-011 | 2 | rule named | none | none |
| UPDATE-011 | 2 | dismissal | none | none |
| UPDATE-011 | 3 | findings do not block | none | none |
| UPDATE-013 | 1 | own URL visible | `tests/e2e/helpers/update-link-evidence.mjs:17` | asserted |
| UPDATE-013 | 2 | period outside | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 2 | Trailing comma stays outside the direct link | `tests/e2e/helpers/update-link-evidence.mjs:12` | asserted |
| UPDATE-013 | 2 | Trailing closing parenthesis stays outside the direct link | `tests/e2e/helpers/update-link-evidence.mjs:12` | asserted |
| UPDATE-013 | 3 | markup escaped | `tests/e2e/helpers/update-link-evidence.mjs:14` | asserted |
| UPDATE-013 | 3 | JavaScript-scheme input remains literal text | `tests/e2e/helpers/update-link-evidence.mjs:15` | asserted |
| UPDATE-013 | 3 | HTTP-scheme input remains literal text | `tests/e2e/helpers/update-link-evidence.mjs:15` | asserted |
| UPDATE-013 | 3 | Data-scheme input remains literal text | `tests/e2e/helpers/update-link-evidence.mjs:15` | asserted |
| UPDATE-013 | 3 | no non-HTTPS link | `tests/e2e/helpers/update-link-evidence.mjs:16` | asserted |
| UPDATE-013 | 4 | The public root page links the fixture’s exact HTTPS URL with its URL as text | `tests/e2e/publishing-contract.test.mjs:379` | asserted |
| UPDATE-013 | 4 | history direct links | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 4 | permalink direct links | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 4 | Atom direct links have the exact expected destination and URL text | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 4 | RSS direct links have the exact expected destination and URL text | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 4 | source alias direct links have the exact expected destination and URL text | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 4 | component feed direct links have the exact expected destination and URL text | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-013 | 5 | The populated fixture links carry nofollow | `tests/resolve-composer/linked-update-flow.mjs:74` | asserted |
| UPDATE-013 | 5 | The populated fixture links carry noopener | `tests/resolve-composer/linked-update-flow.mjs:74` | asserted |
| UPDATE-013 | 5 | The populated fixture links carry ugc | `tests/resolve-composer/linked-update-flow.mjs:74` | asserted |
| UPDATE-013 | 5 | unchanged content policy | `tests/e2e/helpers/update-link-evidence.mjs:36` | asserted |
| UPDATE-013 | 6 | internal-hostname finding | `tests/resolve-composer/linked-update-flow.mjs:34` | asserted |
| UPDATE-013 | 6 | IP-address finding | `tests/resolve-composer/linked-update-flow.mjs:35` | asserted |
| UPDATE-016 | 1 | Email text retains affected-audience wording | `tests/e2e/helpers/review-update-flow.mjs:83` | asserted |
| UPDATE-016 | 1 | Email text retains customer-impact wording with its bare URL | `tests/e2e/helpers/review-update-flow.mjs:83` | asserted |
| UPDATE-016 | 1 | Email text retains what-still-works wording with its bare URLs | `tests/e2e/helpers/review-update-flow.mjs:83` | asserted |
| UPDATE-016 | 1 | Email text retains details wording with its bare URLs | `tests/e2e/helpers/review-update-flow.mjs:83` | asserted |
| UPDATE-016 | 1 | Email HTML contains the exact named HTTPS destination without redirect | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-016 | 1 | Email HTML uses the URL itself as visible link text | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-016 | 1 | Email HTML leaves the period outside the link | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-016 | 1 | Email HTML leaves comma and closing parenthesis outside links | `tests/e2e/helpers/update-link-evidence.mjs:12` | asserted |
| UPDATE-016 | 2 | Provider click tracking is disabled | `tests/e2e/helpers/review-update-flow.mjs:79` | asserted |
| UPDATE-016 | 2 | Provider text click tracking is disabled | `tests/e2e/helpers/review-update-flow.mjs:79` | asserted |
| UPDATE-016 | 2 | Provider open tracking is disabled | `tests/e2e/helpers/review-update-flow.mjs:79` | asserted |
| UPDATE-016 | 2 | Provider analytics tracking is disabled | `tests/e2e/helpers/review-update-flow.mjs:79` | asserted |
| UPDATE-016 | 2 | The fixture email link points to its exact original destination | `tests/e2e/helpers/update-link-evidence.mjs:11` | asserted |
| UPDATE-016 | 3 | Slack URL itself | `tests/e2e/helpers/update-link-evidence.mjs:41` | asserted |
| UPDATE-016 | 3 | Slack places a comma outside its link | `tests/e2e/helpers/update-link-evidence.mjs:42` | asserted |
| UPDATE-016 | 3 | Slack places a closing parenthesis outside its link | `tests/e2e/helpers/update-link-evidence.mjs:42` | asserted |
| UPDATE-016 | 3 | Slack places a period outside its link | `tests/e2e/helpers/update-link-evidence.mjs:41` | asserted |
| UPDATE-016 | 3 | no labelled links | `tests/e2e/helpers/update-link-evidence.mjs:45` | asserted |
| UPDATE-016 | 4 | Teams link labels equal their destination URL | `tests/e2e/channels-and-presets.test.mjs:145` | asserted |
| UPDATE-016 | 4 | The fixture’s exact direct destination is present in a Teams link | `tests/e2e/channels-and-presets.test.mjs:142` | asserted |
| UPDATE-016 | 4 | Teams leaves the comma outside its link | `tests/e2e/channels-and-presets.test.mjs:143` | asserted |
| UPDATE-016 | 4 | Teams leaves the closing parenthesis outside its link | `tests/e2e/channels-and-presets.test.mjs:143` | asserted |
| UPDATE-016 | 4 | Teams leaves the period outside its link | `tests/e2e/channels-and-presets.test.mjs:142` | asserted |
| UPDATE-016 | 5 | Slack retains literal JavaScript-scheme text | `tests/e2e/helpers/update-link-evidence.mjs:44` | asserted |
| UPDATE-016 | 5 | Slack retains literal HTTP-scheme text | `tests/e2e/helpers/update-link-evidence.mjs:44` | asserted |
| UPDATE-016 | 5 | Slack retains literal data-scheme text | `tests/e2e/helpers/update-link-evidence.mjs:44` | asserted |
| UPDATE-016 | 5 | Teams retains literal JavaScript-scheme text | `tests/e2e/channels-and-presets.test.mjs:150` | asserted |
| UPDATE-016 | 5 | Teams retains literal data-scheme text | `tests/e2e/channels-and-presets.test.mjs:150` | asserted |
| UPDATE-016 | 5 | Teams independently asserts literal HTTP-scheme text | none | none |
| UPDATE-017 | 1 | Lamp fields byte-for-byte | none | none |
| UPDATE-017 | 2 | Slack fields reassemble | `tests/e2e/helpers/review-update-flow.mjs:98` | asserted |
| UPDATE-017 | 2 | Slack link text equals URL | `tests/e2e/helpers/review-update-flow.mjs:99` | asserted |
| UPDATE-017 | 2 | only HTTPS links | `tests/e2e/helpers/review-update-flow.mjs:100` | asserted |
| UPDATE-017 | 2 | Slack-webhook text retains period punctuation outside its URL | `tests/e2e/helpers/update-link-evidence.mjs:41` | asserted |
| UPDATE-017 | 2 | Slack-webhook text retains comma punctuation outside its URL | `tests/e2e/helpers/update-link-evidence.mjs:42` | asserted |
| UPDATE-017 | 2 | Slack-webhook text retains closing-parenthesis punctuation outside its URL | `tests/e2e/helpers/update-link-evidence.mjs:42` | asserted |
| UPDATE-017 | 2 | Slack-webhook text escapes literal HTML markup | `tests/e2e/helpers/update-link-evidence.mjs:43` | asserted |
| UPDATE-017 | 2 | Slack-webhook text retains JavaScript, HTTP and data input as literal text | `tests/e2e/helpers/update-link-evidence.mjs:44` | asserted |
| UPDATE-017 | 3 | The Lamp-format subscriber signature verifies over the exact delivered body | `tests/e2e/helpers/review-update-flow.mjs:89` | asserted |
| UPDATE-017 | 3 | The Slack-format subscriber signature verifies over the exact delivered body | `tests/e2e/helpers/review-update-flow.mjs:89` | asserted |
| MAINT-001 | 1 | window and attachments retained | none | none |
| MAINT-001 | 1 | separate incident/maintenance display | none | none |
| MAINT-001 | 2 | independent SCH sequence | `tests/reference-storage/references.test.mjs:27` | asserted |
| MAINT-001 | 3 | legacy reference unchanged | `tests/reference-storage/references.test.mjs:23` | asserted |
| MAINT-001 | 3 | SCH sequence survives restart | `tests/reference-storage/references.test.mjs:41` | asserted |
| MAINT-001 | 3 | deleted and failed SCH reference never reused | none | none |
| MAINT-002 | 1 | scheduled event starts | `tests/e2e/publishing-contract.test.mjs:890` | asserted |
| MAINT-002 | 1 | 240-second start bound | none | none |
| MAINT-002 | 2 | scheduled event completes | `tests/e2e/publishing-contract.test.mjs:892` | asserted |
| MAINT-002 | 2 | 240-second completion bound | none | none |
| MAINT-003 | 1 | Under maintenance during window | `tests/e2e/publishing-contract.test.mjs:969` | asserted |
| MAINT-003 | 2 | claim released on completion | `tests/e2e/publishing-contract.test.mjs:972` | asserted |
| MAINT-003 | 2 | no claim before start | `tests/e2e/publishing-contract.test.mjs:966` | asserted |
| MAINT-003 | 3 | operator claim survives | none | none |
| MAINT-003 | 3 | incident claim survives | none | none |
| MAINT-003 | 3 | aggregate reconciles throughout | none | none |
| MAINT-004 | 1 | public overrun | `tests/e2e/publishing-contract.test.mjs:1040` | asserted |
| MAINT-004 | 1 | original end beside it | `tests/e2e/publishing-contract.test.mjs:1041` | asserted |
| MAINT-004 | 1 | no label before threshold | `tests/e2e/publishing-contract.test.mjs:1032` | asserted |
| MAINT-004 | 2 | completion removes label | `tests/e2e/publishing-contract.test.mjs:1070` | asserted |
| MAINT-004 | 2 | extension removes label | `tests/e2e/publishing-contract.test.mjs:1064` | asserted |
| MAINT-004 | 3 | start preserved | `tests/e2e/publishing-contract.test.mjs:1054` | asserted |
| MAINT-004 | 3 | end changed | `tests/e2e/publishing-contract.test.mjs:1055` | asserted |
| MAINT-004 | 3 | overrun cleared | `tests/e2e/publishing-contract.test.mjs:1056` | asserted |
| MAINT-005 | 1 | A scheduled maintenance notice record exists | `tests/e2e/publishing-contract.test.mjs:1084` | asserted |
| MAINT-005 | 1 | The scheduling notice reaches subscribers | none | none |
| MAINT-005 | 1 | A twenty-four-hour reminder notice record exists | `tests/e2e/publishing-contract.test.mjs:1087` | asserted |
| MAINT-005 | 1 | The twenty-four-hour reminder reaches subscribers | none | none |
| MAINT-005 | 1 | start subscriber notification | none | none |
| MAINT-005 | 1 | completion subscriber notification | none | none |
| MAINT-006 | 1 | reschedule notice | `tests/e2e/publishing-contract.test.mjs:1099` | asserted |
| MAINT-006 | 1 | all previous recipients notified | none | none |
| MAINT-006 | 2 | cancel notice | `tests/e2e/publishing-contract.test.mjs:1100` | asserted |
| MAINT-006 | 2 | same previous recipients notified | none | none |
| MAINT-006 | 3 | upcoming removal within ten seconds | none | none |
| MAINT-006 | 3 | cancelled record retained | `tests/e2e/publishing-contract.test.mjs:1098` | asserted |
| MAINT-006 | 3 | public history labelled cancelled | none | none |
| MAINT-007 | 1 | The calendar parses as a vcalendar component | `tests/e2e/helpers/maintenance-calendar-flow.mjs:48` | asserted |
| MAINT-007 | 1 | The envelope begins with VCALENDAR | `tests/e2e/helpers/maintenance-calendar-flow.mjs:10` | asserted |
| MAINT-007 | 1 | The envelope ends with VCALENDAR | `tests/e2e/helpers/maintenance-calendar-flow.mjs:11` | asserted |
| MAINT-007 | 1 | Calendar component nesting is balanced | `tests/e2e/helpers/maintenance-calendar-flow.mjs:21` | asserted |
| MAINT-007 | 1 | scheduled event | `tests/e2e/helpers/maintenance-calendar-flow.mjs:101` | asserted |
| MAINT-007 | 1 | In progress UID stable | `tests/e2e/helpers/maintenance-calendar-flow.mjs:110` | asserted |
| MAINT-007 | 2 | reschedule keeps UID | `tests/e2e/helpers/maintenance-calendar-flow.mjs:106` | asserted |
| MAINT-007 | 2 | sequence increases | `tests/e2e/helpers/maintenance-calendar-flow.mjs:105` | asserted |
| MAINT-007 | 3 | cancelled event status | `tests/e2e/helpers/maintenance-calendar-flow.mjs:116` | asserted |
| MAINT-007 | 4 | valid empty feed | `tests/e2e/helpers/maintenance-calendar-flow.mjs:64` | asserted |
| MAINT-007 | 4 | event UID required | `tests/e2e/helpers/maintenance-calendar-flow.mjs:30` | asserted |
| MAINT-007 | 4 | Timezone observances retain DTSTART | `tests/e2e/helpers/maintenance-calendar-flow.mjs:38` | asserted |
| MAINT-007 | 4 | Timezone retains its identifier | `tests/e2e/helpers/maintenance-calendar-flow.mjs:34` | asserted |
| MAINT-007 | 4 | Timezone retains a STANDARD or DAYLIGHT observance | `tests/e2e/helpers/maintenance-calendar-flow.mjs:36` | asserted |
| MAINT-007 | 4 | Timezone observance retains its source offset | `tests/e2e/helpers/maintenance-calendar-flow.mjs:41` | asserted |
| MAINT-007 | 4 | Timezone observance retains its destination offset | `tests/e2e/helpers/maintenance-calendar-flow.mjs:41` | asserted |
| MAINT-007 | 5 | After a known later public-generation barrier, the calendar omits the internal-only window id | `tests/e2e/helpers/maintenance-calendar-flow.mjs:125` | asserted |
| MAINT-007 | 5 | After that same barrier, the calendar omits the internal-only window title | `tests/e2e/helpers/maintenance-calendar-flow.mjs:125` | asserted |
| MAINT-007 | 5 | internal component name excluded | `tests/e2e/helpers/maintenance-calendar-flow.mjs:127` | asserted |
| MAINT-007 | 5 | internal component id excluded | `tests/e2e/helpers/maintenance-calendar-flow.mjs:128` | asserted |
| UPDATE-001 | 2 | legacy resolved time omitted by every public and notification surface | none | none |
| MAINT-007 | 4 | event timestamp required | `tests/e2e/helpers/maintenance-calendar-flow.mjs:31` | asserted |
| UPDATE-004 | 1 | composer displays the public preview | none | none |
| UPDATE-004 | 2 | composer displays the email preview | none | none |
| UPDATE-013 | 3 | Markdown remains literal on every public surface | none | none |
| UPDATE-013 | 3 | labelled-link syntax remains literal on every public surface | none | none |
| UPDATE-016 | 5 | Slack escapes author HTML markup as literal text | `tests/e2e/helpers/update-link-evidence.mjs:43` | asserted |
| UPDATE-016 | 5 | Slack retains author Markdown as literal text | `tests/e2e/channels-and-presets.test.mjs:136` | asserted |
| UPDATE-016 | 5 | Teams retains literal Markdown | `tests/e2e/channels-and-presets.test.mjs:149` | asserted |
| UPDATE-016 | 5 | Teams independently asserts retained escaped HTML markup | none | none |
| MAINT-007 | 4 | calendar CRLF exclusive | `tests/e2e/helpers/maintenance-calendar-flow.mjs:7` | asserted |
| MAINT-007 | 4 | folding bound | `tests/e2e/helpers/maintenance-calendar-flow.mjs:8` | asserted |
| MAINT-007 | 4 | calendar version | `tests/e2e/helpers/maintenance-calendar-flow.mjs:12` | asserted |
| MAINT-007 | 4 | calendar product identifier | `tests/e2e/helpers/maintenance-calendar-flow.mjs:13` | asserted |
| MAINT-007 | 4 | balanced calendar components | `tests/e2e/helpers/maintenance-calendar-flow.mjs:21` | asserted |
| MAINT-007 | 4 | timezone identifier | `tests/e2e/helpers/maintenance-calendar-flow.mjs:34` | asserted |
| MAINT-007 | 4 | timezone observance present | `tests/e2e/helpers/maintenance-calendar-flow.mjs:36` | asserted |
| MAINT-007 | 4 | Every populated timezone observance has TZOFFSETFROM | `tests/e2e/helpers/maintenance-calendar-flow.mjs:41` | asserted |
| MAINT-007 | 4 | Every populated timezone observance has TZOFFSETTO | `tests/e2e/helpers/maintenance-calendar-flow.mjs:41` | asserted |
| SUB-001 | 1 | pending subscription | `tests/e2e/delivery-contract.test.mjs:140` | asserted |
| SUB-001 | 1 | one captured confirmation envelope | `tests/e2e/delivery-contract.test.mjs:119` | asserted |
| SUB-001 | 1 | captured envelope contains its confirmation link | `tests/e2e/delivery-contract.test.mjs:120` | asserted |
| SUB-001 | 1 | confirmation recipient equals the submitted address | none | none |
| SUB-001 | 1 | confirmation within 60 seconds | none | none |
| SUB-001 | 2 | concurrent confirmation reservation | `tests/e2e/delivery-contract.test.mjs:141` | asserted |
| SUB-001 | 2 | 24-hour expiry of confirmation allowance | none | none |
| SUB-001 | 3 | unsubscribe restores the allowance immediately | none | none |
| SUB-001 | 4 | absence of other notifications while pending | none | none |
| SUB-001 | 5 | standard script-free form | `tests/e2e/app-api.test.mjs:144` | asserted |
| SUB-001 | 5 | cross-site refusal asserted in tests/e2e/subscriber-isolation-helper.mjs outside the old Evidence set | none | none |
| SUB-001 | 5 | no form token or ambient session requirement | none | none |
| SUB-002 | 1 | pending before confirmation | `tests/e2e/delivery-contract.test.mjs:190` | asserted |
| SUB-002 | 2 | active after confirmation | `tests/e2e/delivery-contract.test.mjs:193` | asserted |
| SUB-003 | 1 | a very old pending subscriber row is absent after expiry runs | `tests/e2e/delivery-contract.test.mjs:205` | asserted |
| SUB-003 | 1 | expiry takes effect at the specified 72-hour boundary | none | none |
| SUB-004 | 1 | initial selected components | `tests/e2e/delivery-contract.test.mjs:454` | asserted |
| SUB-004 | 1 | management selected or all | `tests/e2e/delivery-contract.test.mjs:460` | asserted |
| SUB-004 | 2 | incident recipient selection | `tests/e2e/delivery-contract.test.mjs:240` | asserted |
| SUB-004 | 2 | maintenance recipient selection | none | none |
| SUB-004 | 3 | all-components subscriber follows new components | none | none |
| SUB-004 | 3 | narrowed selection unchanged by component creation | none | none |
| SUB-004 | 4 | newly eligible catch-up recipient | `tests/e2e/delivery-contract.test.mjs:321` | asserted |
| SUB-004 | 4 | one catch-up email | `tests/e2e/delivery-contract.test.mjs:327` | asserted |
| SUB-004 | 4 | catch-up contains the latest published impact | `tests/e2e/delivery-contract.test.mjs:327` | asserted |
| SUB-004 | 4 | catch-up excludes the earlier published impact | `tests/e2e/delivery-contract.test.mjs:327` | asserted |
| SUB-004 | 4 | previous recipient excluded | `tests/e2e/delivery-contract.test.mjs:323` | asserted |
| SUB-004 | 4 | subsequent updates continue | `tests/e2e/delivery-contract.test.mjs:335` | asserted |
| SUB-005 | 1 | one-subscription scope and no unrelated capability | none | none |
| SUB-005 | 1 | at least 128 bits of entropy | none | none |
| SUB-005 | 2 | a previously usable management token is refused after unsubscribe | none | none |
| SUB-005 | 2 | deletion revokes every token | none | none |
| SUB-005 | 3 | referrer suppression | `tests/e2e/delivery-contract.test.mjs:402` | asserted |
| SUB-005 | 3 | indexing suppression | `tests/e2e/delivery-contract.test.mjs:419` | asserted |
| SUB-006 | 1 | mail unsubscribe value is present | `tests/e2e/delivery-contract.test.mjs:603` | asserted |
| SUB-006 | 1 | web unsubscribe value is present | `tests/e2e/delivery-contract.test.mjs:603` | asserted |
| SUB-006 | 1 | one-click declaration | `tests/e2e/delivery-contract.test.mjs:602` | asserted |
| SUB-006 | 1 | visible unsubscribe link in notification body | none | none |
| SUB-006 | 2 | URL-encoded deactivation | `tests/e2e/delivery-contract.test.mjs:403` | asserted |
| SUB-006 | 2 | empty response | `tests/e2e/delivery-contract.test.mjs:439` | asserted |
| SUB-006 | 2 | no redirect | `tests/e2e/delivery-contract.test.mjs:440` | asserted |
| SUB-006 | 2 | multipart form deactivation | none | none |
| SUB-006 | 3 | DKIM coverage of both unsubscribe headers | none | none |
| SUB-006 | 4 | per-token allowance independence | none | none |
| SUB-007 | 1 | management page opens | `tests/e2e/delivery-contract.test.mjs:418` | asserted |
| SUB-007 | 1 | saved component selection shown | `tests/e2e/delivery-contract.test.mjs:463` | asserted |
| SUB-007 | 1 | channel shown | none | none |
| SUB-007 | 2 | selection persists | `tests/e2e/delivery-contract.test.mjs:460` | asserted |
| SUB-007 | 2 | management unsubscribe works | `tests/e2e/delivery-contract.test.mjs:439` | asserted |
| SUB-008 | 1 | post-deactivation send suppressed | `tests/e2e/delivery-contract.test.mjs:517` | asserted |
| SUB-008 | 2 | zero sends after committed deactivation | `tests/e2e/delivery-contract.test.mjs:517` | asserted |
| SUB-008 | 2 | suppressed outcome | `tests/e2e/delivery-contract.test.mjs:518` | asserted |
| SUB-009 | 1 | webhook subscription creation read back | none | none |
| SUB-009 | 2 | two active signature values | `tests/e2e/delivery-contract.test.mjs:678` | asserted |
| SUB-009 | 2 | exact-body signature | `tests/e2e/helpers/review-update-flow.mjs:89` | asserted |
| SUB-009 | 2 | both rotation signatures verify | none | none |
| SUB-009 | 3 | incident reference | `tests/e2e/delivery-contract.test.mjs:681` | asserted |
| SUB-009 | 3 | complete update array | none | none |
| SUB-009 | 3 | complete previous/new component states | none | none |
| SUB-009 | 3 | subscriber address absent | `tests/e2e/delivery-contract.test.mjs:683` | asserted |
| SUB-009 | 4 | one webhook transport request is sent | `tests/e2e/delivery-contract.test.mjs:677` | asserted |
| SUB-009 | 4 | a successful receiver response records delivered | `tests/e2e/delivery-contract.test.mjs:981` | asserted |
| SUB-009 | 4 | 30-second receiver deadline | none | none |
| SUB-009 | 4 | redirect fails | `tests/e2e/delivery-contract.test.mjs:686` | asserted |
| SUB-009 | 5 | rich-text fields reassemble | `tests/e2e/helpers/review-update-flow.mjs:98` | asserted |
| SUB-009 | 5 | rich-text URL labels equal their URLs on a nonempty set of link elements | none | none |
| SUB-009 | 5 | Slack bracket and punctuation asserted in tests/e2e/helpers/update-link-evidence.mjs outside the old Evidence set | none | none |
| SUB-009 | 6 | all Lamp fields are asserted in tests/e2e/helpers/update-component-flow.mjs outside the old Evidence set | none | none |
| SUB-010 | 1 | hard bounce deactivates the subscriber | `tests/e2e/delivery-contract.test.mjs:703` | asserted |
| SUB-010 | 1 | hard-bounce reason is recorded | `tests/e2e/delivery-contract.test.mjs:703` | asserted |
| SUB-010 | 2 | spam complaint deactivates the subscriber | `tests/e2e/delivery-contract.test.mjs:794` | asserted |
| SUB-010 | 2 | spam-complaint reason is recorded | `tests/e2e/delivery-contract.test.mjs:794` | asserted |
| SUB-010 | 3 | five soft bounces deactivate the subscriber | `tests/e2e/delivery-contract.test.mjs:783` | asserted |
| SUB-010 | 3 | five-soft-bounce reason is recorded | `tests/e2e/delivery-contract.test.mjs:783` | asserted |
| SUB-010 | 4 | ten failed webhook deliveries deactivate the subscriber | `tests/e2e/delivery-contract.test.mjs:721` | asserted |
| SUB-010 | 4 | ten-failure reason is recorded | `tests/e2e/delivery-contract.test.mjs:721` | asserted |
| SUB-010 | 4 | contact notification | `tests/e2e/delivery-contract.test.mjs:723` | asserted |
| SUB-010 | 5 | repeating the already-dispatched complained delivery sends no second message | `tests/e2e/delivery-contract.test.mjs:796` | asserted |
| SUB-010 | 5 | a fresh notification after the complaint is suppressed | none | none |
| SUB-010 | 5 | post-deactivation pending webhook backlog sends nothing | none | none |
| SUB-011 | 1 | the expected 101st fixture subscriber appears on the second page | `tests/e2e/delivery-contract.test.mjs:1044` | asserted |
| SUB-011 | 1 | the complete subscriber identity set reconciles across all pages | none | none |
| SUB-011 | 2 | channel | `tests/e2e/delivery-contract.test.mjs:758` | asserted |
| SUB-011 | 2 | deactivated state | `tests/e2e/delivery-contract.test.mjs:759` | asserted |
| SUB-011 | 2 | pending and active states visible in operator view | none | none |
| SUB-011 | 2 | the operator list preserves the exact selected component identifiers | `tests/e2e/delivery-contract.test.mjs:460` | asserted |
| SUB-011 | 2 | deactivation reason | `tests/e2e/delivery-contract.test.mjs:760` | asserted |
| SUB-011 | 2 | deactivation time | `tests/e2e/delivery-contract.test.mjs:762` | asserted |
| SUB-011 | 3 | webhook endpoint anonymized | `tests/e2e/delivery-contract.test.mjs:764` | asserted |
| SUB-011 | 3 | email address anonymized | `tests/e2e/delivery-contract.test.mjs:639` | asserted |
| SUB-012 | 1 | same status | `tests/e2e/delivery-contract.test.mjs:489` | asserted |
| SUB-012 | 1 | same body | `tests/e2e/delivery-contract.test.mjs:490` | asserted |
| SUB-012 | 1 | duplicate subscription absence | none | none |
| SUB-012 | 2 | the existing-address email contains its management link | `tests/e2e/delivery-contract.test.mjs:491` | asserted |
| SUB-012 | 2 | repeated submissions send no second management email per address | `tests/e2e/delivery-contract.test.mjs:503` | asserted |
| SUB-012 | 2 | no confirmation link | `tests/e2e/delivery-contract.test.mjs:492` | asserted |
| SUB-012 | 2 | only management content in email | none | none |
| SUB-014 | 1 | named public control | none | none |
| SUB-014 | 1 | minimal OAuth scope | `tests/e2e/slack-subscriptions-helper.mjs:44` | asserted |
| SUB-014 | 1 | selected components persisted | none | none |
| SUB-014 | 2 | active Slack state | `tests/e2e/slack-subscriptions-helper.mjs:62` | asserted |
| SUB-014 | 2 | sealed Slack URL | `tests/e2e/slack-subscriptions-helper.mjs:63` | asserted |
| SUB-014 | 3 | next publication once | `tests/e2e/slack-subscriptions-helper.mjs:68` | asserted |
| SUB-014 | 3 | bare URL with outside punctuation | `tests/e2e/slack-subscriptions-helper.mjs:69` | asserted |
| SUB-014 | 4 | uninstalled state and reason | `tests/e2e/slack-subscriptions-helper.mjs:79` | asserted |
| SUB-014 | 4 | uninstalled next publish absent | `tests/e2e/helpers/self-serve-chat-flow.mjs:52` | asserted |
| SUB-014 | 4 | revoked next publish absent | `tests/e2e/helpers/self-serve-chat-flow.mjs:57` | asserted |
| SUB-014 | 4 | archived state and reason | `tests/e2e/helpers/self-serve-chat-flow.mjs:68` | asserted |
| SUB-014 | 4 | archived next publish absent | `tests/e2e/helpers/self-serve-chat-flow.mjs:72` | asserted |
| SUB-014 | 5 | recorded OAuth exchange fields | `tests/e2e/helpers/self-serve-chat-flow.mjs:17` | asserted |
| SUB-014 | 5 | recorded uninstall state | `tests/e2e/slack-subscriptions-helper.mjs:79` | asserted |
| SUB-015 | 1 | non-Microsoft refusal | `tests/e2e/teams-subscriptions-helper.mjs:30` | asserted |
| SUB-015 | 1 | the refused non-Microsoft destination receives no outbound card | none | none |
| SUB-015 | 2 | one verification card | `tests/e2e/teams-subscriptions-helper.mjs:53` | asserted |
| SUB-015 | 2 | card receipt pending | `tests/e2e/teams-subscriptions-helper.mjs:57` | asserted |
| SUB-015 | 2 | link open pending | `tests/e2e/teams-subscriptions-helper.mjs:60` | asserted |
| SUB-015 | 2 | confirmed active | `tests/e2e/teams-subscriptions-helper.mjs:68` | asserted |
| SUB-015 | 3 | one next publication card | `tests/e2e/teams-subscriptions-helper.mjs:77` | asserted |
| SUB-015 | 3 | Adaptive Card type | `tests/e2e/teams-subscriptions-helper.mjs:79` | asserted |
| SUB-015 | 4 | link label is URL | `tests/e2e/teams-subscriptions-helper.mjs:83` | asserted |
| SUB-015 | 4 | secure-web URLs only | `tests/e2e/teams-subscriptions-helper.mjs:84` | asserted |
| SUB-015 | 4 | other schemes not linked | `tests/e2e/teams-subscriptions-helper.mjs:86` | asserted |
| SUB-015 | 4 | punctuation outside | `tests/e2e/teams-subscriptions-helper.mjs:81` | asserted |
| SUB-015 | 5 | component selection asserted in tests/e2e/helpers/chat-preferences-flow.mjs outside the old Evidence set | none | none |
| SUB-015 | 5 | ten failures deactivate Teams | `tests/e2e/helpers/self-serve-chat-flow.mjs:77` | asserted |
| SUB-015 | 5 | deactivated Teams receives nothing | `tests/e2e/helpers/self-serve-chat-flow.mjs:81` | asserted |
| SUB-017 | 1 | dry run reports 97 created | `tests/e2e/helpers/subscriber-csv-flow.mjs:34` | asserted |
| SUB-017 | 1 | dry run reports zero skipped | `tests/e2e/helpers/subscriber-csv-flow.mjs:34` | asserted |
| SUB-017 | 1 | dry run reports three refused | `tests/e2e/helpers/subscriber-csv-flow.mjs:34` | asserted |
| SUB-017 | 1 | dry-run rows and reasons | `tests/e2e/helpers/subscriber-csv-flow.mjs:38` | asserted |
| SUB-017 | 1 | dry-run no mail | `tests/e2e/helpers/subscriber-csv-flow.mjs:41` | asserted |
| SUB-017 | 1 | dry-run database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set | none | none |
| SUB-017 | 2 | pending 97 | `tests/e2e/helpers/subscriber-csv-flow.mjs:59` | asserted |
| SUB-017 | 2 | all pending | `tests/e2e/helpers/subscriber-csv-flow.mjs:60` | asserted |
| SUB-017 | 2 | apply sends nothing | `tests/e2e/helpers/subscriber-csv-flow.mjs:64` | asserted |
| SUB-017 | 2 | one invitation per address | `tests/e2e/helpers/subscriber-csv-flow.mjs:113` | asserted |
| SUB-017 | 2 | concurrent repeats no additional send | `tests/e2e/helpers/subscriber-csv-flow.mjs:120` | asserted |
| SUB-017 | 3 | export row count | `tests/e2e/helpers/subscriber-csv-flow.mjs:92` | asserted |
| SUB-017 | 3 | export field set | `tests/e2e/helpers/subscriber-csv-flow.mjs:93` | asserted |
| SUB-017 | 4 | email pending | `tests/e2e/helpers/subscriber-add-flow.mjs:47` | asserted |
| SUB-017 | 4 | one confirmation | `tests/e2e/helpers/subscriber-add-flow.mjs:48` | asserted |
| SUB-017 | 4 | webhook API reports a created subscriber | `tests/e2e/helpers/subscriber-add-flow.mjs:103` | asserted |
| SUB-017 | 4 | webhook API subscriber is pending | `tests/e2e/helpers/subscriber-add-flow.mjs:105` | asserted |
| SUB-017 | 4 | webhook contact receives exactly one confirmation | `tests/e2e/helpers/subscriber-add-flow.mjs:106` | asserted |
| SUB-017 | 4 | webhook subscriber is active after its contact confirms | `tests/e2e/helpers/subscriber-add-flow.mjs:116` | asserted |
| SUB-017 | 4 | email API stores the exact two selected components | `tests/e2e/helpers/subscriber-add-flow.mjs:53` | asserted |
| SUB-017 | 4 | the one-row email form creates the named address with two components in export | `tests/e2e/helpers/subscriber-intake-browser-flow.mjs:106` | asserted |
| SUB-017 | 4 | the one-row form persists the webhook destination and contact | none | none |
| SUB-017 | 4 | webhook API component selection is read back | none | none |
| SUB-017 | 4 | the form persists the exact selected component identifiers | none | none |
| SUB-017 | 5 | two non-confirmation messages are captured after the three publications | `tests/e2e/helpers/subscriber-add-flow.mjs:77` | asserted |
| SUB-017 | 5 | first selected incident | `tests/e2e/helpers/subscriber-add-flow.mjs:78` | asserted |
| SUB-017 | 5 | second selected incident | `tests/e2e/helpers/subscriber-add-flow.mjs:79` | asserted |
| SUB-017 | 5 | third incident absent | `tests/e2e/helpers/subscriber-add-flow.mjs:80` | asserted |
| SUB-017 | 6 | subscriber adding operator | `tests/e2e/helpers/subscriber-add-flow.mjs:54` | asserted |
| SUB-017 | 6 | audit adding operator | `tests/e2e/helpers/subscriber-add-flow.mjs:89` | asserted |
| SUB-020 | 1 | total capacity | `tests/e2e/helpers/subscriber-limits-flow.mjs:55` | asserted |
| SUB-020 | 1 | the full seeded webhook channel refuses another destination | `tests/e2e/helpers/subscriber-limits-flow.mjs:115` | asserted |
| SUB-020 | 1 | freeing one webhook slot admits a pending subscriber | `tests/e2e/helpers/subscriber-limits-flow.mjs:121` | asserted |
| SUB-020 | 1 | that pending subscriber exhausts the recovered webhook slot | `tests/e2e/helpers/subscriber-limits-flow.mjs:123` | asserted |
| SUB-020 | 1 | reported combined-chat count equals the reported limit | `tests/e2e/helpers/subscriber-limits-flow.mjs:135` | asserted |
| SUB-020 | 1 | Teams refuses at the seeded full combined-chat population | `tests/e2e/helpers/subscriber-limits-flow.mjs:131` | asserted |
| SUB-020 | 1 | Slack refuses at the seeded full combined-chat population | `tests/e2e/helpers/subscriber-limits-flow.mjs:132` | asserted |
| SUB-020 | 1 | the reported combined-chat count and limit are explicitly 1000 | none | none |
| SUB-020 | 2 | pending recovered slot | `tests/e2e/helpers/subscriber-limits-flow.mjs:121` | asserted |
| SUB-020 | 2 | deactivated releases capacity | `tests/e2e/helpers/subscriber-limits-flow.mjs:79` | asserted |
| SUB-020 | 2 | incident subscriptions consume capacity | none | none |
| SUB-020 | 2 | deleted subscribers release capacity | none | none |
| SUB-020 | 3 | reported total and limit | `tests/e2e/helpers/subscriber-limits-flow.mjs:65` | asserted |
| SUB-020 | 3 | each channel count in Settings browser assertions | none | none |
| SUB-020 | 4 | same new and existing body | `tests/e2e/helpers/subscriber-limits-flow.mjs:63` | asserted |
| SUB-020 | 4 | full-channel message | `tests/e2e/helpers/subscriber-limits-flow.mjs:60` | asserted |
| SUB-020 | 4 | full-channel page links the Atom feed | `tests/e2e/helpers/subscriber-limits-flow.mjs:61` | asserted |
| SUB-020 | 4 | full-channel page links the RSS feed | `tests/e2e/helpers/subscriber-limits-flow.mjs:61` | asserted |
| SUB-020 | 4 | script-free browser response equality | `tests/e2e/helpers/subscriber-limits-browser-flow.mjs:93` | asserted |
| SUB-020 | 5 | the pending-plus-active subscription count is unchanged | `tests/e2e/helpers/subscriber-limits-flow.mjs:64` | asserted |
| SUB-020 | 5 | no subscriber row in any other state is created | none | none |
| SUB-020 | 5 | no mail | `tests/e2e/helpers/subscriber-limits-flow.mjs:64` | asserted |
| SUB-020 | 6 | 80-percent once | `tests/e2e/helpers/subscriber-limits-flow.mjs:53` | asserted |
| SUB-020 | 6 | 100-percent once | `tests/e2e/helpers/subscriber-limits-flow.mjs:54` | asserted |
| SUB-020 | 6 | every channel crossing alert | none | none |
| SUB-020 | 7 | full capacity Follow-up | `tests/e2e/helpers/subscriber-limits-flow.mjs:68` | asserted |
| SUB-020 | 7 | below-limit Follow-up disappears | `tests/e2e/helpers/subscriber-limits-flow.mjs:81` | asserted |
| SUB-020 | 7 | the pending-plus-active count stays at capacity after refusal | `tests/e2e/helpers/subscriber-limits-flow.mjs:64` | asserted |
| SUB-020 | 7 | the full-channel refusal creates no subscriber in another state | none | none |
| SUB-023 | 1 | move-in excess named | `tests/e2e/helpers/subscriber-limits-flow.mjs:84` | asserted |
| SUB-023 | 1 | move-in refused rows | `tests/e2e/helpers/subscriber-limits-flow.mjs:86` | asserted |
| SUB-023 | 1 | CSV excess named | `tests/e2e/helpers/subscriber-limits-flow.mjs:94` | asserted |
| SUB-023 | 1 | CSV refused rows | `tests/e2e/helpers/subscriber-limits-flow.mjs:95` | asserted |
| SUB-023 | 2 | move-in apply refuses | `tests/e2e/helpers/subscriber-limits-flow.mjs:88` | asserted |
| SUB-023 | 2 | move-in database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set | none | none |
| SUB-023 | 2 | CSV apply refuses | `tests/e2e/helpers/subscriber-limits-flow.mjs:97` | asserted |
| SUB-023 | 2 | CSV database comparison asserted in tests/e2e/helpers/subscriber-management-fixture.mjs outside the old Evidence set | none | none |
| SUB-023 | 2 | the narrowed import job reports completed | `tests/e2e/helpers/subscriber-limits-flow.mjs:91` | asserted |
| SUB-023 | 2 | the narrowed source contains no subscriber-capacity excess | `tests/e2e/helpers/subscriber-limits-flow.mjs:90` | asserted |
| SUB-023 | 2 | the narrowed apply persists all expected non-subscriber records | none | none |
| SUB-023 | 3 | both sizes read | `tests/e2e/helpers/subscriber-limits-flow.mjs:38` | asserted |
| SUB-023 | 3 | both sizes zero refusals | `tests/e2e/helpers/subscriber-limits-flow.mjs:39` | asserted |
| SUB-023 | 3 | both sizes no excess | `tests/e2e/helpers/subscriber-limits-flow.mjs:40` | asserted |
| SUB-023 | 4 | 200 excess | `tests/e2e/helpers/subscriber-limits-flow.mjs:85` | asserted |
| SUB-023 | 4 | the over-limit apply leaves the pending-plus-active count unchanged | `tests/e2e/helpers/subscriber-limits-flow.mjs:88` | asserted |
| SUB-023 | 4 | the over-limit apply creates no subscriber in another state | none | none |
| SUB-023 | 4 | the email-free import job reports completed | `tests/e2e/helpers/subscriber-limits-flow.mjs:91` | asserted |
| SUB-023 | 4 | email-free apply leaves pending-plus-active subscriber count unchanged | `tests/e2e/helpers/subscriber-limits-flow.mjs:91` | asserted |
| SUB-023 | 4 | the email-free apply persists the expected source component | none | none |
| SUB-023 | 5 | CSV refusal count | `tests/e2e/helpers/subscriber-limits-flow.mjs:94` | asserted |
| SUB-023 | 5 | the fitting CSV apply reports one created subscriber | `tests/e2e/helpers/subscriber-limits-flow.mjs:101` | asserted |
| SUB-023 | 5 | the fitting CSV apply actually stores one pending subscriber | none | none |
| NOTIFY-001 | 1 | first incident notification | none | none |
| NOTIFY-001 | 1 | subsequent incident notification | none | none |
| NOTIFY-001 | 1 | resolution notification | none | none |
| NOTIFY-001 | 2 | maintenance lifecycle notification events | none | none |
| NOTIFY-001 | 3 | component change silence or opted-in replacement | none | none |
| NOTIFY-002 | 1 | 1000 recipient-capture records exist for the event | `tests/e2e/delivery-contract.test.mjs:1111` | asserted |
| NOTIFY-002 | 1 | 1000 attempts carry provider identifiers | `tests/e2e/delivery-contract.test.mjs:1118` | asserted |
| NOTIFY-002 | 1 | 1000 messages reach the capture adapter | `tests/e2e/delivery-contract.test.mjs:1117` | asserted |
| NOTIFY-002 | 1 | every expected eligible recipient has a provider acceptance without a missing recipient hidden by duplicates | none | none |
| NOTIFY-002 | 1 | five-minute measured bound | `tests/e2e/delivery-contract.test.mjs:1120` | asserted |
| NOTIFY-003 | 1 | six total attempts | `tests/e2e/delivery-contract.test.mjs:921` | asserted |
| NOTIFY-003 | 2 | exponential backoff timing over one hour | none | none |
| NOTIFY-003 | 3 | durable failed outcome | `tests/e2e/delivery-contract.test.mjs:920` | asserted |
| NOTIFY-003 | 3 | the failure event identifies the expected delivery | `tests/e2e/delivery-contract.test.mjs:923` | asserted |
| NOTIFY-003 | 3 | the failure event identifies the expected notification event | `tests/e2e/delivery-contract.test.mjs:923` | asserted |
| NOTIFY-004 | 1 | subscriber field readback | none | none |
| NOTIFY-004 | 1 | channel field readback | none | none |
| NOTIFY-004 | 1 | update field readback | none | none |
| NOTIFY-004 | 1 | queue time readback | none | none |
| NOTIFY-004 | 1 | outcome time readback | none | none |
| NOTIFY-004 | 1 | outcome field | `tests/e2e/delivery-contract.test.mjs:1018` | asserted |
| NOTIFY-004 | 2 | queued outcome | `tests/reference-storage/capture-receipts.test.mjs:40` | asserted |
| NOTIFY-004 | 2 | delivered outcome | `tests/reference-storage/capture-receipts.test.mjs:63` | asserted |
| NOTIFY-004 | 2 | bounced outcome | `tests/e2e/delivery-contract.test.mjs:745` | asserted |
| NOTIFY-004 | 2 | complained outcome readback | none | none |
| NOTIFY-004 | 2 | suppressed outcome | `tests/e2e/delivery-contract.test.mjs:518` | asserted |
| NOTIFY-004 | 2 | failed outcome | `tests/e2e/delivery-contract.test.mjs:920` | asserted |
| NOTIFY-004 | 3 | message pixel absence | none | none |
| NOTIFY-004 | 3 | tracked-link absence | none | none |
| NOTIFY-004 | 4 | one sampled result of the delivered filter has delivered outcome | `tests/e2e/delivery-contract.test.mjs:1018` | asserted |
| NOTIFY-004 | 4 | the outcome filter returns all and only matching rows throughout its result set | none | none |
| NOTIFY-004 | 4 | channel filter reconciliation | none | none |
| NOTIFY-004 | 4 | update filter reconciliation | none | none |
| NOTIFY-004 | 4 | CSV contains 101 capacity-fixture destination occurrences | `tests/e2e/delivery-contract.test.mjs:1079` | asserted |
| NOTIFY-004 | 4 | all 101 distinct expected destinations occur once and match the full filtered view | none | none |
| NOTIFY-005 | 1 | repeated capture leaves one recipient record | `tests/e2e/delivery-contract.test.mjs:577` | asserted |
| NOTIFY-005 | 1 | repeated capture leaves one dispatcher job | `tests/e2e/delivery-contract.test.mjs:577` | asserted |
| NOTIFY-005 | 1 | two intended healthy-delivery scenarios produce two healthy-host requests in aggregate | `tests/e2e/delivery-contract.test.mjs:984` | asserted |
| NOTIFY-005 | 1 | the concurrently dispatched delivery alone produces exactly one request | none | none |
| NOTIFY-005 | 1 | email queue redelivery never resends | none | none |
| NOTIFY-006 | 1 | due email once | `tests/e2e/update-reminders.test.mjs:95` | asserted |
| NOTIFY-006 | 2 | overdue email once | `tests/e2e/update-reminders.test.mjs:211` | asserted |
| NOTIFY-006 | 3 | maintenance overrun email once | none | none |
| NOTIFY-006 | 3 | scheduled review hold email once | none | none |
| NOTIFY-006 | 3 | alert-created draft email once | none | none |
| NOTIFY-006 | 4 | one terminal-failure alert queued | `tests/e2e/delivery-contract.test.mjs:922` | asserted |
| NOTIFY-006 | 4 | actual terminal-failure operator email count | none | none |
| NOTIFY-007 | 1 | one stored channel selection is email | `tests/e2e/delivery-contract.test.mjs:582` | asserted |
| NOTIFY-007 | 1 | the complete recipient channel set equals exactly the selected channels | none | none |
| NOTIFY-007 | 1 | empty selection produces no notifications | `tests/e2e/delivery-contract.test.mjs:348` | asserted |
| NOTIFY-007 | 2 | page mandatory publication | none | none |
| NOTIFY-007 | 2 | Atom mandatory publication | none | none |
| NOTIFY-007 | 2 | widget mandatory publication | none | none |
| NOTIFY-008 | 1 | operator-only mail authorization | none | none |
| NOTIFY-008 | 1 | pending single-confirmation restriction | none | none |
| NOTIFY-008 | 1 | active subscriber destination | `tests/e2e/delivery-contract.test.mjs:596` | asserted |
| NOTIFY-008 | 2 | configured From address | `tests/e2e/delivery-contract.test.mjs:595` | asserted |
| NOTIFY-010 | 1 | List-Id is present | `tests/e2e/delivery-contract.test.mjs:604` | asserted |
| NOTIFY-010 | 1 | List-Archive is present | `tests/e2e/delivery-contract.test.mjs:604` | asserted |
| NOTIFY-010 | 1 | List-Help is present | `tests/e2e/delivery-contract.test.mjs:604` | asserted |
| NOTIFY-010 | 1 | page identity | `tests/e2e/rer-mail.test.mjs:104` | asserted |
| NOTIFY-010 | 1 | archive points at page | `tests/e2e/rer-mail.test.mjs:105` | asserted |
| NOTIFY-010 | 1 | help points at subscriber page | `tests/e2e/rer-mail.test.mjs:106` | asserted |
| NOTIFY-010 | 1 | automatic message declaration | `tests/e2e/delivery-contract.test.mjs:605` | asserted |
| NOTIFY-010 | 2 | reply header references first | `tests/e2e/rer-mail.test.mjs:117` | asserted |
| NOTIFY-010 | 2 | references header names first | `tests/e2e/rer-mail.test.mjs:118` | asserted |
| NOTIFY-010 | 3 | setup missing DKIM refusal | none | none |
| NOTIFY-010 | 3 | deployment missing DKIM refusal | none | none |
| NOTIFY-010 | 3 | setup missing DMARC refusal | none | none |
| NOTIFY-010 | 3 | deployment missing DMARC refusal | none | none |
| NOTIFY-010 | 3 | missing record named | none | none |
| NOTIFY-010 | 4 | aligned DKIM without From-domain SPF | none | none |
| NOTIFY-009 | 1 | mail provider failure publish | none | none |
| NOTIFY-009 | 1 | queue failure publish | none | none |
| NOTIFY-009 | 1 | endpoint failure publish | none | none |
| NOTIFY-009 | 2 | public page survives delivery failure | none | none |
| NOTIFY-009 | 2 | feed survives delivery failure | none | none |
| NOTIFY-009 | 2 | widget survives delivery failure | none | none |
| NOTIFY-009 | 3 | recovery preserves and delivers committed set | none | none |
| NOTIFY-011 | 1 | the created Slack channel response reports the expected provider host | `tests/e2e/channels-and-presets.test.mjs:96` | asserted |
| NOTIFY-011 | 1 | the Slack destination and selected components are persisted | none | none |
| NOTIFY-011 | 1 | the Teams destination is persisted with all-visible component selection | none | none |
| NOTIFY-011 | 1 | saved component selections read back | none | none |
| NOTIFY-011 | 2 | no URL in list | `tests/e2e/channels-and-presets.test.mjs:102` | asserted |
| NOTIFY-011 | 2 | stored ciphertext | `tests/e2e/channels-and-presets.test.mjs:103` | asserted |
| NOTIFY-011 | 2 | no saved URL on other API responses | none | none |
| NOTIFY-011 | 3 | nonprovider host refused | `tests/e2e/channels-and-presets.test.mjs:99` | asserted |
| NOTIFY-012 | 1 | one Slack send | `tests/e2e/channels-and-presets.test.mjs:125` | asserted |
| NOTIFY-012 | 1 | one Teams send | `tests/e2e/channels-and-presets.test.mjs:126` | asserted |
| NOTIFY-012 | 1 | unrelated channel silent | `tests/e2e/channels-and-presets.test.mjs:127` | asserted |
| NOTIFY-012 | 1 | atomic update/post commit | none | none |
| NOTIFY-012 | 2 | repeated scheduled pass keeps Slack once | `tests/e2e/channels-and-presets.test.mjs:125` | asserted |
| NOTIFY-012 | 2 | repeated scheduled pass keeps Teams once | `tests/e2e/channels-and-presets.test.mjs:126` | asserted |
| NOTIFY-012 | 2 | publication retry duplicate absence | none | none |
| NOTIFY-012 | 3 | retroactive publication silence | none | none |
| NOTIFY-015 | 1 | email committed10 | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| NOTIFY-015 | 1 | email delivered9 | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| NOTIFY-015 | 1 | email bounced1 | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| NOTIFY-015 | 1 | webhook committed2 | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| NOTIFY-015 | 1 | webhook delivered2 | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| NOTIFY-015 | 1 | suppressed count reconciliation | none | none |
| NOTIFY-015 | 1 | failed count reconciliation | none | none |
| NOTIFY-015 | 2 | incident committed20 | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| NOTIFY-015 | 2 | incident email distinct committed count is 10 | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| NOTIFY-015 | 2 | incident webhook totals and distinct recipient counts reconcile across updates | none | none |
| NOTIFY-015 | 2 | incident distinct delivered8 | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| NOTIFY-015 | 3 | CSV committed10 | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| NOTIFY-015 | 3 | CSV delivered9 | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| NOTIFY-015 | 3 | CSV bounced1 | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| NOTIFY-015 | 3 | webhook CSV parity | none | none |
| INTAKE-001 | 1 | Valid signed request admitted | `tests/e2e/publishing-contract.test.mjs:806` | asserted |
| INTAKE-001 | 1 | Five-minute timestamp boundary | none | none |
| INTAKE-001 | 2 | Bearer alternative admitted | none | none |
| INTAKE-001 | 3 | Malformed or wrong signature returns 401 | `tests/e2e/publishing-contract.test.mjs:799` | asserted |
| INTAKE-001 | 3 | Absent credential refusal | none | none |
| INTAKE-001 | 3 | Stale credential refusal | none | none |
| INTAKE-001 | 3 | No records created on refusal | none | none |
| INTAKE-002 | 1 | Private draft has no update | `tests/e2e/publishing-contract.test.mjs:821` | asserted |
| INTAKE-002 | 1 | Thirty-second bound | none | none |
| INTAKE-002 | 2 | Page omits alert narrative | `tests/e2e/publishing-contract.test.mjs:822` | asserted |
| INTAKE-002 | 2 | All other public surfaces unchanged | none | none |
| INTAKE-002 | 3 | Pointer to publication moved to Requirement | none | moved |
| INTAKE-003 | 1 | Different deliveries share incident | `tests/e2e/publishing-contract.test.mjs:834` | asserted |
| INTAKE-003 | 2 | Replay same accepted status | `tests/e2e/publishing-contract.test.mjs:807` | asserted |
| INTAKE-003 | 2 | Replay adds no incident | none | none |
| INTAKE-003 | 2 | Replay adds no draft | none | none |
| INTAKE-003 | 2 | Replay adds no alert record | none | none |
| INTAKE-004 | 1 | Recovery timestamp read back | none | none |
| INTAKE-004 | 2 | Lifecycle unchanged | `tests/e2e/publishing-contract.test.mjs:846` | asserted |
| INTAKE-004 | 2 | No published update | `tests/e2e/publishing-contract.test.mjs:847` | asserted |
| INTAKE-004 | 2 | Every public surface unchanged | none | none |
| INTAKE-005 | 1 | Configured key path controls acceptance | `tests/e2e/publishing-contract.test.mjs:855` | asserted |
| INTAKE-005 | 1 | Configured title read back | none | none |
| INTAKE-005 | 1 | Configured generic firing state is read back | `tests/e2e/app-api.test.mjs:492` | asserted |
| INTAKE-005 | 1 | Configured generic recovered state is read back | none | none |
| INTAKE-005 | 2 | Missing key returns 400 | `tests/e2e/publishing-contract.test.mjs:853` | asserted |
| INTAKE-005 | 2 | Visible rejected mapping reason | `tests/e2e/helpers/webhook-source-browser-flow.mjs:119` | asserted |
| INTAKE-006 | 1 | Datadog component mapping | `tests/e2e/channels-and-presets.test.mjs:218` | asserted |
| INTAKE-006 | 1 | UptimeRobot component mapping | `tests/e2e/channels-and-presets.test.mjs:218` | asserted |
| INTAKE-006 | 1 | Better Stack component mapping | `tests/e2e/channels-and-presets.test.mjs:218` | asserted |
| INTAKE-006 | 1 | Pingdom component mapping | `tests/e2e/channels-and-presets.test.mjs:218` | asserted |
| INTAKE-006 | 2 | Token shown once | `tests/e2e/channels-and-presets.test.mjs:207` | asserted |
| INTAKE-006 | 3 | Missing token 401 | `tests/e2e/channels-and-presets.test.mjs:209` | asserted |
| INTAKE-006 | 3 | Wrong token 401 | `tests/e2e/channels-and-presets.test.mjs:210` | asserted |
| INTAKE-006 | 3 | Refusals record nothing | none | none |
| INTAKE-006 | 4 | Other-provider payload 400 | `tests/e2e/channels-and-presets.test.mjs:212` | asserted |
| INTAKE-006 | 4 | Invalid receipt visible | `tests/e2e/channels-and-presets.test.mjs:222` | asserted |
| INTAKE-006 | 5 | Zero updates | `tests/e2e/channels-and-presets.test.mjs:217` | asserted |
| INTAKE-006 | 5 | Public status excludes drafts | `tests/e2e/channels-and-presets.test.mjs:224` | asserted |
| INTAKE-006 | 5 | Every other public surface unchanged | none | none |
| INTAKE-007 | 1 | Private draft resolves | `tests/e2e/channels-and-presets.test.mjs:233` | asserted |
| INTAKE-007 | 1 | Zero updates | `tests/e2e/channels-and-presets.test.mjs:234` | asserted |
| INTAKE-007 | 1 | No public trace | none | none |
| INTAKE-007 | 2 | Published lifecycle unchanged | `tests/e2e/channels-and-presets.test.mjs:244` | asserted |
| INTAKE-007 | 2 | Recovery record read back | none | none |
| INTAKE-008 | 1 | Pairing asks for no secret | `tests/e2e/helpers/uptime-pairing-flow.mjs:52` | asserted |
| INTAKE-008 | 1 | Signing-secret source retained | `tests/e2e/helpers/uptime-preset-flow.mjs:26` | asserted |
| INTAKE-008 | 2 | Wrong key refused | `tests/e2e/helpers/uptime-pairing-flow.mjs:70` | asserted |
| INTAKE-008 | 2 | Missing timestamp refused | `tests/e2e/helpers/uptime-pairing-flow.mjs:71` | asserted |
| INTAKE-008 | 2 | Stale timestamp refused | `tests/e2e/helpers/uptime-pairing-flow.mjs:72` | asserted |
| INTAKE-008 | 2 | Altered bytes refused | `tests/e2e/helpers/intake-byte-flow.mjs:34` | asserted |
| INTAKE-008 | 2 | No receipts | `tests/e2e/helpers/intake-byte-flow.mjs:37` | asserted |
| INTAKE-008 | 2 | Authentication refusals leave the complete incident listing unchanged | `tests/e2e/helpers/intake-byte-flow.mjs:38` | asserted |
| INTAKE-008 | 2 | Authentication refusals create or change no draft record | none | none |
| INTAKE-008 | 2 | Authentication refusals leave public status JSON bytes unchanged | `tests/e2e/helpers/intake-byte-flow.mjs:39` | asserted |
| INTAKE-008 | 2 | Authentication refusals create no published update | none | none |
| INTAKE-008 | 2 | Authentication refusals leave every other public artifact unchanged | none | none |
| INTAKE-008 | 3 | Equal incident keys on different monitors create distinct incidents | `tests/e2e/helpers/uptime-preset-flow.mjs:46` | asserted |
| INTAKE-008 | 3 | The second monitor incident retains only its own mapped component | `tests/e2e/helpers/uptime-preset-flow.mjs:47` | asserted |
| INTAKE-008 | 3 | Unpicked monitor refusal | `tests/e2e/helpers/uptime-pairing-flow.mjs:78` | asserted |
| INTAKE-008 | 4 | Mapped component | `tests/e2e/helpers/uptime-preset-flow.mjs:40` | asserted |
| INTAKE-008 | 4 | Zero updates | `tests/e2e/helpers/uptime-preset-flow.mjs:41` | asserted |
| INTAKE-008 | 4 | Replay same draft | `tests/e2e/helpers/uptime-preset-flow.mjs:38` | asserted |
| INTAKE-008 | 5 | The brief includes the supplied US East vantage | `tests/e2e/helpers/uptime-preset-flow.mjs:44` | asserted |
| INTAKE-008 | 5 | The brief includes the supplied EU West vantage | `tests/e2e/helpers/uptime-preset-flow.mjs:44` | asserted |
| INTAKE-008 | 5 | The brief includes the supplied error category | `tests/e2e/helpers/uptime-preset-flow.mjs:44` | asserted |
| INTAKE-008 | 5 | The brief includes the supplied confirmed-start instant | `tests/e2e/helpers/uptime-preset-flow.mjs:44` | asserted |
| INTAKE-008 | 5 | Missing confirmed time not supplied | `tests/e2e/helpers/uptime-preset-flow.mjs:61` | asserted |
| INTAKE-008 | 6 | Recovery record | `tests/e2e/helpers/uptime-preset-flow.mjs:52` | asserted |
| INTAKE-008 | 6 | Private lifecycle closes | `tests/e2e/helpers/uptime-preset-flow.mjs:51` | asserted |
| INTAKE-008 | 6 | Published lifecycle retained | `tests/e2e/helpers/uptime-preset-flow.mjs:67` | asserted |
| INTAKE-008 | 7 | Saved mapping | `tests/e2e/helpers/uptime-pairing-flow.mjs:91` | asserted |
| INTAKE-008 | 7 | Browser picked component | `tests/e2e/helpers/uptime-pairing-flow.mjs:107` | asserted |
| INTAKE-008 | 7 | Browser vantages | `tests/e2e/helpers/uptime-pairing-flow.mjs:109` | asserted |
| INTAKE-008 | 3 | Test and drill refusal plus visible receipt/no draft | none | none |
| INTAKE-008 | 5 | Confirmed versus earlier unobserved time labeled | none | none |
| INTAKE-009 | 1 | Disconnected intake no receipt | `tests/e2e/helpers/pagerduty-flow.mjs:136` | asserted |
| INTAKE-009 | 1 | Inbound connection state | `tests/e2e/helpers/pagerduty-flow.mjs:139` | asserted |
| INTAKE-009 | 1 | Outbound state | `tests/e2e/helpers/pagerduty-flow.mjs:140` | asserted |
| INTAKE-009 | 2 | Wrong signature refused | `tests/e2e/helpers/pagerduty-flow.mjs:145` | asserted |
| INTAKE-009 | 2 | Wrong signature no receipt | `tests/e2e/helpers/pagerduty-flow.mjs:146` | asserted |
| INTAKE-009 | 2 | Tampered bytes refused | `tests/e2e/helpers/pagerduty-flow.mjs:149` | asserted |
| INTAKE-009 | 2 | Tampered bytes no receipt | `tests/e2e/helpers/pagerduty-flow.mjs:150` | asserted |
| INTAKE-009 | 3 | All matched components | `tests/e2e/helpers/pagerduty-flow.mjs:155` | asserted |
| INTAKE-009 | 3 | The unsupported signed-event receipt exposes its rejection reason | `tests/e2e/helpers/pagerduty-flow.mjs:180` | asserted |
| INTAKE-009 | 3 | The unmapped signed-event receipt exposes its rejection reason | `tests/e2e/helpers/pagerduty-flow.mjs:180` | asserted |
| INTAKE-009 | 4 | Zero updates | `tests/e2e/helpers/pagerduty-flow.mjs:156` | asserted |
| INTAKE-009 | 4 | Replay same draft | `tests/e2e/helpers/pagerduty-flow.mjs:158` | asserted |
| INTAKE-009 | 4 | One receipt | `tests/e2e/helpers/pagerduty-flow.mjs:159` | asserted |
| INTAKE-009 | 5 | Event time | `tests/e2e/helpers/pagerduty-flow.mjs:171` | asserted |
| INTAKE-009 | 5 | Responder role | `tests/e2e/helpers/pagerduty-flow.mjs:172` | asserted |
| INTAKE-009 | 5 | The acknowledgment report line cites its brief reference | `tests/e2e/helpers/pagerduty-flow.mjs:275` | asserted |
| INTAKE-009 | 5 | The escalation report line cites its brief reference | `tests/e2e/helpers/pagerduty-flow.mjs:275` | asserted |
| INTAKE-009 | 5 | The acknowledgment report line retains event kind, time and responder role | `tests/e2e/helpers/pagerduty-flow.mjs:276` | asserted |
| INTAKE-009 | 5 | The escalation report line retains event kind, time and responder role | `tests/e2e/helpers/pagerduty-flow.mjs:276` | asserted |
| INTAKE-009 | 6 | Private recovery | `tests/e2e/helpers/pagerduty-flow.mjs:187` | asserted |
| INTAKE-009 | 6 | Published lifecycle | `tests/e2e/helpers/pagerduty-flow.mjs:241` | asserted |
| INTAKE-009 | 6 | Published updates | `tests/e2e/helpers/pagerduty-flow.mjs:242` | asserted |
| INTAKE-009 | 7 | Private draft references and title are absent from public status JSON | `tests/e2e/helpers/pagerduty-flow.mjs:190` | asserted |
| INTAKE-009 | 7 | Private drafts are absent from every other public story artifact | none | none |
| INTAKE-009 | 7 | Source removed | `tests/e2e/helpers/pagerduty-flow.mjs:293` | asserted |
| INTAKE-009 | 7 | Receipts erased | `tests/e2e/helpers/pagerduty-flow.mjs:294` | asserted |
| INTAKE-009 | 7 | Publications preserved | `tests/e2e/helpers/pagerduty-flow.mjs:297` | asserted |
| INTAKE-009 | 7 | Report preserved | `tests/e2e/helpers/pagerduty-flow.mjs:299` | asserted |
| INTAKE-009 | 3 | All supplied compound matcher fields required | none | none |
| INTAKE-009 | 6 | Recovery receipt readback | none | none |
| INTAKE-009 | 7 | Every public story artifact excludes private drafts | none | none |
| INTAKE-015 | 1 | PagerDuty note contains the public audience statement | `tests/e2e/helpers/pagerduty-flow.mjs:214` | asserted |
| INTAKE-015 | 1 | PagerDuty note contains public customer impact | `tests/e2e/helpers/pagerduty-flow.mjs:214` | asserted |
| INTAKE-015 | 1 | PagerDuty note contains public still-working text | `tests/e2e/helpers/pagerduty-flow.mjs:214` | asserted |
| INTAKE-015 | 1 | PagerDuty note contains public details | `tests/e2e/helpers/pagerduty-flow.mjs:214` | asserted |
| INTAKE-015 | 1 | PagerDuty note contains the incident permalink | `tests/e2e/helpers/pagerduty-flow.mjs:214` | asserted |
| INTAKE-015 | 1 | Replay no note | `tests/e2e/helpers/pagerduty-flow.mjs:216` | asserted |
| INTAKE-015 | 1 | Each publication one note | `tests/e2e/helpers/pagerduty-flow.mjs:219` | asserted |
| INTAKE-015 | 2 | No key no note | `tests/e2e/helpers/pagerduty-flow.mjs:288` | asserted |
| INTAKE-015 | 3 | Key not displayed | `tests/e2e/helpers/pagerduty-flow.mjs:142` | asserted |
| INTAKE-015 | 3 | Key sealed | `tests/e2e/helpers/pagerduty-flow.mjs:144` | asserted |
| INTAKE-015 | 3 | Technical archive no sealed key | `tests/e2e/helpers/pagerduty-flow.mjs:253` | asserted |
| INTAKE-015 | 3 | Reconnect required | `tests/e2e/helpers/pagerduty-flow.mjs:262` | asserted |
| INTAKE-015 | 4 | Fixed destination | `tests/e2e/helpers/pagerduty-flow.mjs:64` | asserted |
| INTAKE-015 | 4 | No redirect | `tests/e2e/helpers/pagerduty-flow.mjs:234` | asserted |
| INTAKE-015 | 5 | Failure receipt | `tests/e2e/helpers/pagerduty-flow.mjs:226` | asserted |
| INTAKE-015 | 5 | Publication persists | `tests/e2e/helpers/pagerduty-flow.mjs:224` | asserted |
| INTAKE-015 | 6 | Default owner email | `tests/e2e/helpers/pagerduty-flow.mjs:69` | asserted |
| INTAKE-015 | 3 | Native archive no sealed key | `tests/auth-adoption/portability.test.mjs:110` | asserted |
| INTAKE-015 | 3 | Note-author sealed and redacted | none | none |
| INTAKE-015 | 6 | Valid external provider user is field proof | none | moved |
| INTAKE-010 | 1 | Examples accepted | `tests/e2e/helpers/grouped-alerts-flow.mjs:54` | asserted |
| INTAKE-010 | 1 | Both components | `tests/e2e/helpers/grouped-alerts-flow.mjs:58` | asserted |
| INTAKE-010 | 1 | Private draft | `tests/e2e/helpers/grouped-alerts-flow.mjs:59` | asserted |
| INTAKE-010 | 2 | Unsupported/malformed refused | `tests/e2e/helpers/grouped-alerts-flow.mjs:44` | asserted |
| INTAKE-010 | 2 | Visible reason | `tests/e2e/helpers/grouped-alerts-flow.mjs:48` | asserted |
| INTAKE-010 | 2 | Unmapped no incident | `tests/e2e/helpers/grouped-alerts-flow.mjs:52` | asserted |
| INTAKE-010 | 3 | Concurrent replay same incident | `tests/e2e/helpers/grouped-alerts-flow.mjs:55` | asserted |
| INTAKE-010 | 3 | Both grouped alert fingerprints are retained exactly | `tests/e2e/helpers/grouped-alerts-flow.mjs:64` | asserted |
| INTAKE-010 | 3 | Both grouped alert states equal their payload states | `tests/e2e/helpers/grouped-alerts-flow.mjs:64` | asserted |
| INTAKE-010 | 3 | Exactly two members | `tests/e2e/helpers/grouped-alerts-flow.mjs:72` | asserted |
| INTAKE-010 | 4 | Mixed remains open | `tests/e2e/helpers/grouped-alerts-flow.mjs:76` | asserted |
| INTAKE-010 | 4 | Recovered member recorded | `tests/e2e/helpers/grouped-alerts-flow.mjs:77` | asserted |
| INTAKE-010 | 4 | Omitted firing member retained | `tests/e2e/helpers/grouped-alerts-flow.mjs:81` | asserted |
| INTAKE-010 | 5 | Complete private recovery | `tests/e2e/helpers/grouped-alerts-flow.mjs:83` | asserted |
| INTAKE-010 | 5 | No update | `tests/e2e/helpers/grouped-alerts-flow.mjs:84` | asserted |
| INTAKE-010 | 5 | Published lifecycle preserved | `tests/e2e/helpers/grouped-alerts-flow.mjs:91` | asserted |
| INTAKE-010 | 6 | Both browser components | `tests/e2e/helpers/grouped-alerts-flow.mjs:128` | asserted |
| INTAKE-010 | 6 | Browser draft private | `tests/e2e/helpers/grouped-alerts-flow.mjs:133` | asserted |
| INTAKE-010 | 7 | The restored Alertmanager source configuration equals the archived configuration | `tests/e2e/export-import.test.mjs:194` | asserted |
| INTAKE-010 | 7 | Restored grouped fingerprint and state evidence equals the archived evidence | `tests/e2e/export-import.test.mjs:194` | asserted |
| INTAKE-011 | 1 | The displayed workflow includes the exact issue-id binding | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:93` | asserted |
| INTAKE-011 | 1 | The displayed workflow includes the exact issue-title binding | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:93` | asserted |
| INTAKE-011 | 1 | The displayed workflow includes the exact state binding | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:93` | asserted |
| INTAKE-011 | 1 | The displayed workflow includes the exact entity-names binding | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:93` | asserted |
| INTAKE-011 | 2 | Entity mapping retained | `tests/e2e/helpers/operations-alerts-flow.mjs:170` | asserted |
| INTAKE-011 | 2 | Unmapped no incident | `tests/e2e/helpers/operations-alerts-flow.mjs:175` | asserted |
| INTAKE-011 | 2 | Names survive reload | `tests/e2e/helpers/metrics-browser-flow.mjs:28` | asserted |
| INTAKE-011 | 3 | Mapped draft | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:118` | asserted |
| INTAKE-011 | 3 | Private draft | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:119` | asserted |
| INTAKE-011 | 3 | Same incident | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:122` | asserted |
| INTAKE-011 | 3 | Resolved | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:124` | asserted |
| INTAKE-011 | 3 | No public updates | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:125` | asserted |
| INTAKE-011 | 4 | Template retained | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:104` | asserted |
| INTAKE-011 | 4 | Accessible source forms | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:135` | asserted |
| INTAKE-016 | 1 | Datadog chart value | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| INTAKE-016 | 1 | Pingdom chart value | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| INTAKE-016 | 1 | New Relic chart value | `tests/e2e/helpers/metrics-flow.mjs:102` | asserted |
| INTAKE-016 | 2 | Sealed key | `tests/e2e/helpers/metrics-flow.mjs:92` | asserted |
| INTAKE-016 | 2 | Operator listing absence | `tests/e2e/helpers/metrics-flow.mjs:91` | asserted |
| INTAKE-016 | 2 | Management listing absence | `tests/e2e/helpers/metrics-flow.mjs:96` | asserted |
| INTAKE-016 | 3 | Each provider connection survives reload | `tests/e2e/helpers/metrics-browser-flow.mjs:35` | asserted |
| INTAKE-014 | 1 | Wrong token 401 | `tests/e2e/helpers/operations-alerts-flow.mjs:58` | asserted |
| INTAKE-014 | 1 | Wrong-token refusal preserves every incident row | `tests/e2e/helpers/operations-alerts-flow.mjs:59` | asserted |
| INTAKE-014 | 1 | Wrong-token refusal preserves every draft row | `tests/e2e/helpers/operations-alerts-flow.mjs:59` | asserted |
| INTAKE-014 | 1 | Wrong-token refusal preserves every published-update row | `tests/e2e/helpers/operations-alerts-flow.mjs:59` | asserted |
| INTAKE-014 | 1 | Wrong-token refusal preserves every audit row | `tests/e2e/helpers/operations-alerts-flow.mjs:59` | asserted |
| INTAKE-014 | 1 | Wrong-token refusal preserves every alert-receipt row | `tests/e2e/helpers/operations-alerts-flow.mjs:59` | asserted |
| INTAKE-014 | 2 | Replay same incident | `tests/e2e/helpers/operations-alerts-flow.mjs:65` | asserted |
| INTAKE-014 | 2 | Distinct events same alert | `tests/e2e/helpers/operations-alerts-flow.mjs:68` | asserted |
| INTAKE-014 | 2 | Compound partial match excluded | `tests/e2e/helpers/operations-alerts-flow.mjs:54` | asserted |
| INTAKE-014 | 2 | All matching components | `tests/e2e/helpers/operations-alerts-flow.mjs:70` | asserted |
| INTAKE-014 | 3 | Private draft | `tests/e2e/helpers/operations-alerts-flow.mjs:71` | asserted |
| INTAKE-014 | 3 | Untouched title refresh | `tests/e2e/helpers/operations-alerts-flow.mjs:72` | asserted |
| INTAKE-014 | 3 | Operator title retained | `tests/e2e/helpers/operations-alerts-flow.mjs:78` | asserted |
| INTAKE-014 | 3 | Repeated Create retains operator-authored audience text | `tests/e2e/helpers/operations-alerts-flow.mjs:79` | asserted |
| INTAKE-014 | 3 | Repeated Create retains operator-authored impact text | `tests/e2e/helpers/operations-alerts-flow.mjs:80` | asserted |
| INTAKE-014 | 3 | Repeated Create retains operator-authored details text | `tests/e2e/helpers/operations-alerts-flow.mjs:81` | asserted |
| INTAKE-014 | 3 | Repeated Create retains operator-authored still-working text and next-update time | none | none |
| INTAKE-014 | 4 | The brief contains the acknowledgment event | `tests/e2e/helpers/operations-alerts-flow.mjs:90` | asserted |
| INTAKE-014 | 4 | The brief contains the escalation event | `tests/e2e/helpers/operations-alerts-flow.mjs:90` | asserted |
| INTAKE-014 | 4 | The acknowledgment brief entry names its responder role | `tests/e2e/helpers/operations-alerts-flow.mjs:90` | asserted |
| INTAKE-014 | 4 | The escalation brief entry names its responder role | `tests/e2e/helpers/operations-alerts-flow.mjs:90` | asserted |
| INTAKE-014 | 4 | Each brief summary time equals that action’s exact fixture timestamp | none | none |
| INTAKE-014 | 4 | The report acknowledgment line cites its brief entry | `tests/e2e/helpers/operations-alerts-flow.mjs:152` | asserted |
| INTAKE-014 | 4 | The report escalation line cites its brief entry | `tests/e2e/helpers/operations-alerts-flow.mjs:152` | asserted |
| INTAKE-014 | 4 | Each report line retains the event timestamp from its cited payload | `tests/e2e/helpers/operations-alerts-flow.mjs:153` | asserted |
| INTAKE-014 | 4 | Each report line retains its action and responder role | `tests/e2e/helpers/operations-alerts-flow.mjs:154` | asserted |
| INTAKE-014 | 5 | Internal note stored | `tests/e2e/helpers/operations-alerts-flow.mjs:94` | asserted |
| INTAKE-014 | 5 | No brief note | `tests/e2e/helpers/operations-alerts-flow.mjs:92` | asserted |
| INTAKE-014 | 5 | No public note | `tests/e2e/helpers/operations-alerts-flow.mjs:143` | asserted |
| INTAKE-014 | 6 | Private closes | `tests/e2e/helpers/operations-alerts-flow.mjs:165` | asserted |
| INTAKE-014 | 6 | Published lifecycle retained | `tests/e2e/helpers/operations-alerts-flow.mjs:111` | asserted |
| INTAKE-014 | 7 | Late actions retain the Resolved lifecycle | `tests/e2e/helpers/operations-alerts-flow.mjs:133` | asserted |
| INTAKE-014 | 7 | Late actions retain exactly the two existing public updates | `tests/e2e/helpers/operations-alerts-flow.mjs:133` | asserted |
| INTAKE-014 | 7 | No model note | `tests/e2e/helpers/operations-alerts-flow.mjs:136` | asserted |
| INTAKE-014 | 7 | No subscriber notice | `tests/e2e/helpers/operations-alerts-flow.mjs:138` | asserted |
| INTAKE-014 | 7 | No provider feedback | `tests/e2e/helpers/operations-alerts-flow.mjs:139` | asserted |
| INTAKE-014 | 7 | Late actions preserve the public page bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve history bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve incident permalink bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve Atom feed bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve RSS feed bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve public status JSON bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve widget script bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 7 | Late actions preserve compatibility summary JSON bytes | `tests/e2e/helpers/operations-alerts-flow.mjs:142` | asserted |
| INTAKE-014 | 8 | Compound mappings retained | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:64` | asserted |
| INTAKE-014 | 8 | Ordinary choice autosaves | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:75` | asserted |
| INTAKE-014 | 8 | Saved choice survives reload | `tests/e2e/helpers/operations-alerts-browser-flow.mjs:80` | asserted |
| INTAKE-014 | 2 | Unmapped reason read back | none | none |
| INTAKE-014 | 6 | Recovery record read back | none | none |
| INTAKE-014 | 8 | Credential replacement explicit Save asserted | none | none |
| INTAKE-019 | 1 | One note | `tests/e2e/helpers/operations-alerts-flow.mjs:104` | asserted |
| INTAKE-019 | 1 | No non-Resolved close | `tests/e2e/helpers/operations-alerts-flow.mjs:105` | asserted |
| INTAKE-019 | 1 | Linked alert | `tests/e2e/helpers/operations-alerts-flow.mjs:106` | asserted |
| INTAKE-019 | 1 | Identified provider note retains incident title | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains lifecycle | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains audience | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains customer impact | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains still-working text | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains details | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains next-update time | `tests/e2e/helpers/operations-alerts-flow.mjs:108` | asserted |
| INTAKE-019 | 1 | Identified provider note retains incident reference and permalink | `tests/e2e/helpers/operations-alerts-flow.mjs:107` | asserted |
| INTAKE-019 | 1 | Resolved provider note and close each retain every public field and permalink | `tests/e2e/helpers/operations-alerts-flow.mjs:119` | asserted |
| INTAKE-019 | 1 | Resolved provider note and close omit the prior next-update promise | `tests/e2e/helpers/operations-alerts-flow.mjs:120` | asserted |
| INTAKE-019 | 2 | Resolved one note | `tests/e2e/helpers/operations-alerts-flow.mjs:115` | asserted |
| INTAKE-019 | 2 | Resolved one close | `tests/e2e/helpers/operations-alerts-flow.mjs:116` | asserted |
| INTAKE-019 | 2 | Both linked alert | `tests/e2e/helpers/operations-alerts-flow.mjs:117` | asserted |
| INTAKE-019 | 2 | Scheduled replay no repeat | `tests/e2e/helpers/operations-alerts-flow.mjs:159` | asserted |
| INTAKE-019 | 3 | Credentials absent from listing | `tests/e2e/helpers/operations-alerts-flow.mjs:40` | asserted |
| INTAKE-019 | 4 | Atlassian site confinement | `tests/e2e/helpers/operations-alerts-flow.mjs:36` | asserted |
| INTAKE-019 | 4 | Fixed provider destination | `tests/e2e/helpers/operations-alerts-flow.mjs:19` | asserted |
| INTAKE-019 | 3 | Native archive no ciphertext | `tests/auth-adoption/portability.test.mjs:62` | asserted |
| INTAKE-019 | 3 | Restored source reconnects | `tests/auth-adoption/portability.test.mjs:117` | asserted |
| INTAKE-019 | 3 | Each provider key sealed at rest | none | none |
| AUTO-004 | 1 | Owner email recipient | `tests/e2e/helpers/report-reminders-flow.mjs:55` | asserted |
| AUTO-004 | 1 | Operator channel count | `tests/e2e/helpers/report-reminders-flow.mjs:56` | asserted |
| AUTO-004 | 1 | Repeated day-seven tick has the expected exact email count | `tests/e2e/helpers/report-reminders-flow.mjs:53` | asserted |
| AUTO-004 | 1 | Repeated day-seven tick has the expected exact Slack/Teams counts | `tests/e2e/helpers/report-reminders-flow.mjs:56` | asserted |
| AUTO-004 | 1 | Day-fourteen tick has the expected exact email count | `tests/e2e/helpers/report-reminders-flow.mjs:53` | asserted |
| AUTO-004 | 1 | Day-fourteen tick has the expected exact Slack/Teams counts | `tests/e2e/helpers/report-reminders-flow.mjs:56` | asserted |
| AUTO-004 | 2 | Incident reference | `tests/e2e/helpers/report-reminders-flow.mjs:59` | asserted |
| AUTO-004 | 2 | Private report link | `tests/e2e/helpers/report-reminders-flow.mjs:60` | asserted |
| AUTO-004 | 2 | No subscriber data | `tests/e2e/helpers/report-reminders-flow.mjs:61` | asserted |
| AUTO-004 | 2 | No publication-only channel | `tests/e2e/helpers/report-reminders-flow.mjs:63` | asserted |
| AUTO-004 | 2 | No subscriber mail | `tests/e2e/helpers/report-reminders-flow.mjs:64` | asserted |
| AUTO-004 | 4 | Tick after reasoned waiver has the expected exact email count | `tests/e2e/helpers/report-reminders-flow.mjs:53` | asserted |
| AUTO-004 | 4 | Tick after reasoned waiver has the expected exact Slack/Teams counts | `tests/e2e/helpers/report-reminders-flow.mjs:56` | asserted |
| AUTO-004 | 4 | Owed mark removed | `tests/e2e/helpers/report-reminders-flow.mjs:83` | asserted |
| AUTO-004 | 4 | One audit entry | `tests/e2e/helpers/report-reminders-flow.mjs:85` | asserted |
| AUTO-004 | 4 | Audit actor | `tests/e2e/helpers/report-reminders-flow.mjs:86` | asserted |
| AUTO-004 | 4 | Audit reason | `tests/e2e/helpers/report-reminders-flow.mjs:87` | asserted |
| AUTO-004 | 5 | Blank reason 400 | `tests/e2e/helpers/report-reminders-flow.mjs:75` | asserted |
| AUTO-004 | 5 | No waiver | `tests/e2e/helpers/report-reminders-flow.mjs:76` | asserted |
| AUTO-004 | 5 | Tick after refused blank waiver has the expected exact email count | `tests/e2e/helpers/report-reminders-flow.mjs:53` | asserted |
| AUTO-004 | 5 | Tick after refused blank waiver has the expected exact Slack/Teams counts | `tests/e2e/helpers/report-reminders-flow.mjs:56` | asserted |
| AUTO-004 | 3 | Published report stops reminders | `tests/e2e/publishing-contract.test.mjs:1230` | asserted |
| AUTO-004 | 4 | Later report remains publishable | `tests/e2e/publishing-contract.test.mjs:1228` | asserted |
| AUTO-004 | 4 | Waiver audit timestamp read back | none | none |
| AUTO-004 | 6 | Historical-only imports create no reminder obligation | `tests/e2e/helpers/follow-ups-flow.mjs:87` | asserted |
| DRAFT-001 | 1 | Nonempty fields filled and empty results preserved | none | none |
| DRAFT-001 | 1 | Every field editable | none | none |
| DRAFT-001 | 2 | Known references retained | `tests/e2e/incident-brief.test.mjs:155` | asserted |
| DRAFT-001 | 2 | Unknown and question references removed | `tests/e2e/incident-brief.test.mjs:156` | asserted |
| DRAFT-001 | 2 | Unsourced text visibly marked | none | none |
| DRAFT-001 | 3 | Sources beside fields open brief | none | none |
| DRAFT-001 | 4 | Suggestion result has no lifecycle field | `tests/e2e/incident-brief.test.mjs:154` | asserted |
| DRAFT-001 | 4 | Suggestion result has no next-update field | `tests/e2e/incident-brief.test.mjs:154` | asserted |
| DRAFT-001 | 5 | Incident lifecycle unchanged | `tests/e2e/incident-brief.test.mjs:160` | asserted |
| DRAFT-001 | 5 | Published updates unchanged | `tests/e2e/incident-brief.test.mjs:161` | asserted |
| DRAFT-001 | 5 | Saved draft unchanged | `tests/e2e/incident-brief.test.mjs:162` | asserted |
| DRAFT-001 | 5 | Suggestion generation preserves public page bytes and status | `tests/e2e/incident-brief.test.mjs:163` | asserted |
| DRAFT-001 | 5 | Suggestion generation preserves Atom feed bytes and status | `tests/e2e/incident-brief.test.mjs:163` | asserted |
| DRAFT-001 | 5 | Suggestion generation preserves public status JSON bytes and status | `tests/e2e/incident-brief.test.mjs:163` | asserted |
| DRAFT-001 | 5 | Suggestion generation preserves widget script bytes and status | `tests/e2e/incident-brief.test.mjs:163` | asserted |
| DRAFT-002 | 1 | Brief unchanged | `tests/e2e/incident-brief.test.mjs:143` | asserted |
| DRAFT-002 | 2 | Internal component excluded | `tests/e2e/incident-brief.test.mjs:136` | asserted |
| DRAFT-002 | 2 | Internal notes excluded | `tests/e2e/incident-brief.test.mjs:144` | asserted |
| DRAFT-002 | 3 | Tone instructions included | none | none |
| DRAFT-004 | 1 | Alert count | `tests/e2e/incident-brief.test.mjs:97` | asserted |
| DRAFT-004 | 1 | Alert source record. | `tests/e2e/incident-brief.test.mjs:98` | asserted |
| DRAFT-004 | 1 | Alert time | `tests/e2e/incident-brief.test.mjs:100` | asserted |
| DRAFT-004 | 1 | The brief lists exactly the attached public component names | `tests/e2e/incident-brief.test.mjs:101` | asserted |
| DRAFT-004 | 1 | The brief preserves each listed component’s claimed state | `tests/e2e/incident-brief.test.mjs:101` | asserted |
| DRAFT-004 | 1 | The brief includes exactly the expected published update references | `tests/e2e/incident-brief.test.mjs:119` | asserted |
| DRAFT-004 | 1 | The brief preserves its published lifecycle | `tests/e2e/incident-brief.test.mjs:119` | asserted |
| DRAFT-004 | 1 | The brief preserves its public customer-impact text | `tests/e2e/incident-brief.test.mjs:119` | asserted |
| DRAFT-004 | 2 | The brief asks its missing audience question | `tests/e2e/incident-brief.test.mjs:103` | asserted |
| DRAFT-004 | 2 | The brief asks its missing customer-impact question | `tests/e2e/incident-brief.test.mjs:103` | asserted |
| DRAFT-004 | 2 | The brief asks its missing next-update question | `tests/e2e/incident-brief.test.mjs:103` | asserted |
| DRAFT-004 | 2 | The brief asks its never-published alert question | `tests/e2e/incident-brief.test.mjs:103` | asserted |
| DRAFT-004 | 3 | The brief asks about recovery of an unresolved published incident | `tests/e2e/incident-brief.test.mjs:122` | asserted |
| DRAFT-004 | 3 | The brief asks about the overdue next-update commitment | `tests/e2e/incident-brief.test.mjs:122` | asserted |
| DRAFT-004 | 4 | Unique references | `tests/e2e/incident-brief.test.mjs:105` | asserted |
| DRAFT-004 | 4 | References stable | `tests/e2e/incident-brief.test.mjs:121` | asserted |
| DRAFT-004 | 5 | Brief equals model input | `tests/e2e/incident-brief.test.mjs:143` | asserted |
| DRAFT-004 | 2 | No-component question | none | none |
| DRAFT-004 | 5 | Building brief sends no model request | none | none |
| DRAFT-004 | 6 | Collapsed page matches model input | none | none |
| DRAFT-003 | 1 | No suggestion control | `tests/e2e/publishing-browser.test.mjs:459` | asserted |
| DRAFT-003 | 1 | No outbound request | `tests/e2e/incident-brief.test.mjs:263` | asserted |
| DRAFT-003 | 2 | Failure error | `tests/e2e/incident-brief.test.mjs:243` | asserted |
| DRAFT-003 | 2 | Silent provider returns error | `tests/e2e/incident-brief.test.mjs:251` | asserted |
| DRAFT-003 | 2 | Twenty-second bound exact | none | none |
| DRAFT-003 | 2 | Composer error visible | `tests/e2e/publishing-browser.test.mjs:740` | asserted |
| DRAFT-003 | 3 | Ordinary publish after failure | `tests/e2e/incident-brief.test.mjs:244` | asserted |
| DRAFT-003 | 3 | Ordinary publish after timeout | `tests/e2e/incident-brief.test.mjs:253` | asserted |
| DRAFT-003 | 3 | Every other publication path remains unchanged | none | none |
| TEAM-001 | 1 | Every incident privilege | none | none |
| TEAM-001 | 1 | Every maintenance privilege | none | none |
| TEAM-001 | 2 | Another operator creates a component | `tests/auth-adoption/upgrade.test.mjs:97` | asserted |
| TEAM-001 | 2 | Subscriber route admits another owner | `tests/e2e/delivery-contract.test.mjs:958` | asserted |
| TEAM-001 | 2 | Complete component and subscriber mutation parity | none | none |
| TEAM-001 | 3 | Migrated operators all owner role | `tests/auth-adoption/upgrade.test.mjs:76` | asserted |
| TEAM-002 | 1 | Settings invitation outcome | none | none |
| TEAM-002 | 2 | Native operator-removal route durably deactivates the identity | `tests/auth-adoption/upgrade.test.mjs:110` | asserted |
| TEAM-002 | 2 | Native operator-removal route anonymizes the email | `tests/auth-adoption/upgrade.test.mjs:110` | asserted |
| TEAM-002 | 2 | Settings removal is completed through the browser | none | none |
| TEAM-002 | 3 | Another owner cannot revoke setup owner | `tests/auth-adoption/upgrade.test.mjs:93` | asserted |
| TEAM-002 | 3 | Self-removal succeeds | `tests/auth-adoption/upgrade.test.mjs:114` | asserted |
| TEAM-002 | 3 | Other owner cannot delete setup owner while still active | none | none |
| TEAM-003 | 1 | Published update actor | none | none |
| TEAM-003 | 1 | Component state actor | none | none |
| TEAM-003 | 1 | Maintenance actor | none | none |
| TEAM-003 | 1 | History correction actor | none | none |
| TEAM-003 | 1 | Subscriber deletion actor | `tests/e2e/delivery-contract.test.mjs:640` | asserted |
| TEAM-003 | 2 | Name shown privately | none | none |
| TEAM-003 | 2 | Name absent from populated public surfaces | none | none |
| HIST-001 | 1 | Resolved incident listed | `tests/e2e/public-contract.test.mjs:873` | asserted |
| HIST-001 | 1 | Completed maintenance listed | `tests/e2e/public-contract.test.mjs:874` | asserted |
| HIST-001 | 1 | Older record excluded | `tests/e2e/public-contract.test.mjs:877` | asserted |
| HIST-001 | 1 | Month grouping asserted | none | none |
| HIST-001 | 2 | The public incident displays the expected elapsed duration | `tests/e2e/public-contract.test.mjs:872` | asserted |
| HIST-001 | 2 | The public incident contains its resolution instant | `tests/e2e/public-contract.test.mjs:871` | asserted |
| HIST-001 | 2 | The public history displays the incident’s opening instant | none | none |
| HIST-001 | 2 | Affected component | `tests/e2e/public-contract.test.mjs:875` | asserted |
| HIST-001 | 2 | Maintenance start/end/duration | none | none |
| HIST-001 | 2 | Every published update included | none | none |
| HIST-002 | 1 | The saved report retains summary | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| HIST-002 | 1 | The saved report retains timeline | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| HIST-002 | 1 | The saved report retains cause | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| HIST-002 | 1 | The saved report retains remediation | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| HIST-002 | 1 | A published report refuses another draft | `tests/e2e/publishing-contract.test.mjs:1188` | asserted |
| HIST-002 | 1 | A published report refuses changed cause text | `tests/e2e/publishing-contract.test.mjs:1189` | asserted |
| HIST-002 | 1 | A published report refuses another publication | `tests/e2e/publishing-contract.test.mjs:1190` | asserted |
| HIST-002 | 2 | Public report text | `tests/e2e/publishing-contract.test.mjs:1193` | asserted |
| HIST-002 | 2 | Ten-second bound | none | none |
| HIST-002 | 3 | Selected report channels and omitted channels | none | none |
| HIST-003 | 1 | A representative Major-outage incident is listed as report-due after eight days | `tests/e2e/publishing-contract.test.mjs:1243` | asserted |
| HIST-003 | 1 | The operator report-due listing is asserted at the seven-day boundary | none | none |
| HIST-003 | 1 | The severity rule is represented by another Major-outage report-due case | `tests/e2e/publishing-contract.test.mjs:1206` | asserted |
| HIST-004 | 1 | The exported incident table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source incident record is present in the export | none | none |
| HIST-004 | 1 | The exported update table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source update record is present in the export | none | none |
| HIST-004 | 1 | The exported component table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source component record is present in the export | none | none |
| HIST-004 | 1 | The exported component state-history table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source component state-history record is present in the export | none | none |
| HIST-004 | 1 | The exported maintenance table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source maintenance record is present in the export | none | none |
| HIST-004 | 1 | The exported subscriber table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source subscriber record is present in the export | none | none |
| HIST-004 | 1 | Every exported subscriber retains its expected source channel | none | none |
| HIST-004 | 1 | Every exported subscriber retains its expected source state | none | none |
| HIST-004 | 1 | The exported delivery table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source delivery record is present in the export | none | none |
| HIST-004 | 1 | The exported post-incident report table is populated | `tests/e2e/export-import.test.mjs:200` | asserted |
| HIST-004 | 1 | Every source post-incident report record is present in the export | none | none |
| HIST-004 | 1 | Every table and row present in the archive is restored identically | `tests/e2e/export-import.test.mjs:194` | asserted |
| HIST-004 | 1 | The archive contains the full source entity graph | none | none |
| HIST-004 | 2 | The exported settings table is populated | `tests/e2e/export-import.test.mjs:197` | asserted |
| HIST-004 | 2 | Every source setting is present with its expected source value | none | none |
| HIST-004 | 2 | The exported audit table is populated | `tests/e2e/export-import.test.mjs:198` | asserted |
| HIST-004 | 2 | Every source audit entry is present with its complete source contents | none | none |
| HIST-004 | 3 | Original image bytes | `tests/e2e/export-import.test.mjs:207` | asserted |
| HIST-005 | 1 | First latency | `tests/e2e/helpers/communication-performance-flow.mjs:75` | asserted |
| HIST-005 | 1 | Second latency | `tests/e2e/helpers/communication-performance-flow.mjs:76` | asserted |
| HIST-005 | 1 | Third latency | `tests/e2e/helpers/communication-performance-flow.mjs:77` | asserted |
| HIST-005 | 2 | Two of three kept | `tests/e2e/helpers/communication-performance-flow.mjs:71` | asserted |
| HIST-005 | 2 | Backdating preserves missed promise | `tests/e2e/helpers/communication-performance-flow.mjs:83` | asserted |
| HIST-005 | 3 | Resolution duration | `tests/e2e/helpers/communication-performance-flow.mjs:78` | asserted |
| HIST-005 | 3 | Reports owed | `tests/e2e/helpers/communication-performance-flow.mjs:74` | asserted |
| HIST-005 | 4 | The selected update is the only returned update | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Email committed count is ten | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Email delivered count is nine | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Email bounced count is one | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Email provider-accepted count remains ten despite two attempts | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Webhook committed count is two | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Webhook delivered count is two | `tests/e2e/helpers/communication-performance-flow.mjs:109` | asserted |
| HIST-005 | 4 | Repeated-recipient send count reaches twenty | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| HIST-005 | 4 | Distinct committed reach remains ten | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| HIST-005 | 4 | Distinct delivered reach remains eight | `tests/e2e/helpers/communication-performance-flow.mjs:119` | asserted |
| HIST-005 | 5 | Incident CSV preserves the expected email committed count | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| HIST-005 | 5 | Incident CSV preserves the expected email delivered count | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| HIST-005 | 5 | Incident CSV preserves the expected email bounced count | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| HIST-005 | 5 | Incident CSV preserves the expected email provider-accepted count | `tests/e2e/helpers/communication-performance-flow.mjs:111` | asserted |
| HIST-005 | 5 | Every incident CSV field and channel matches its report value | none | none |
| HIST-005 | 5 | Monthly CSV email distinct-committed count is ten | `tests/e2e/helpers/communication-performance-flow.mjs:124` | asserted |
| HIST-005 | 5 | Every monthly CSV value equals the corresponding displayed monthly report value | none | none |
| HIST-005 | 6 | Configured zone month | `tests/e2e/helpers/communication-performance-flow.mjs:69` | asserted |
| HIST-005 | 6 | An imported incident without accepted-alert history has unknown first-update latency | `tests/e2e/helpers/communication-performance-flow.mjs:95` | asserted |
| HIST-005 | 6 | An imported update without source delivery facts has unknown committed count | `tests/e2e/helpers/communication-performance-flow.mjs:96` | asserted |
| HIST-005 | 6 | Missing source delivery coverage is labeled unknown | `tests/e2e/helpers/communication-performance-flow.mjs:96` | asserted |
| HIST-005 | 4 | Delivery failure rate exact denominator | none | none |
| HIST-006 | 1 | Stored keys only surface minute count | `tests/e2e/helpers/traffic-alerts-flow.mjs:158` | asserted |
| HIST-006 | 1 | Visitor identifiers and raw path absent | `tests/e2e/helpers/traffic-alerts-flow.mjs:162` | asserted |
| HIST-006 | 2 | No database binding | `tests/e2e/helpers/traffic-alerts-flow.mjs:168` | asserted |
| HIST-006 | 2 | Public page responds 200 with no database binding | `tests/e2e/helpers/traffic-alerts-flow.mjs:181` | asserted |
| HIST-006 | 2 | Atom feed responds 200 with no database binding | `tests/e2e/helpers/traffic-alerts-flow.mjs:181` | asserted |
| HIST-006 | 2 | Widget responds 200 with no database binding | `tests/e2e/helpers/traffic-alerts-flow.mjs:181` | asserted |
| HIST-006 | 2 | Public page retains its expected full content without the database | none | none |
| HIST-006 | 2 | Atom feed retains its expected full content without the database | none | none |
| HIST-006 | 2 | Widget retains its expected full content without the database | none | none |
| HIST-006 | 2 | The page minute counter records its single no-database request | `tests/e2e/helpers/traffic-alerts-flow.mjs:188` | asserted |
| HIST-006 | 2 | The feed counter records its no-database request | none | none |
| HIST-006 | 2 | The widget counter records its no-database request | none | none |
| HIST-006 | 3 | Uneven same-hour baseline sums | `tests/e2e/helpers/traffic-alerts-flow.mjs:82` | asserted |
| HIST-006 | 3 | Missing historical hour zero | `tests/e2e/helpers/traffic-alerts-flow.mjs:124` | asserted |
| HIST-006 | 3 | Cold surface no spike | `tests/e2e/helpers/traffic-alerts-flow.mjs:125` | asserted |
| HIST-006 | 4 | One stored alert | `tests/e2e/helpers/traffic-alerts-flow.mjs:95` | asserted |
| HIST-006 | 4 | Surface and minute | `tests/e2e/helpers/traffic-alerts-flow.mjs:96` | asserted |
| HIST-006 | 4 | One provider request | `tests/e2e/helpers/traffic-alerts-flow.mjs:98` | asserted |
| HIST-006 | 4 | The provider message contains a numeric ten | `tests/e2e/helpers/traffic-alerts-flow.mjs:99` | asserted |
| HIST-006 | 4 | The provider message binds ten to the observed minute request count | none | none |
| HIST-006 | 4 | The provider message contains a numeric two | `tests/e2e/helpers/traffic-alerts-flow.mjs:100` | asserted |
| HIST-006 | 4 | The provider message binds two to the same-hour baseline mean | none | none |
| HIST-006 | 4 | Operator app link | `tests/e2e/helpers/traffic-alerts-flow.mjs:101` | asserted |
| HIST-006 | 5 | Repeat tick no alert | `tests/e2e/helpers/traffic-alerts-flow.mjs:106` | asserted |
| HIST-006 | 5 | Consecutive minutes one episode | `tests/e2e/helpers/traffic-alerts-flow.mjs:109` | asserted |
| HIST-006 | 5 | No provider replay | `tests/e2e/helpers/traffic-alerts-flow.mjs:110` | asserted |
| HIST-006 | 6 | Unresolved incident suppresses fresh burst | `tests/e2e/helpers/traffic-alerts-flow.mjs:140` | asserted |
| HIST-006 | 7 | Traffic alerts preserve public status JSON bytes | `tests/e2e/helpers/traffic-alerts-flow.mjs:111` | asserted |
| HIST-006 | 7 | Traffic alerts create no customer-facing incident | none | none |
| HIST-006 | 7 | Traffic alerts preserve public page, feed and widget bytes | none | none |
| HIST-006 | 3 | Zero baseline never infers spike | none | none |
| HIST-009 | 1 | Default three | `tests/e2e/helpers/traffic-alerts-flow.mjs:46` | asserted |
| HIST-009 | 1 | Six suppresses five | `tests/e2e/helpers/traffic-alerts-flow.mjs:88` | asserted |
| HIST-009 | 1 | Three admits burst | `tests/e2e/helpers/traffic-alerts-flow.mjs:95` | asserted |
| HIST-009 | 2 | Stored value unchanged | `tests/e2e/helpers/traffic-alerts-flow.mjs:50` | asserted |
| HIST-009 | 2 | UI invalid state | `tests/e2e/helpers/traffic-alerts-flow.mjs:213` | asserted |
| HIST-009 | 2 | Invalid edit retained | `tests/e2e/helpers/traffic-alerts-flow.mjs:218` | asserted |
| HIST-009 | 3 | Acknowledged value survives reload | `tests/e2e/helpers/traffic-alerts-flow.mjs:222` | asserted |
| HIST-009 | 3 | No overflow | `tests/e2e/helpers/traffic-alerts-flow.mjs:223` | asserted |
| HIST-009 | 3 | No hydration errors | `tests/e2e/helpers/traffic-alerts-flow.mjs:226` | asserted |
| HIST-009 | 3 | Serial autosave ordering | none | none |
| HIST-010 | 1 | Unknown surface not tracked | `tests/e2e/helpers/traffic-resolution-flow.mjs:22` | asserted |
| HIST-010 | 1 | Only known surfaces evidence | `tests/e2e/helpers/traffic-resolution-flow.mjs:23` | asserted |
| HIST-010 | 1 | All unknown surfaces learning | `tests/e2e/helpers/traffic-resolution-flow.mjs:28` | asserted |
| HIST-010 | 2 | Backdated refusal | `tests/e2e/helpers/traffic-resolution-flow.mjs:34` | asserted |
| HIST-010 | 2 | The refused backdated publication keeps lifecycle Investigating | `tests/e2e/helpers/traffic-resolution-flow.mjs:36` | asserted |
| HIST-010 | 2 | A Resolved draft remains present after refusal | `tests/e2e/helpers/traffic-resolution-flow.mjs:36` | asserted |
| HIST-010 | 2 | Every field of the retained incident and draft remains unchanged | none | none |
| HIST-010 | 3 | Immediate override resolves | `tests/e2e/helpers/traffic-resolution-flow.mjs:43` | asserted |
| HIST-010 | 3 | The override reason appears in a private timeline note | `tests/e2e/helpers/traffic-resolution-flow.mjs:44` | asserted |
| HIST-010 | 3 | That private override note names the acting operator | `tests/e2e/helpers/traffic-resolution-flow.mjs:44` | asserted |
| HIST-010 | 3 | The override audit entry contains its reason | `tests/e2e/helpers/traffic-resolution-flow.mjs:46` | asserted |
| HIST-010 | 3 | The same override audit entry names its operator | `tests/e2e/helpers/traffic-resolution-flow.mjs:46` | asserted |
| HIST-010 | 3 | No public reason | `tests/e2e/helpers/traffic-resolution-flow.mjs:49` | asserted |
| HIST-010 | 4 | Later resolution checked | `tests/e2e/helpers/traffic-resolution-flow.mjs:59` | asserted |
| HIST-010 | 5 | Due-time hold | `tests/e2e/helpers/traffic-resolution-flow.mjs:71` | asserted |
| HIST-010 | 5 | A Resolved draft is still present after the due-time hold | `tests/e2e/helpers/traffic-resolution-flow.mjs:72` | asserted |
| HIST-010 | 5 | The complete held scheduled draft retains its saved fields | none | none |
| HIST-010 | 6 | Near-baseline traffic | `tests/e2e/helpers/traffic-resolution-flow.mjs:79` | asserted |
| HIST-010 | 6 | Retained schedule publishes | `tests/e2e/helpers/traffic-resolution-flow.mjs:82` | asserted |
| HIST-010 | 6 | Near-baseline scheduled publication adds no private note | `tests/e2e/helpers/traffic-resolution-flow.mjs:84` | asserted |
| HIST-010 | 6 | Near-baseline scheduled publication creates no override audit or other override record | none | none |
| HIST-010 | 2 | Immediate unreasoned refusal | `tests/e2e/helpers/traffic-alerts-flow.mjs:149` | asserted |
| HIST-007 | 1 | Current total equals whole list | `tests/e2e/helpers/subscriber-reporting-flow.mjs:94` | asserted |
| HIST-007 | 1 | Each returned channel/state bucket equals the matching complete-list filter count | `tests/e2e/helpers/subscriber-reporting-flow.mjs:95` | asserted |
| HIST-007 | 1 | Every nonzero channel/state bucket is present in the report | none | none |
| HIST-007 | 2 | Component count | `tests/e2e/helpers/subscriber-reporting-flow.mjs:69` | asserted |
| HIST-007 | 2 | Deactivation reason | `tests/e2e/helpers/subscriber-reporting-flow.mjs:70` | asserted |
| HIST-007 | 3 | Unavailable dimensions explicit | `tests/e2e/helpers/subscriber-reporting-flow.mjs:103` | asserted |
| HIST-007 | 4 | Net change | `tests/e2e/helpers/subscriber-reporting-flow.mjs:77` | asserted |
| HIST-007 | 4 | Each returned daily closing value equals its reported opening plus net change | `tests/e2e/helpers/subscriber-reporting-flow.mjs:78` | asserted |
| HIST-007 | 4 | Daily opening inventory matches its actual baseline or the previous day’s closing inventory | none | none |
| HIST-007 | 4 | Daily closing inventory equals the actual eligible subscriber inventory | none | none |
| HIST-007 | 4 | Confirmation neutral | `tests/e2e/helpers/subscriber-reporting-flow.mjs:85` | asserted |
| HIST-007 | 5 | The combined channel-move, deactivation, erasure and physical-deletion fixture adds the expected aggregate four joins and four leaves | `tests/e2e/helpers/subscriber-reporting-flow.mjs:92` | asserted |
| HIST-007 | 5 | The channel move records its exact individual join and leave atomically | none | none |
| HIST-007 | 5 | Erasure records its exact individual leave atomically | none | none |
| HIST-007 | 5 | Import undo records its exact individual leave atomically | none | none |
| HIST-007 | 6 | CSV summary total | `tests/e2e/helpers/subscriber-reporting-flow.mjs:74` | asserted |
| HIST-007 | 6 | CSV daily net-change equals the corresponding report row | `tests/e2e/helpers/subscriber-reporting-flow.mjs:80` | asserted |
| HIST-007 | 6 | CSV daily closing-inventory equals the corresponding report row | `tests/e2e/helpers/subscriber-reporting-flow.mjs:80` | asserted |
| HIST-007 | 6 | Every remaining displayed aggregate and CSV value agree | none | none |
| HIST-007 | 6 | No destinations | `tests/e2e/helpers/subscriber-reporting-flow.mjs:99` | asserted |
| HIST-007 | 6 | No subscriber identities | `tests/e2e/helpers/subscriber-reporting-flow.mjs:100` | asserted |
| HIST-007 | 7 | Historical days unknown | `tests/e2e/helpers/subscriber-reporting-flow.mjs:102` | asserted |
| HIST-007 | 3 | Audience count/trend/CSV | none | none |
| HIST-007 | 3 | Language count/trend/CSV | none | none |
| HIST-007 | 5 | Expiry facts update atomically | none | none |
| HIST-007 | 7 | Any subscriber-reporting rows contained in the archive are restored identically | `tests/e2e/export-import.test.mjs:194` | asserted |
| HIST-007 | 7 | The source’s complete nonempty observed subscriber-reporting facts are present in that archive | none | none |
| HIST-007 | 7 | Legacy restore baseline | `tests/e2e/export-import.test.mjs:232` | asserted |
| HIST-008 | 1 | Earlier month index link | `tests/e2e/helpers/catalogue-history-flow.mjs:191` | asserted |
| HIST-008 | 1 | Oldest imported incident reached | `tests/e2e/helpers/catalogue-history-flow.mjs:209` | asserted |
| HIST-008 | 1 | Script-disabled navigation asserted | none | none |
| HIST-008 | 2 | No navigation loop | `tests/e2e/helpers/catalogue-history-flow.mjs:200` | asserted |
| HIST-008 | 2 | A previous-month link exists during traversal to the oldest imported incident | `tests/e2e/helpers/catalogue-history-flow.mjs:204` | asserted |
| HIST-008 | 2 | Every traversed intermediate month contains an incident or completed maintenance rather than an empty-month hop | none | none |
| HIST-008 | 2 | Next month backlinks | `tests/e2e/helpers/catalogue-history-flow.mjs:206` | asserted |
| HIST-008 | 3 | Configured timezone month | `tests/e2e/helpers/catalogue-history-flow.mjs:196` | asserted |
| HIST-008 | 3 | Old incident permalink readable | `tests/e2e/helpers/catalogue-history-flow.mjs:210` | asserted |
| HIST-008 | 3 | Every completed maintenance and incident listed | none | none |
| HIST-008 | 4 | Database unavailable month read | none | none |
| HIST-008 | 5 | Sorry alias redirect | `tests/e2e/helpers/catalogue-history-flow.mjs:214` | asserted |
| HIST-008 | 5 | Invalid native month distinct | `tests/e2e/helpers/catalogue-history-flow.mjs:215` | asserted |
| AUTO-004 | 6 | Live publication starts reminders on previously historical import | none | none |
| MOBILE-001 | 1 | The native terminal link signs in at both widths | none | none |
| MOBILE-001 | 1 | Accepted alert has no published updates | `tests/e2e/helpers/phone-desk-flow.mjs:48` | asserted |
| MOBILE-001 | 2 | The component is attached to the published incident | `tests/e2e/helpers/phone-desk-flow.mjs:76` | asserted |
| MOBILE-001 | 2 | Saved impact wording survives reload | `tests/e2e/helpers/phone-desk-flow.mjs:66` | asserted |
| MOBILE-001 | 2 | Every other saved draft field survives reload | none | none |
| MOBILE-001 | 2 | Email preview contains the expected complete notification | none | none |
| MOBILE-001 | 3 | Publication has its complete visible result | none | none |
| MOBILE-001 | 3 | Resolution has its complete visible result | none | none |
| MOBILE-001 | 3 | Publication creates one persisted update | `tests/e2e/helpers/phone-desk-flow.mjs:75` | asserted |
| MOBILE-001 | 3 | Resolution stores the Resolved lifecycle | `tests/e2e/helpers/phone-desk-flow.mjs:87` | asserted |
| MOBILE-001 | 4 | Standing claim persisted and visible result | none | none |
| MOBILE-001 | 5 | Scheduled maintenance persisted and visible result | none | none |
| MOBILE-001 | 6 | Each inspected screen has no overflow | `tests/e2e/helpers/phone-desk-flow.mjs:15` | asserted |
| MOBILE-001 | 6 | Phone controls are at least 44 by 44 pixels | `tests/e2e/helpers/phone-desk-flow.mjs:23` | asserted |
| SETUP-001 | 1 | Lamp actually reads the rendered public page after publication | none | none |
| SETUP-001 | 1 | Lamp actually inspects the rendered subscription form after publication | none | none |
| SETUP-001 | 1 | Form check is at or after publication | `tests/e2e/setup-readiness.test.mjs:94` | asserted |
| SETUP-001 | 1 | Every change republishes | none | none |
| SETUP-001 | 1 | Each minute scheduled check repeats | none | none |
| SETUP-001 | 2 | Changing the hosted sender authenticates against its provider | none | none |
| SETUP-001 | 2 | Sender check repeats daily | none | none |
| SETUP-001 | 3 | Overview shows the public address | `tests/e2e/setup-readiness.test.mjs:101` | asserted |
| SETUP-001 | 3 | Publication time is present | `tests/e2e/setup-readiness.test.mjs:92` | asserted |
| SETUP-001 | 3 | Checked page/form wording is visible | `tests/e2e/setup-readiness.test.mjs:102` | asserted |
| SETUP-001 | 3 | Page/form check times are displayed | none | none |
| SETUP-001 | 3 | Review page opens the preview and checks | none | none |
| SETUP-001 | 3 | Change address opens Settings | none | none |
| SETUP-001 | 4 | Failure marks the Overview line failing | `tests/e2e/setup-readiness.test.mjs:224` | asserted |
| SETUP-001 | 4 | Failure creates a visible problem | `tests/e2e/setup-readiness.test.mjs:225` | asserted |
| SETUP-001 | 4 | Failure has one corrective action | none | none |
| SETUP-001 | 4 | Results belong to the address actually checked after address changes | none | none |
| SETUP-001 | 5 | Deployment public origin is used | `tests/e2e/setup-readiness.test.mjs:91` | asserted |
| SETUP-001 | 5 | A custom domain is optional | none | none |
| SETUP-001 | 6 | Local sender state is local | `tests/e2e/setup-readiness.test.mjs:95` | asserted |
| SETUP-001 | 6 | Local outgoing mail is suppressed | none | none |
| SETUP-001 | 6 | No captured-mail inbox exists | none | none |
| SETUP-001 | 6 | Automatic one-click local owner entry needs no email | none | none |
| SETUP-001 | 7 | A subscriber publication records a suppressed outcome | none | none |
| SETUP-001 | 7 | Suppressed outcome is visible in Notifications | none | none |
| SETUP-001 | 7 | Suppressed outcome is not provider acknowledgement | none | none |
| SETUP-001 | 8 | Local deliveries identify local mail | `tests/e2e/setup-readiness.test.mjs:142` | asserted |
| SETUP-001 | 8 | Managed sender is not called verified | `tests/e2e/setup-readiness.test.mjs:228` | asserted |
| SETUP-001 | 8 | Public reading makes no database query | none | none |
| SETUP-002 | 1 | Every operator document gates incomplete first run | none | none |
| SETUP-002 | 1 | Signed-out setup returns through sign-in to setup | none | none |
| SETUP-002 | 2 | No website script request occurs | `tests/e2e/website-onboarding.test.mjs:169` | asserted |
| SETUP-002 | 2 | Reload makes no second site read | `tests/e2e/website-onboarding.test.mjs:129` | asserted |
| SETUP-002 | 2 | Every redirect refuses private/loopback destinations | none | none |
| SETUP-002 | 2 | Observed page name is stored | `tests/e2e/website-onboarding.test.mjs:136` | asserted |
| SETUP-002 | 2 | Observed tagline is stored | `tests/e2e/website-onboarding.test.mjs:136` | asserted |
| SETUP-002 | 2 | Observed accent colour is stored | `tests/e2e/website-onboarding.test.mjs:136` | asserted |
| SETUP-002 | 2 | Browser timezone is stored | `tests/e2e/website-onboarding.test.mjs:136` | asserted |
| SETUP-002 | 2 | Mark is stored as PNG bytes | `tests/e2e/website-onboarding.test.mjs:168` | asserted |
| SETUP-002 | 2 | Navigation components are observed | `tests/e2e/website-onboarding.test.mjs:75` | asserted |
| SETUP-002 | 3 | Source status component groups replace navigation | `tests/e2e/website-onboarding.test.mjs:101` | asserted |
| SETUP-002 | 3 | Component source is labeled | `tests/e2e/website-onboarding.test.mjs:99` | asserted |
| SETUP-002 | 3 | Instatus and Better Stack linked/subdomain source selection | none | none |
| SETUP-002 | 4 | History starts unselected | `tests/e2e/website-onboarding.test.mjs:103` | asserted |
| SETUP-002 | 4 | History imports only resolved fixture incidents | `tests/e2e/website-onboarding.test.mjs:147` | asserted |
| SETUP-002 | 4 | No active incident is created | `tests/e2e/website-onboarding.test.mjs:148` | asserted |
| SETUP-002 | 4 | Update timestamps equal source timestamps | `tests/e2e/website-onboarding.test.mjs:152` | asserted |
| SETUP-002 | 4 | History sends no delivery | `tests/e2e/website-onboarding.test.mjs:150` | asserted |
| SETUP-002 | 4 | History imports no maintenance | none | none |
| SETUP-002 | 4 | History imports no subscriber | none | none |
| SETUP-002 | 5 | Unreadable website leaves a calm domain-derived name | `tests/e2e/website-onboarding.test.mjs:86` | asserted |
| SETUP-002 | 5 | Omitted website leaves editable plain defaults | none | none |
| SETUP-002 | 5 | A status feed with no components changes none | none | none |
| SETUP-002 | 6 | Edited settings persist | `tests/e2e/website-onboarding.test.mjs:136` | asserted |
| SETUP-002 | 6 | Edited component groups persist | `tests/e2e/website-onboarding.test.mjs:140` | asserted |
| SETUP-002 | 6 | PNG bytes persist | `tests/e2e/website-onboarding.test.mjs:168` | asserted |
| SETUP-002 | 6 | Completion durably persists | none | none |
| SETUP-002 | 6 | All settings remain editable after completion | none | none |
| SETUP-002 | 7 | Prior first-run completion survives setup | `tests/e2e/auth-adoption-journey.test.mjs:158` | asserted |
| SETUP-002 | 7 | Every pre-existing operator installation is migration-complete | none | none |
| SETUP-002 | 7 | Completed setup redirects to app | none | none |
| ACCESS-001 | 1 | The command reads the session secret only from its environment | none | none |
| ACCESS-001 | 1 | Missing secret is refused by name | none | none |
| ACCESS-001 | 2 | Hashed twenty-minute link | none | none |
| ACCESS-001 | 2 | Single-use consumption | none | none |
| ACCESS-001 | 2 | Exactly one stdout raw-link copy | none | none |
| ACCESS-001 | 2 | Terminal-link creation audit event | none | none |
| ACCESS-001 | 3 | No account is created by issuance | none | none |
| ACCESS-001 | 3 | No session is created by issuance | none | none |
| ACCESS-001 | 3 | Consumption creates the Base session | none | none |
| ACCESS-001 | 4 | Unknown operator gets the common refusal | none | none |
| ACCESS-001 | 4 | Deactivated operator gets the common refusal | none | none |
| ACCESS-001 | 4 | Erased operator gets the common refusal | none | none |
| ACCESS-002 | 1 | Provider discovery marks it optional | `tests/auth-adoption/dependencies.test.mjs:39` | asserted |
| ACCESS-002 | 1 | Unlinked provider cannot start sign-in | `tests/auth-adoption/dependencies.test.mjs:59` | asserted |
| ACCESS-002 | 1 | Disabled sign-in renders no provider form | `tests/auth-adoption/dependencies.test.mjs:74` | asserted |
| ACCESS-002 | 2 | Enabled standards fixture redirects to its provider | `tests/auth-adoption/dependencies.test.mjs:90` | asserted |
| ACCESS-002 | 2 | Native email session remains usable | `tests/auth-adoption/dependencies.test.mjs:91` | asserted |
| ACCESS-002 | 2 | Auth standards sign-in completes | none | none |
| ACCESS-002 | 2 | Google standards sign-in completes | none | none |
| ACCESS-002 | 2 | Microsoft standards sign-in completes | none | none |
| ACCESS-002 | 2 | Okta standards sign-in completes | none | none |
| MOVE-001 | 1 | Each named provider accepts API-key and saved-response input | none | none |
| MOVE-001 | 1 | Source credential is read once from fixed source origin | none | none |
| MOVE-001 | 1 | Source credential is never stored | none | none |
| MOVE-001 | 2 | Dry run counts every source category before application | none | none |
| MOVE-001 | 2 | Dry run leaves components unwritten | `tests/betterstack/flow.test.mjs:52` | asserted |
| MOVE-001 | 2 | Dry run leaves every other table unwritten | none | none |
| MOVE-001 | 2 | Each imported/changed/skipped/refused item has a named reason | none | none |
| MOVE-001 | 3 | Changed source refuses apply | `tests/betterstack/flow.test.mjs:108` | asserted |
| MOVE-001 | 3 | Changed target refuses apply and names the stale review | `tests/betterstack/flow.test.mjs:112` | asserted |
| MOVE-001 | 3 | Stale-target refusal leaves no import job | `tests/betterstack/flow.test.mjs:113` | asserted |
| MOVE-001 | 3 | Stale-target refusal creates no component | `tests/betterstack/flow.test.mjs:113` | asserted |
| MOVE-001 | 3 | Stale-target refusal retains the one pre-existing group | `tests/betterstack/flow.test.mjs:113` | asserted |
| MOVE-001 | 4 | Each channel capacity excess is named | none | none |
| MOVE-001 | 4 | Excess subscribers are refused during dry run | none | none |
| MOVE-001 | 4 | An over-limit apply writes nothing | none | none |
| MOVE-002 | 1 | Sorry incident update timestamps equal source times | `tests/e2e/sorry-import.test.mjs:72` | asserted |
| MOVE-002 | 1 | Complete imported component history derives from original update times | none | none |
| MOVE-002 | 2 | Past Sorry maintenance is completed | `tests/e2e/sorry-import.test.mjs:74` | asserted |
| MOVE-002 | 2 | Imported Better Stack maintenance has no native notice | `tests/betterstack/flow.test.mjs:57` | asserted |
| MOVE-002 | 2 | Import queues no notification delivery | `tests/betterstack/flow.test.mjs:58` | asserted |
| MOVE-002 | 3 | Sequential repeated apply and the following job read leave the mail count zero | `tests/betterstack/flow.test.mjs:116` | asserted |
| MOVE-002 | 3 | Sequential repeated applies send no mail | `tests/auth-adoption/cutover.test.mjs:60` | asserted |
| MOVE-002 | 3 | Concurrent repeated applies send no mail | none | none |
| MOVE-002 | 3 | Preview sends no mail | none | none |
| MOVE-002 | 3 | Every resume sends no mail | none | none |
| MOVE-002 | 3 | Cutover checks send no mail | none | none |
| MOVE-002 | 4 | Each imported email subscriber is pending | none | none |
| MOVE-013 | 1 | Signed-out invitation action is refused | `tests/auth-adoption/cutover.test.mjs:62` | asserted |
| MOVE-013 | 1 | Invitation contains confirmation but no past incident text | none | none |
| MOVE-013 | 2 | Concurrent and repeated batches produce exactly 57 transport messages | `tests/auth-adoption/cutover.test.mjs:67` | asserted |
| MOVE-013 | 2 | Those 57 transport messages have 57 distinct recipients | `tests/auth-adoption/cutover.test.mjs:68` | asserted |
| MOVE-013 | 2 | All 57 transport messages carry distinct idempotency identities | `tests/auth-adoption/cutover.test.mjs:69` | asserted |
| MOVE-013 | 3 | Delayed invitation retains original deadline | `tests/auth-adoption/cutover.test.mjs:145` | asserted |
| MOVE-013 | 3 | The expiry fixture sends one message | `tests/auth-adoption/cutover.test.mjs:141` | asserted |
| MOVE-013 | 3 | That message is proved to exclude the expired recipient | none | none |
| MOVE-013 | 3 | Expiry removes personal data from audit payload | `tests/auth-adoption/cutover.test.mjs:153` | asserted |
| MOVE-013 | 3 | Instatus-specific original deadline and expiry | none | none |
| MOVE-013 | 4 | Only ambiguous transport consumes a failed claim | `tests/auth-adoption/cutover.test.mjs:109` | asserted |
| MOVE-013 | 4 | Preparation failure is retryable after repair | `tests/auth-adoption/cutover.test.mjs:116` | asserted |
| MOVE-013 | 4 | Preparation repair and repeated attempts leave exactly two transport messages | `tests/auth-adoption/cutover.test.mjs:116` | asserted |
| MOVE-013 | 4 | Those two messages have two distinct recipients | `tests/auth-adoption/cutover.test.mjs:117` | asserted |
| MOVE-003 | 1 | Repeated source reports already imported | `tests/e2e/statuspage-import.test.mjs:248` | asserted |
| MOVE-003 | 1 | Repeated source preserves component count | `tests/e2e/statuspage-import.test.mjs:251` | asserted |
| MOVE-003 | 1 | Repeated source preserves component-group count | `tests/e2e/statuspage-import.test.mjs:251` | asserted |
| MOVE-003 | 1 | Repeated source preserves incident count | `tests/e2e/statuspage-import.test.mjs:251` | asserted |
| MOVE-003 | 1 | Repeated source preserves maintenance count | `tests/e2e/statuspage-import.test.mjs:251` | asserted |
| MOVE-003 | 1 | Repeated source preserves subscriber count | `tests/e2e/statuspage-import.test.mjs:251` | asserted |
| MOVE-003 | 1 | Repeated source leaves every existing record content unchanged | none | none |
| MOVE-003 | 1 | Repeated source preserves aliases | `tests/e2e/statuspage-import.test.mjs:255` | asserted |
| MOVE-003 | 1 | Repeated source has no notification deliveries | `tests/e2e/statuspage-import.test.mjs:253` | asserted |
| MOVE-003 | 1 | Repeated source creates no other notification work | none | none |
| MOVE-003 | 2 | Cross-source imports preserve global record identity | none | none |
| MOVE-004 | 1 | Untouched Sorry undo returns the component count to baseline | `tests/e2e/sorry-import.test.mjs:89` | asserted |
| MOVE-004 | 1 | Untouched Sorry undo returns the component-group count to baseline | `tests/e2e/sorry-import.test.mjs:89` | asserted |
| MOVE-004 | 1 | Untouched Sorry undo returns the incident count to baseline | `tests/e2e/sorry-import.test.mjs:89` | asserted |
| MOVE-004 | 1 | Untouched Sorry undo returns the maintenance count to baseline | `tests/e2e/sorry-import.test.mjs:89` | asserted |
| MOVE-004 | 1 | Untouched Sorry undo returns the subscriber count to baseline | `tests/e2e/sorry-import.test.mjs:89` | asserted |
| MOVE-004 | 1 | Untouched undo removes every other imported record kind | none | none |
| MOVE-004 | 2 | Edited incident survives | `tests/e2e/statuspage-import.test.mjs:279` | asserted |
| MOVE-004 | 2 | Edited maintenance survives | `tests/e2e/statuspage-import.test.mjs:280` | asserted |
| MOVE-004 | 2 | Subscriber confirmation survives undo | `tests/e2e/statuspage-import.test.mjs:294` | asserted |
| MOVE-004 | 2 | Every remaining component is in the selected dependency set or is the edited component | `tests/e2e/statuspage-import.test.mjs:299` | asserted |
| MOVE-004 | 2 | Every required dependent component survives undo | none | none |
| MOVE-004 | 2 | Remaining group count equals the number of distinct group identifiers on remaining components | `tests/e2e/statuspage-import.test.mjs:300` | asserted |
| MOVE-004 | 2 | Every required dependent group identity survives undo | none | none |
| MOVE-004 | 2 | Undo contains a retained incident disposition | `tests/e2e/statuspage-import.test.mjs:288` | asserted |
| MOVE-004 | 2 | Undo names the specific retained incident and its explanation | none | none |
| MOVE-004 | 2 | Undo contains a retained maintenance disposition | `tests/e2e/statuspage-import.test.mjs:289` | asserted |
| MOVE-004 | 2 | Undo names the specific retained maintenance and its explanation | none | none |
| MOVE-004 | 3 | Undo creates no outbound notification work | none | none |
| MOVE-005 | 1 | Public imported addresses permanently redirect to their target | `tests/e2e/statuspage-import.test.mjs:230` | asserted |
| MOVE-005 | 1 | Native record page contains imported title | `tests/e2e/statuspage-import.test.mjs:234` | asserted |
| MOVE-005 | 1 | Aliases are absent on operator host | `tests/e2e/statuspage-import.test.mjs:231` | asserted |
| MOVE-005 | 2 | Sorry notice redirects to matching incident | `tests/e2e/sorry-import.test.mjs:78` | asserted |
| MOVE-005 | 2 | Sorry listing redirects to history | `tests/e2e/sorry-import.test.mjs:83` | asserted |
| MOVE-005 | 2 | History alias disappears on undo | `tests/e2e/sorry-import.test.mjs:91` | asserted |
| MOVE-005 | 3 | Statuspage source Atom equals native feed | `tests/e2e/statuspage-import.test.mjs:238` | asserted |
| MOVE-005 | 3 | Instatus source Atom serves native feed | none | none |
| MOVE-005 | 3 | Better Stack source Atom serves native feed | none | none |
| MOVE-005 | 3 | Feed aliases exist with no incident history | none | none |
| MOVE-005 | 3 | Complete undo removes feed alias | none | none |
| MOVE-005 | 4 | Sorry history redirect carries snapshot version | `tests/e2e/sorry-import.test.mjs:84` | asserted |
| MOVE-005 | 4 | Second apply preserves alias set | `tests/e2e/statuspage-import.test.mjs:255` | asserted |
| MOVE-005 | 4 | Edited record keeps original aliases | `tests/e2e/statuspage-import.test.mjs:283` | asserted |
| MOVE-005 | 4 | Removed record aliases become unavailable | `tests/e2e/statuspage-import.test.mjs:286` | asserted |
| MOVE-005 | 4 | Aliases and feeds make no database query | none | none |
| MOVE-005 | 5 | Unsafe source addresses are refused | `tests/e2e/statuspage-import.test.mjs:121` | asserted |
| MOVE-005 | 5 | The refusal names the shortlink or public-address category | `tests/e2e/statuspage-import.test.mjs:122` | asserted |
| MOVE-005 | 5 | The refusal names the rejected address itself | none | none |
| MOVE-005 | 5 | Conflicting destinations are refused | `tests/e2e/statuspage-import.test.mjs:128` | asserted |
| MOVE-005 | 5 | Every native-route collision is named/refused | none | none |
| MOVE-005 | 5 | Retained legacy unusable aliases warn without suppressing snapshot | none | none |
| MOVE-005 | 6 | Missing shortlinks are never fabricated | none | none |
| MOVE-005 | 6 | A source-owned hostname is outside Lamp control | none | none |
| MOVE-005 | 6 | Better Stack reports get aliases only from exact unchanged matching webhook shortlinks | none | none |
| MOVE-005 | 7 | Better Stack maintenance messages retain original historical updates | none | none |
| MOVE-005 | 7 | Better Stack history creates no lifecycle notice | none | none |
| MOVE-005 | 7 | Better Stack history creates no replayed notification | none | none |
| MOVE-006 | 1 | Nonempty cutover rows have native targets | `tests/auth-adoption/cutover.test.mjs:52` | asserted |
| MOVE-006 | 1 | The large preview returns at most 25 rows | `tests/auth-adoption/cutover.test.mjs:193` | asserted |
| MOVE-006 | 1 | Its reported total exceeds the displayed row count | `tests/auth-adoption/cutover.test.mjs:193` | asserted |
| MOVE-006 | 1 | Its total equals the complete source address count | none | none |
| MOVE-006 | 1 | A nonempty large preview has an address in every row | none | none |
| MOVE-006 | 1 | A nonempty large preview has a source path in every row | none | none |
| MOVE-006 | 1 | A nonempty large preview has a native target in every row | none | none |
| MOVE-006 | 1 | Unavailable addresses are displayed | none | none |
| MOVE-006 | 1 | Source-host limits are displayed | none | none |
| MOVE-006 | 2 | Eligible imported invitation count is complete | `tests/auth-adoption/cutover.test.mjs:56` | asserted |
| MOVE-006 | 2 | Original invitation deadline is in the sent invitation | `tests/auth-adoption/cutover.test.mjs:143` | asserted |
| MOVE-006 | 2 | Each source feed answer is displayed | none | none |
| MOVE-006 | 2 | JSON reader limitation is displayed | none | none |
| MOVE-006 | 2 | RSS reader limitation is displayed | none | none |
| MOVE-006 | 2 | Widget reader limitation is displayed | none | none |
| MOVE-006 | 2 | Original expiry deadline is displayed in Cutover | none | none |
| MOVE-006 | 3 | Opens requests omit credentials | none | none |
| MOVE-006 | 3 | Opens validates final native address | none | none |
| MOVE-006 | 3 | Opens validates successful HTML | none | none |
| MOVE-006 | 3 | Unreachable checks remain visibly failed | none | none |
| MOVE-006 | 4 | Guide orders import before preview | none | none |
| MOVE-006 | 4 | Guide orders explicit invitations and hostname instructions | none | none |
| MOVE-006 | 4 | Guide includes custom-domain steps | none | none |
| MOVE-006 | 4 | Guide includes rechecking | none | none |
| MOVE-006 | 4 | Guide retains source through confirmation window | none | none |
| MOVE-009 | 1 | Statuspage summary endpoint returns nonempty content | `tests/e2e/statuspage-import.test.mjs:239` | asserted |
| MOVE-009 | 1 | Source Atom equals native feed | `tests/e2e/statuspage-import.test.mjs:238` | asserted |
| MOVE-009 | 1 | RSS response is nonempty | `tests/e2e/cutover-browser.test.mjs:104` | asserted |
| MOVE-009 | 1 | An unmodified Statuspage client parses the summary | none | none |
| MOVE-009 | 1 | An old embed tag renders the floating notice after import | none | none |
| MOVE-009 | 2 | Each reader is listed served after import | none | none |
| MOVE-009 | 2 | Webhook and automation readers are unavailable before implementation | none | none |
| MOVE-009 | 2 | Shipped automation shows old/new component addresses | none | none |
| MOVE-009 | 3 | Guide includes the correction-update note | `tests/e2e/cutover-browser.test.mjs:75` | asserted |
| MOVE-009 | 3 | Guide includes the no-channels-selected note | `tests/e2e/cutover-browser.test.mjs:75` | asserted |
| MOVE-009 | 3 | Guide includes the component-state-with-update note | `tests/e2e/cutover-browser.test.mjs:75` | asserted |
| MOVE-009 | 3 | Guide includes the degraded-only component note | `tests/e2e/cutover-browser.test.mjs:75` | asserted |
| MOVE-011 | 1 | Imported report retains original publication time | `tests/e2e/helpers/postmortem-template-import-flow.mjs:72` | asserted |
| MOVE-011 | 1 | Published report with source notify flag creates no notification of any kind | none | none |
| MOVE-011 | 2 | The fixture source text markers survive in the summary | `tests/e2e/helpers/postmortem-template-import-flow.mjs:73` | asserted |
| MOVE-011 | 2 | The ordinary source link URL survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:73` | asserted |
| MOVE-011 | 2 | The HTML source link URL survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:73` | asserted |
| MOVE-011 | 2 | The source image name and URL survive | `tests/e2e/helpers/postmortem-template-import-flow.mjs:73` | asserted |
| MOVE-011 | 2 | Every word of the complete source body survives | none | none |
| MOVE-011 | 2 | Paragraph/list item line boundaries survive | none | none |
| MOVE-011 | 2 | Heading line boundaries survive | none | none |
| MOVE-011 | 2 | Image is not embedded in public report | `tests/e2e/helpers/postmortem-template-import-flow.mjs:90` | asserted |
| MOVE-011 | 2 | Image URL is never fetched | none | none |
| MOVE-011 | 3 | The imported timeline is empty | `tests/e2e/helpers/postmortem-template-import-flow.mjs:74` | asserted |
| MOVE-011 | 3 | The imported cause is empty | `tests/e2e/helpers/postmortem-template-import-flow.mjs:74` | asserted |
| MOVE-011 | 3 | The imported remediation is empty | `tests/e2e/helpers/postmortem-template-import-flow.mjs:74` | asserted |
| MOVE-011 | 3 | Empty timeline/cause/remediation fields are omitted from rendered report | none | none |
| MOVE-011 | 3 | HIST-003 counts the imported report as published | none | none |
| MOVE-011 | 4 | Draft publication time stays empty | `tests/e2e/helpers/postmortem-template-import-flow.mjs:75` | asserted |
| MOVE-011 | 4 | Draft source text is retained privately | `tests/e2e/helpers/postmortem-template-import-flow.mjs:76` | asserted |
| MOVE-011 | 4 | Dry run counts kept-private reports | `tests/e2e/helpers/postmortem-template-import-flow.mjs:37` | asserted |
| MOVE-011 | 4 | Draft report canary absent from every public artifact | `tests/e2e/helpers/postmortem-template-import-flow.mjs:98` | asserted |
| MOVE-011 | 5 | Old incident path permanently redirects | `tests/e2e/helpers/postmortem-template-import-flow.mjs:65` | asserted |
| MOVE-011 | 5 | Script-free permalink contains published report | `tests/e2e/helpers/postmortem-template-import-flow.mjs:89` | asserted |
| MOVE-011 | 5 | Public APIs contain published report | `tests/e2e/helpers/postmortem-template-import-flow.mjs:94` | asserted |
| MOVE-011 | 6 | Dry run counts imported reports | `tests/e2e/helpers/postmortem-template-import-flow.mjs:36` | asserted |
| MOVE-011 | 6 | Dry run counts refused reports | `tests/e2e/helpers/postmortem-template-import-flow.mjs:58` | asserted |
| MOVE-011 | 6 | Dry run writes no report or other native record | none | none |
| MOVE-011 | 6 | Apply imports only reviewed reports | none | none |
| MOVE-011 | 6 | Repeated report source is already imported | `tests/e2e/helpers/postmortem-template-import-flow.mjs:102` | asserted |
| MOVE-011 | 6 | Undo removes untouched published report | `tests/e2e/helpers/postmortem-template-import-flow.mjs:132` | asserted |
| MOVE-011 | 6 | Undo preserves or removes edited/unmodified private report | `tests/e2e/helpers/postmortem-template-import-flow.mjs:133` | asserted |
| MOVE-011 | 6 | Undo records a retained incident disposition | `tests/e2e/helpers/postmortem-template-import-flow.mjs:139` | asserted |
| MOVE-011 | 6 | Undo records a retained template disposition | `tests/e2e/helpers/postmortem-template-import-flow.mjs:139` | asserted |
| MOVE-011 | 6 | Undo records a retained component disposition | `tests/e2e/helpers/postmortem-template-import-flow.mjs:139` | asserted |
| MOVE-011 | 6 | Undo names the specific retained edited incident | none | none |
| MOVE-011 | 6 | Undo names the specific retained edited template | none | none |
| MOVE-011 | 6 | Undo names the specific retained edited component | none | none |
| MOVE-014 | 1 | Template source folder survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:80` | asserted |
| MOVE-014 | 1 | Template title survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:81` | asserted |
| MOVE-014 | 1 | Template channel default survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:82` | asserted |
| MOVE-014 | 1 | Template component state survives | `tests/e2e/helpers/postmortem-template-import-flow.mjs:84` | asserted |
| MOVE-014 | 1 | Every source lifecycle survives | none | none |
| MOVE-014 | 1 | Three templates with the fixture name prefix exist | `tests/e2e/helpers/postmortem-template-import-flow.mjs:78` | asserted |
| MOVE-014 | 1 | All three original template names and source identities are preserved | none | none |
| MOVE-014 | 2 | Impact contains first source paragraph | `tests/e2e/helpers/postmortem-template-import-flow.mjs:85` | asserted |
| MOVE-014 | 2 | Remaining oversized details retain complete wording | `tests/e2e/helpers/postmortem-template-import-flow.mjs:116` | asserted |
| MOVE-014 | 2 | Affected audience is derived from all selected component names | none | none |
| MOVE-014 | 3 | Dry run names oversized template and field | `tests/e2e/helpers/postmortem-template-import-flow.mjs:50` | asserted |
| MOVE-014 | 3 | Oversized text is retained in full | `tests/e2e/helpers/postmortem-template-import-flow.mjs:116` | asserted |
| MOVE-014 | 3 | Field is marked for shortening | `tests/e2e/helpers/postmortem-template-import-flow.mjs:117` | asserted |
| MOVE-014 | 3 | Oversized template cannot apply | `tests/e2e/helpers/postmortem-template-import-flow.mjs:119` | asserted |
| MOVE-014 | 4 | Dry run reports three source templates read | `tests/e2e/helpers/postmortem-template-import-flow.mjs:39` | asserted |
| MOVE-014 | 4 | Dry run reports three templates imported or changed | `tests/e2e/helpers/postmortem-template-import-flow.mjs:40` | asserted |
| MOVE-014 | 4 | The template count is unchanged by dry run | `tests/e2e/helpers/postmortem-template-import-flow.mjs:51` | asserted |
| MOVE-014 | 4 | Every existing template content is unchanged by dry run | none | none |
| MOVE-014 | 4 | Application imports exactly the reviewed template plan | none | none |
| MOVE-014 | 5 | Composer receives template impact | `tests/e2e/helpers/postmortem-template-import-flow.mjs:109` | asserted |
| MOVE-014 | 5 | Composer receives template details | `tests/e2e/helpers/postmortem-template-import-flow.mjs:110` | asserted |
| MOVE-014 | 5 | Component state changes stay staged | `tests/e2e/helpers/imported-template-apply-flow.mjs:63` | asserted |
| MOVE-014 | 5 | Application leaves publication count unchanged | `tests/e2e/helpers/postmortem-template-import-flow.mjs:113` | asserted |
| MOVE-014 | 6 | Repeat retains exactly three imported templates | `tests/e2e/helpers/postmortem-template-import-flow.mjs:105` | asserted |
| MOVE-014 | 6 | Undo removes unchanged templates | `tests/e2e/helpers/postmortem-template-import-flow.mjs:131` | asserted |
| MOVE-014 | 6 | Edited template survives undo | `tests/e2e/helpers/postmortem-template-import-flow.mjs:136` | asserted |
| MOVE-014 | 6 | The retained template has a nonempty complete original component set after undo | none | none |
| MOVE-014 | 6 | Undo dispositions name template retention | `tests/e2e/helpers/postmortem-template-import-flow.mjs:139` | asserted |
| AGENT-002 | 1 | Ten-minute preparation trigger creates a draft before any later tick | `tests/e2e/update-reminders.test.mjs:207` | asserted |
| AGENT-002 | 1 | Draft restates last public impact | `tests/e2e/update-reminders.test.mjs:100` | asserted |
| AGENT-002 | 1 | Draft names changed evidence refs | `tests/e2e/incident-brief.test.mjs:198` | asserted |
| AGENT-002 | 1 | No-change draft states nothing changed | `tests/e2e/update-reminders.test.mjs:102` | asserted |
| AGENT-002 | 2 | One owner reminder is produced | `tests/e2e/update-reminders.test.mjs:95` | asserted |
| AGENT-002 | 2 | Reminder links to the prepared composer | `tests/e2e/update-reminders.test.mjs:107` | asserted |
| AGENT-002 | 2 | Unowned reminder reaches every active operator once | `tests/e2e/update-reminders.test.mjs:141` | asserted |
| AGENT-002 | 3 | Repeat retains one exact prepared draft | `tests/e2e/update-reminders.test.mjs:105` | asserted |
| AGENT-002 | 3 | An existing operator draft is unchanged | `tests/e2e/update-reminders.test.mjs:195` | asserted |
| AGENT-002 | 4 | Prepared by Lamp is stored | `tests/e2e/helpers/prepared-draft-flow.mjs:10` | asserted |
| AGENT-002 | 4 | A nonempty prepared evidence set is rendered completely in the private composer | none | none |
| AGENT-002 | 4 | Citation links resolve to their brief sources | `tests/e2e/helpers/prepared-draft-flow.mjs:37` | asserted |
| AGENT-002 | 5 | Original commitment time is unchanged | `tests/e2e/incident-brief.test.mjs:196` | asserted |
| AGENT-002 | 5 | Preparation publishes no update | `tests/e2e/incident-brief.test.mjs:209` | asserted |
| AGENT-002 | 5 | Preparation preserves the public page bytes | `tests/e2e/incident-brief.test.mjs:210` | asserted |
| AGENT-002 | 5 | Preparation preserves the Atom feed bytes | `tests/e2e/incident-brief.test.mjs:210` | asserted |
| AGENT-002 | 5 | Preparation preserves the public status API bytes | `tests/e2e/incident-brief.test.mjs:210` | asserted |
| AGENT-002 | 5 | Preparation preserves the widget bytes | `tests/e2e/incident-brief.test.mjs:210` | asserted |
| AGENT-002 | 5 | Preparation preserves other published surface bytes | none | none |
| AGENT-002 | 5 | Preparation queues no subscriber event | `tests/e2e/incident-brief.test.mjs:208` | asserted |
| AGENT-002 | 5 | Preparation makes no model request | `tests/e2e/incident-brief.test.mjs:207` | asserted |
| AGENT-002 | 5 | Company policy computes and permits the standard preparation call | none | none |
| AGENT-002 | 6 | Unpublished prepared draft leaves incident overdue | `tests/e2e/update-reminders.test.mjs:213` | asserted |
| AGENT-002 | 6 | Original public commitment remains | `tests/e2e/update-reminders.test.mjs:221` | asserted |
| AGENT-004 | 1 | The recovery response contains the linked firing item | `tests/e2e/helpers/recovery-check-flow.mjs:25` | asserted |
| AGENT-004 | 1 | That item names its source record. | `tests/e2e/helpers/recovery-check-flow.mjs:25` | asserted |
| AGENT-004 | 1 | That item carries a parseable evidence time | `tests/e2e/helpers/recovery-check-flow.mjs:25` | asserted |
| AGENT-004 | 1 | Unreasoned resolution is refused | `tests/e2e/helpers/recovery-check-flow.mjs:29` | asserted |
| AGENT-004 | 1 | Refusal leaves publication count unchanged | `tests/e2e/helpers/recovery-check-flow.mjs:30` | asserted |
| AGENT-004 | 1 | Held company policy decides the resolution class | none | none |
| AGENT-004 | 2 | The overridden incident is Resolved | `tests/e2e/helpers/recovery-check-flow.mjs:45` | asserted |
| AGENT-004 | 2 | An internal note contains the override reason | `tests/e2e/helpers/recovery-check-flow.mjs:45` | asserted |
| AGENT-004 | 2 | An audit row contains the override reason | `tests/e2e/helpers/recovery-check-flow.mjs:47` | asserted |
| AGENT-004 | 2 | That audit row has an actor identifier | `tests/e2e/helpers/recovery-check-flow.mjs:47` | asserted |
| AGENT-004 | 2 | The audit actor equals the operator who published the override | none | none |
| AGENT-004 | 2 | Override reason is absent publicly | `tests/e2e/helpers/recovery-check-flow.mjs:49` | asserted |
| AGENT-004 | 3 | Five-minute recovery threshold is applied at its boundary | none | none |
| AGENT-004 | 3 | Reported recovery initially remains held | `tests/e2e/helpers/recovery-check-flow.mjs:59` | asserted |
| AGENT-004 | 3 | Old enough recovery passes | `tests/e2e/helpers/recovery-check-flow.mjs:65` | asserted |
| AGENT-004 | 3 | Repeated grouped recovery restarts the hold | none | none |
| AGENT-004 | 3 | All linked alert keys participate | none | none |
| AGENT-004 | 4 | Later re-fire invalidates recovery | `tests/e2e/helpers/recovery-check-flow.mjs:67` | asserted |
| AGENT-004 | 4 | One firing grouped member prevents pass | `tests/e2e/helpers/recovery-check-flow.mjs:79` | asserted |
| AGENT-004 | 5 | Scheduled failing resolution leaves old lifecycle | `tests/e2e/helpers/recovery-check-flow.mjs:86` | asserted |
| AGENT-004 | 5 | Scheduled failure leaves one prior published update | `tests/e2e/helpers/recovery-check-flow.mjs:87` | asserted |
| AGENT-004 | 5 | Some draft still exists after scheduled failure | `tests/e2e/helpers/recovery-check-flow.mjs:87` | asserted |
| AGENT-004 | 5 | The same failing draft identity and wording are retained | none | none |
| AGENT-004 | 5 | Historical resolution follows the same recovery check | none | none |
| AGENT-004 | 5 | An override cannot authorize a later scheduled resolution | none | none |
| AGENT-004 | 6 | A nonempty absent-evidence list is exposed | `tests/e2e/helpers/recovery-check-flow.mjs:26` | asserted |
| AGENT-004 | 6 | Missing vendor evidence is specifically not tracked | none | none |
| AGENT-004 | 6 | Missing traffic evidence is specifically not tracked | none | none |
| AGENT-004 | 6 | Missing support evidence is specifically not tracked | none | none |
| AGENT-004 | 6 | Missing continuous-monitor evidence is specifically not tracked | none | none |
| AGENT-005 | 1 | The timeline represents every available alert reference | `tests/e2e/publishing-contract.test.mjs:1162` | asserted |
| AGENT-005 | 1 | The timeline represents every available published-update reference | `tests/e2e/publishing-contract.test.mjs:1162` | asserted |
| AGENT-005 | 1 | The timeline line count equals the total available source count | `tests/e2e/publishing-contract.test.mjs:1163` | asserted |
| AGENT-005 | 1 | Every timeline line cites a real source record | `tests/e2e/publishing-contract.test.mjs:1159` | asserted |
| AGENT-005 | 1 | Every generated timeline line, including source newlines, has a valid source citation | `tests/e2e/publishing-contract.test.mjs:1159` | asserted |
| AGENT-005 | 1 | Internal-note canary is excluded | `tests/e2e/publishing-contract.test.mjs:1166` | asserted |
| AGENT-005 | 2 | Report summary has incident opening instant | `tests/e2e/publishing-contract.test.mjs:1164` | asserted |
| AGENT-005 | 2 | Report summary has published resolution instant | `tests/e2e/publishing-contract.test.mjs:1165` | asserted |
| AGENT-005 | 2 | Report explicitly labels recorded rather than measured downtime | none | none |
| AGENT-005 | 3 | Generated cause starts empty | `tests/e2e/publishing-contract.test.mjs:1153` | asserted |
| AGENT-005 | 3 | Generated remediation starts empty | `tests/e2e/publishing-contract.test.mjs:1153` | asserted |
| AGENT-005 | 3 | Cause is marked required | `tests/e2e/publishing-contract.test.mjs:1154` | asserted |
| AGENT-005 | 3 | Remediation is marked required | `tests/e2e/publishing-contract.test.mjs:1154` | asserted |
| AGENT-005 | 3 | Cause carries a prompt | `tests/e2e/publishing-contract.test.mjs:1155` | asserted |
| AGENT-005 | 3 | Remediation carries a prompt | `tests/e2e/publishing-contract.test.mjs:1155` | asserted |
| AGENT-005 | 3 | Review evidence includes every available source reference | `tests/e2e/publishing-contract.test.mjs:1156` | asserted |
| AGENT-005 | 3 | Review evidence contains no unrelated source reference | `tests/e2e/publishing-contract.test.mjs:1156` | asserted |
| AGENT-005 | 4 | An empty cause with completed remediation refuses publication | none | none |
| AGENT-005 | 4 | An untouched cause prompt with completed remediation refuses publication | none | none |
| AGENT-005 | 4 | An untouched remediation prompt with completed cause refuses publication | none | none |
| AGENT-005 | 4 | Untouched prompts refuse publication | `tests/e2e/publishing-contract.test.mjs:1175` | asserted |
| AGENT-005 | 4 | Empty remediation refuses publication | `tests/e2e/publishing-contract.test.mjs:1179` | asserted |
| AGENT-005 | 4 | Held policy decides report publication class | none | none |
| AGENT-005 | 5 | Redrafting preserves operator summary | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| AGENT-005 | 5 | Redrafting preserves operator timeline | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| AGENT-005 | 5 | Redrafting preserves operator cause | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| AGENT-005 | 5 | Redrafting preserves operator remediation | `tests/e2e/publishing-contract.test.mjs:1183` | asserted |
| AGENT-005 | 5 | Draft summary canary is absent from public surfaces | `tests/e2e/publishing-contract.test.mjs:1170` | asserted |
| AGENT-005 | 6 | A published report edit returns its refusal | `tests/e2e/publishing-contract.test.mjs:1189` | asserted |
| AGENT-005 | 6 | The complete persisted report state is unchanged after the refused edit | none | none |
| AGENT-005 | 6 | Public incident page has published cause | `tests/e2e/publishing-contract.test.mjs:1193` | asserted |
| PAGE-013 | 3 | The public page writes no visitor data to browser storage | none | none |
