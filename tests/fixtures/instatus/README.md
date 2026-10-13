# Instatus saved-response fixtures

These are synthetic-only management REST responses shaped from Instatus's official API help and OpenAPI 2.0.0, reviewed on 13 October 2026. No customer export or authenticated provider request has been used. They remain synthetic-only until a real owner export is checked.

The small family has one visual group, two components, two resolved incidents with three updates each, one completed maintenance with three updates and affected-component detail, and six subscribers. One subscriber is an eligible email subscriber; the other five demonstrate unconfirmed, unapproved, phone, webhook and Slack refusals. The large family has forty incidents spanning more than three years and 205 subscribers in complete pages of 100, 100 and 5; 200 are eligible. Eligible subscribers alternate all-components and a single known component preference. IDs are deliberately ordinary and may recur in other source namespaces.

Each `instatus-<resource>.json` is page 1; following pages use `-2`, `-3`, etc. Collections use `per_page=100` and end with a short or empty page. Maintenance detail files use `instatus-maintenance-<id>.json`. Optional `instatus-summary.json` supplies exact legacy links joined by source record ID. The owner's separate public/unrestricted acknowledgement is not provider data and is intentionally absent from these files.

Sources: https://instatus.com/help/api; https://github.com/instatushq/openapi; https://instatus.com/help/api/maintenances; https://instatus.com/help/api/subscribers. The v2 help endpoints and v1 OpenAPI response schema discrepancy is retained in the reader documentation rather than claimed to have been tested against a deployed account.
