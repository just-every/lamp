# Visual fixtures

The PNG files in this directory are local reference captures for the public status page and operator surfaces. They are not deployment evidence or a tagged-release claim.

They were curated from accepted local owner-preview browser captures with API-created records. The browser, source-review, frozen clean-clone, deployment, and provider evidence remain external records.

The public status page captures (`01`, `02`, `12`, `13`) were re-rendered on 12 October 2026 after the owner replaced the cartographic design (DIVERGENCE.md, "Public status page restyle"). They come from the real snapshot renderer and public routes with fixture snapshot data for a sample business, captured in Chromium; the other captures remain the earlier owner-preview captures.

The public page leads with the overall status on a white plate (tinted only when something is wrong), then grouped component plates with full-width daily availability records, then current incidents and planned maintenance, then recently resolved incidents and the subscription form. All visible incident and maintenance text comes from snapshot data; the public record uses the shared incident-field renderer used by notification surfaces.

The public page is rendered into versioned R2 artifacts. Its stylesheet, script and favicon (which visibly composites the configured logo and current status mark) stay on the deployment origin. Inter is embedded in the stylesheet, so no font request leaves the page; the page background is warm paper lit by CSS gradients, with no image request. The business's name, logo and accent colour are its own; the accent marks only the subscribe action.

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
