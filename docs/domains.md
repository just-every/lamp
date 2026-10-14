# Hostnames and your own domain

Lamp serves the public status page and operator app on two different hostnames.
The app host contains the landing page, sign-in and operator workspace; the
page host serves the public page and its feed and widget.

## Use a custom domain

The zones for both hostnames must be active in the Cloudflare account used for
setup. You can use one zone or separate zones. If another provider currently
hosts DNS, review and import its existing records into Cloudflare, then point
the registrar's nameservers to the nameservers assigned by Cloudflare and wait
for the zone to become active. The registrar can remain elsewhere; DNS authority
must be Cloudflare.

Set `LAMP_PAGE_HOST` and `LAMP_APP_HOST` in the private deployment inputs, using
distinct names, then follow [Deploy Lamp](deploy.md). Cloudflare provisions the
Worker custom domains and TLS certificates. After deployment, open the public
page and check `/health` on the app host.

For `workers.dev` hostnames, see the [deployment
reference](deployment-reference.md). The public page and operator hostnames
must follow that deployment's generated naming pattern.
