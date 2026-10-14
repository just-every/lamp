# First run and sign-in

After installing Lamp, open the local owner entry address from `rer dev` or the
operator hostname of your deployment. On a new installation, confirm the page
name, tagline, time zone and accent colour at `/setup`.

## Complete the checklist

Overview tracks these steps from saved installation state:

1. Replace sample page name and branding.
2. Choose the configured time zone.
3. Check the email sender.
4. Add the first component.
5. Publish the first incident update.
6. Open the public page through its check.
7. Check that the subscription form is reachable.
8. Select the public address; custom-domain documentation is available from that step.

Sender authentication and local outbox capture are separate checks. A successful
local capture does not mean a message reached an inbox. Selecting a public
address records your choice; it does not validate DNS. Lamp also supports the
default deployment address.

## Sign in

Operators use email sign-in links. Locally, the development server opens a
private owner entry address; email-sign-in messages are captured in the local
outbox. For a deployed installation, request a link from the sign-in page and
open it from the same host.

If an owner has database access but cannot use email, the technical
[operator-authentication reference](../OPERATIONS.md#shared-operator-authentication)
covers issuing a one-use sign-in link from the terminal. Optional OpenID Connect
through Auth, Google, Microsoft or Okta can be linked and enabled by an owner;
email links remain available. SCIM and role synchronization are not supported.
