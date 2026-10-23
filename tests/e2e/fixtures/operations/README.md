# Recorded-form outgoing Webhook action fixtures

Synthetic bodies transcribed from Atlassian's documented outgoing Webhook action
forms, not account-captured deliveries. IDs are synthetic-lamp-N. No credential is
from a provider account.

- JSM: https://support.atlassian.com/jira-service-management-cloud/docs/alert-action-data-for-jira-edge-connector/
- Opsgenie: https://support.atlassian.com/opsgenie/docs/opsgenie-edge-connector-alert-action-data/
- Webhook custom headers: https://support.atlassian.com/jira-service-management-cloud/docs/integrate-with-webhook/
- JSM note and close: https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-alerts/
- JSM Basic auth: https://developer.atlassian.com/cloud/jira/service-desk-ops/security/basic-auth-for-rest-apis/
- Tenant discovery: https://developer.atlassian.com/platform/teamwork-graph/understanding-aris/
- Opsgenie note/close: https://docs.opsgenie.com/docs/alert-api

Create carries alert.alertId, message, tags, entity and recipients. Acknowledge and
Close carry the same alert identity. AddNote carries alert.note. Escalate is sparse:
alert.alertId and escalationNotify (name, entity, type); escalationTime is not treated
as an absolute timestamp. Briefs explicitly label receipt time and identify the
provided responder or escalation target; provider roles and JSM affected-service
payload fields are not invented. These remain INTAKE-014 gaps.
