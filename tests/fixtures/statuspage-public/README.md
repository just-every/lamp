# Public Statuspage compatibility fixtures

Captured without credentials on 17 October 2026 from `https://status.atlassian.com/api/v2/<path>.json`; filenames replace path slashes with hyphens. The source documents its response fields at https://status.atlassian.com/api.

`se-v2.js` is the unmodified public Statuspage JavaScript client from https://cdn.statuspage.io/se-v2.js, downloaded the same day. Tests use its documented `test: true` option to make same-origin requests to the local Lamp public host.
