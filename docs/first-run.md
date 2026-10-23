# First run and sign-in

After installing Lamp, open the local owner entry address from `rer dev` or the
operator hostname of your deployment. On a new installation, `/setup` asks for
your website. Lamp reads that page once and fills in the page name, tagline,
mark, accent color and first components from it, with the time zone from your
browser. Check the card, change anything, and open Lamp. If Lamp cannot read the
site, or you skip it, the page starts with plain defaults.

If your site links to a status page you run on Statuspage, Instatus or Better
Stack, or one that names your site answers at `status.<your domain>`, the card takes that page's own
components and groups from its public feeds instead of guessing them from your
site's menus, and says where they came from. Edit them as one list per group.
**Bring its incident history too**, off unless you choose it, imports the page's
past incidents with their updates and times as resolved history through
[Move in](moving-in.md#from-setup-without-a-key). No one is notified. Subscribers
need the page's API key; move them in later from Settings → Move in.

Lamp reads only public addresses, follows at most five redirects, and runs
nothing from the site. Settings → Page can read the site again later.

## Nothing else to set up

Every change republishes your public page. Lamp checks the page and its
subscribe form after each publish and every minute, and a hosted sender with
your mail provider when it changes and daily. Overview shows one line: where the
page is live, when it was published and checked. It turns amber with the fix
when a check fails. **Review page** opens Your page; your deployment address is
the public address unless you add a custom domain.

A verified sender does not mean a message reached an inbox. Local mail is
silently suppressed.

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
