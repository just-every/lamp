# Set up AI draft assistance

AI is optional. Lamp works without it. **Settings → AI assistance** shows these
same steps for your installation, with the lines to copy, and saves tone
instructions; it never stores an API key. AI suggestions need an outbound
connection to your provider, which Managed hosting does not offer yet; on
Managed the card says so. They work on Free and Assisted installations.

## Connect a provider

1. In your chosen AI provider account, create an API key and choose a model with
   access to its OpenAI-compatible Chat Completions API. The model must support
   `response_format: {"type":"json_object"}`. Provider usage is billed by that
   provider, separately from RER's management service.
2. Find the provider's full HTTPS Chat Completions endpoint and exact model ID in
   its API documentation. Lamp sends a POST to that URL unchanged; a dashboard
   URL or just an API base URL is insufficient. For example, an endpoint may end
   in `/v1/chat/completions`.
3. Add all three values to your existing [private deployment input file](deploy.md#step-1-make-a-private-input-file).
   This is an example of file contents; replace each value with the provider's
   actual value. Keep the API key private:

```text
AI_PROVIDER_URL=https://ai.example.com/v1/chat/completions
AI_PROVIDER_MODEL=your-provider-model-id
AI_PROVIDER_API_KEY=your-private-provider-key
```

4. Stop any local development or preview server before deploying. From the
   deploying checkout, validate then deploy with the same environment and file:

```sh
rer deploy --dry-run --environment production --env-file "$HOME/.config/lamp/production.env"
rer deploy --environment production --env-file "$HOME/.config/lamp/production.env"
```

For an installation operated through RER, have its deployment administrator add
these runtime values through the installation's configuration and redeploy.
Saving tone instructions alone cannot change runtime configuration. For local
use, stop `rer dev`, add the three values to the checkout's private `.dev.vars`
file, and restart `rer dev`. Do not commit that file. Demos suppress provider
calls; use an ordinary local or hosted installation to check the real connection.

## Check the connection

Reload **Settings**. When the card says **Provider configured**, choose **Test
the provider**. Lamp sends the provider one made-up incident (no data from your
installation) and shows the text it suggests. Success: the card says
**Working** with that text. Otherwise it shows the provider's error; check the
full endpoint, model name, key and provider account quota. Then, in a real
incident, review its brief and request a suggested update in the composer.
Manual writing always stays available.

Only requesting a suggestion sends the incident brief to the provider: accepted
alerts, published updates, visible attached components and their claimed states,
and saved tone instructions. Internal notes and internal components are not
sent. Review and edit the suggestion before publishing; requesting it never
publishes an update or chooses its lifecycle or next-update time.

Configure all three values together or omit all three. To disconnect, remove
all three and redeploy (or restart local development). An edition using a custom
`ai.provider.v1` adapter must use that adapter's configuration instead; Lamp
refuses to combine it with these values.
