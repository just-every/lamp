import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The secrets behind links and sessions already out in the world: operator
// sessions, subscriber Manage/Unsubscribe and RFC 8058 one-click links, webhook
// signatures, and identity-provider sign-ins in progress. A deploy may carry a
// different value than the Worker holds (rer generates absent ones, and a file can
// change), so a Worker that already holds one keeps it: the value reaches only a
// Worker without it (a first deploy, or a restore into a new installation).
// LAMP_REPLACE_SECRETS=NAME[,NAME], or `rer deploy --rotate-secret NAME`, replaces
// one on purpose.
export const signingSecrets = ['SESSION_SECRET', 'SUBSCRIBER_TOKEN_SECRET', 'WEBHOOK_SIGNING_SECRET', 'OIDC_TRANSACTION_SECRET'];

export function replacedSecrets(env = process.env) {
  const names = [env.LAMP_REPLACE_SECRETS, env.RER_ROTATE_SECRETS].join(',').split(',').map(name => name.trim()).filter(Boolean);
  const unknown = names.filter(name => !signingSecrets.includes(name));
  if (unknown.length) throw new Error(`LAMP_REPLACE_SECRETS names ${unknown.join(', ')}; it takes only ${signingSecrets.join(', ')}.`);
  return names;
}

/** The signing secrets this upload leaves as they are on a Worker that holds them. */
export function keptSecrets(held, replace = []) {
  return signingSecrets.filter(name => held.includes(name) && !replace.includes(name));
}

export async function withDeploymentSecrets(config, kept, action) {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-deploy-secrets-'));
  const file = join(directory, 'secrets.json');
  const values = {
    // Wrangler preserves omitted secrets. Empty known optional bindings
    // explicitly disable removed integrations without touching owner secrets.
    RER_MAIL_RELAY_SECRET: config.relaySecret ?? "",
    MAIL_PROVIDER_API_KEY: config.mailProviderApiKey ?? "",
    MAIL_API_KEY: config.mailApiKey ?? "",
    SESSION_SECRET: config.sessionSecret,
    SETUP_TOKEN: config.setupToken,
    AUTH_PROVIDERS:config.authProviders??"",
    // Absent, it is left out rather than blanked: Wrangler keeps what the Worker holds.
    ...(config.oidcTransactionSecret ? { OIDC_TRANSACTION_SECRET: config.oidcTransactionSecret } : {}),
    SUBSCRIBER_TOKEN_SECRET: config.subscriberTokenSecret,
    WEBHOOK_SIGNING_SECRET: config.webhookSigningSecret,
    RESEND_WEBHOOK_SECRET: config.resendWebhookSecret ?? "",
    AI_PROVIDER_API_KEY: config.aiProviderApiKey ?? "",
  };
  for (const name of kept) delete values[name];
  try {
    await writeFile(file, JSON.stringify(values), { mode: 0o600 });
    return await action(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
