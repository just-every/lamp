import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withDeploymentSecrets(config, action) {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-deploy-secrets-'));
  const file = join(directory, 'secrets.json');
  try {
    await writeFile(file, JSON.stringify({
      // Wrangler preserves omitted secrets. Empty known optional bindings
      // explicitly disable removed integrations without touching owner secrets.
      RER_MAIL_RELAY_SECRET: config.relaySecret ?? "",
      MAIL_PROVIDER_API_KEY: config.mailProviderApiKey,
      SESSION_SECRET: config.sessionSecret,
      SETUP_TOKEN: config.setupToken,
      AUTH_PROVIDERS:config.authProviders??"",
      OIDC_TRANSACTION_SECRET:config.oidcTransactionSecret??"",
      SUBSCRIBER_TOKEN_SECRET: config.subscriberTokenSecret,
      WEBHOOK_SIGNING_SECRET: config.webhookSigningSecret,
      RESEND_WEBHOOK_SECRET: config.resendWebhookSecret ?? "",
      AI_PROVIDER_API_KEY: config.aiProviderApiKey ?? "",
    }), { mode: 0o600 });
    return await action(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
