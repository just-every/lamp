# Lamp's own status installation

The `Deploy Lamp status` workflow deploys this edition with its pinned `rer`
into the RunEditRun Cloudflare account, using only the `lamp-status` GitHub
environment. The public host is `status.run-lamp.com`; the operator host is
`status-app.run-lamp.com`. The native environment is `lamp-status`, so its
resources start with `lamp-lamp-status`. It does not alter the existing
JustEvery installation, marketing site or demo.

Run after the workflow reaches main:

```sh
gh workflow run deploy-status.yml --repo just-every/run-lamp --ref main
```

Before the new workflow is registered on main, the existing release workflow
can dispatch the same status deployment on a branch:

```sh
gh workflow run deploy.yml --repo just-every/run-lamp --ref uip/status -f lamp_status=true
```

The environment must contain `CLOUDFLARE_API_TOKEN`, `MAIL_PROVIDER_API_KEY`,
`SETUP_TOKEN`, `SESSION_SECRET`, `SUBSCRIBER_TOKEN_SECRET` and
`WEBHOOK_SIGNING_SECRET` and `LAMP_STATUS_MONITOR_TOKEN`. Generate these values once with a
cryptographically secure generator and send their values to `gh secret set
--env lamp-status` on stdin. Never print them or rotate them on redeployment.
Set environment variables `CLOUDFLARE_ACCOUNT_ID`, `SETUP_OPERATOR_EMAIL` and
`MAIL_FROM_ADDRESS` privately in `lamp-status`. The Cloudflare permissions and
mail setup are documented in [Deploy](deploy.md).
Mail uses SendGrid's authenticated `mail.runeditrun.com` domain. The workflow
reads its actual DKIM selector using Sender Authentication Read access;
managed mail is off. No production operator address was discoverable
from the other seeds' deployment documentation, so this installation uses the
brief's default address for its operator and sender. Their values stay in the
GitHub environment.

Each run restores the latest `lamp-status-state` artifact before deploying and
retains updated ownership records even on failure. These records allow rer to
reuse only resources belonging to this installation. Download and keep a
private backup of the artifact before its 90-day retention expires. To resume
after expiry, stop and recover that backup's `.rer/deploy` and
`.seed/deployment` records through GitHub Actions before deploying. Never
delete ownership records to bypass a refusal or adopt another installation's
resources. Secret values remain in the GitHub environment, outside the artifact.

The same workflow deploys `lamp-status-checks` at `status-checks.run-lamp.com`.
Its Cloudflare cron makes real HTTP GET requests every five minutes to the
site, docs and demo start page. HTTP 200 on the expected origin is operational;
other responses, unexpected external redirects and timeouts are outages.
Each component's public note carries the actual check time, HTTP result and
duration. These are availability checks of the named URLs, not full user journeys.

No persistent RunEditRun Uptime deployment was discoverable. Its hosted demo
is ephemeral and simulates outbound webhooks. Lamp's current
[Uptime connection](alerts-from-monitoring-tools.md#uptime) creates private
drafts requiring operator publication. The standalone HTTP checker therefore
uses the native operator authentication module's owner-terminal issuance and
Lamp's released operator APIs; it makes no Lamp app changes. It confirms and
signs out each session. Neither links nor session cookies are printed or stored.
The monitor has a D1 binding for native authentication, the installation's
`SESSION_SECRET`, and its own private invocation token. It sends no sign-in mail.

The three dedicated components belong to this check source. Do not place human
standing claims on them: each check replaces that claim slot. Published incident
and maintenance claims still participate in Lamp's ordinary severity rules.
New components stay internal until their first real observation is recorded.
The first deploy also runs a private throwaway component through a successful
request, a deliberately absent path returning 404, and recovery; it deletes the
component afterward. The `lamp-status-results` artifact retains the accepted
states, timestamps and proof. Scheduled checks continue on Cloudflare before
the workflow is landed on main. A stale last-check note means monitoring needs
attention; the snapshot timestamp alone is not evidence of a recent check.
