# Visual fixtures

The PNG files in this directory are local reference captures for the public status page and operator surfaces. They are not deployment evidence or a tagged-release claim.

They were curated from accepted local owner-preview browser captures with API-created records. The browser, source-review, frozen clean-clone, deployment, and provider evidence remain external records.

The refined public snapshot uses a roomy cartographic masthead, a compact overall-status card and utility navigation, full-width per-component daily availability records, and a long chronological record beneath availability. Current incidents, scheduled maintenance, and resolved incidents appear once in the timeline; the subscription form sits beside it on desktop and stacks below it on narrower viewports. All visible incident and maintenance text comes from snapshot data; the public timeline uses the shared incident-field renderer used by notification surfaces.

The public page is rendered into versioned R2 artifacts. Its stylesheet, script, favicon (which visibly composites the configured logo and current status mark), and cleaned cartographic artwork stay on the deployment origin. Open Sans is bundled into the stylesheet, so no third-party font request is made. The map remains outside the initial HTML, leaving the document budget for real data markup.

The selected B conversion from the external 12ui roomy-v2 evidence informed the page structure and spacing. Owner overrides retain Open Sans, the cleaned original map, the configured favicon/logo, and real uptime/timeline data. Generated chart raster, generic logo/status artwork, and sample content were reference-only and are not shipped.

| File | Captured route and viewport |
| --- | --- |
| `01-public-status-active-desktop.png` | `/` at 1440px |
| `02-public-status-active-mobile.png` | `/` at 390px |
| `03-signin-unconfigured.png` | `/signin` at 1440px |
| `04-overview-active.png` | `/app` at 1440px |
| `05-incident-composer-draft.png` | `/app/incidents/:id` at 1440px |
| `06-components-standing-claim.png` | `/app/components` at 1440px |
| `07-maintenance.png` | `/app/maintenance` at 1440px |
| `08-subscribers.png` | `/app/subscribers` at 1440px |
| `09-deliveries.png` | `/app/deliveries` at 1440px |
| `10-page-settings.png` | `/app/settings` at 1440px |
| `11-overview-mobile.png` | `/app` at 390px |
| `12-public-history-desktop.png` | `/history` at 1440px |
| `13-public-incident-desktop.png` | `/incidents/:reference` at 1440px |
| `14-operator-alerts.png` | `/app/alerts` at 1440px |

Record exact candidate verification, source publication, deployment and live
provider checks separately. These local UI references do not establish them.
