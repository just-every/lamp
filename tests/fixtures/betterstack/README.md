# Synthetic Better Stack saved responses

Every record is fictional, generated from the official v2 response contracts. These are **synthetic-only** test inputs, never account exports. `generate.mjs` regenerates the families without network access.

| Family | Groups | Displayed resources | Incidents | Maintenance | Updates | Email rows | Confirmed / skipped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 2 | 4 | 2 | 1 | 7 | 4 | 3 / 1 |
| large | 4 | 12 | 36 | 3 | 81 | 160 | 159 / 1 |

The large family splits reports across 3 pages and subscribers across 4 pages; all maintenance update lists span 2 pages. The null confirmation is defensive synthetic input, not a documented nullable provider example. Resources use displayed outer IDs distinct from their underlying monitor IDs. Notification flags are historical provenance. Separate webhook files follow the documented incident/maintenance payloads and supply exact shortlinks; no REST fields or `/incident/<REST ID>` addresses were invented.

Sources: [page](https://betterstack.com/docs/uptime/api/status-pages-api-response-params/), [sections](https://betterstack.com/docs/uptime/api/status-pages-sections-api-response-params/), [resources](https://betterstack.com/docs/uptime/api/status-page-resources-api-response-params/), [reports](https://betterstack.com/docs/uptime/api/status-page-reports-api-response-params/), [updates](https://betterstack.com/docs/uptime/api/status-page-report-updates-api-response-params/), [subscribers](https://betterstack.com/docs/uptime/api/status-pages-subscribers-api-response-params/), [pagination](https://betterstack.com/docs/uptime/api/pagination/), [webhooks](https://betterstack.com/docs/uptime/status-pages/subscribing-to-status-updates/subscribing-with-webhooks/).
