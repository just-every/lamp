# First run and sign-in

After installing Lamp, open the local owner entry address from `rer dev` or the
operator hostname of your deployment. On a new installation, confirm the page
name, tagline, time zone and accent color at `/setup`.

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

A successful sender check does not mean a message reached an inbox. Local mail
is silently suppressed. Selecting a public
address records your choice; it does not validate DNS. Lamp also supports the
default deployment address.

## Sign in

Operators use email sign-in links. Locally, the development server opens a
private one-click owner entry address. For a deployed installation, request a link from the sign-in page and
open it from the same host.

The hosted owner can also use `rer signin` from the deploying checkout with the
original Cloudflare credentials and environment. It prints a single-use link
without sending email; follow [terminal entry](operators-and-sign-in.md#terminal-entry-for-the-hosted-owner).
Optional OpenID Connect
through Auth, Google, Microsoft or Okta can be linked and enabled by an owner;
email links remain available. SCIM and role synchronization are not supported.
