import { randomBytes, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const environmentPattern = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function hostname(value, name) {
  const normalized = value.trim().toLowerCase();
  if (!hostnamePattern.test(normalized)) throw new Error(`${name} must be a hostname without a protocol, port, or path.`);
  return normalized;
}

function email(value, name) {
  const normalized = value.trim().toLowerCase();
  if (!emailPattern.test(normalized)) throw new Error(`${name} must be a valid email address.`);
  return normalized;
}

function text(value, name, maximum) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  if (normalized.length > maximum) throw new Error(`${name} must contain at most ${maximum} characters.`);
  return normalized;
}

function optional(value) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function timezone(value) {
  const normalized = text(value, "LAMP_PAGE_TIMEZONE", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new Error("LAMP_PAGE_TIMEZONE must be a valid IANA timezone such as Australia/Brisbane or UTC.");
  }
  return normalized;
}

function httpsUrl(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be an HTTPS URL.`);
  }
}

function accentColor(value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("LAMP_ACCENT_COLOR is required.");
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) throw new Error("LAMP_ACCENT_COLOR must be a six-digit hex colour such as #16794C.");
  return normalized;
}

function secret(value, name) {
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

function optionalSecret(value, name) {
  return value ? secret(value, name) : undefined;
}

function tomlString(value) {
  return JSON.stringify(value);
}

export function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (!value.startsWith("--")) throw new Error(`Unknown argument ${value}.`);
    if (value === "--dry-run" || value === "--remote" || value === "--local") flags.set(value.slice(2), true);
    else {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${value} requires a value.`);
      flags.set(value.slice(2), next);
      index += 1;
    }
  }
  return flags;
}

export function deploymentConfig(env = process.env, environment = "production") {
  if (!environmentPattern.test(environment)) throw new Error("Deployment environment must contain lowercase letters, digits, and hyphens.");
  const pageHost = hostname(required(env, "LAMP_PAGE_HOST"), "LAMP_PAGE_HOST");
  const appHost = hostname(required(env, "LAMP_APP_HOST"), "LAMP_APP_HOST");
  if (pageHost === appHost) throw new Error("LAMP_PAGE_HOST and LAMP_APP_HOST must be distinct for a deployment.");
  const pageName = text(env.LAMP_PAGE_NAME, "LAMP_PAGE_NAME", 120);
  const pageTagline = text(env.LAMP_PAGE_TAGLINE, "LAMP_PAGE_TAGLINE", 280);
  const pageTimezone = timezone(env.LAMP_PAGE_TIMEZONE);
  const pageAccentColor = accentColor(env.LAMP_ACCENT_COLOR);
  const mailFromAddress = email(required(env, "MAIL_FROM_ADDRESS"), "MAIL_FROM_ADDRESS");
  const setupOperatorEmail = email(required(env, "SETUP_OPERATOR_EMAIL"), "SETUP_OPERATOR_EMAIL");
  const mailProvider = optional(env.MAIL_PROVIDER) ?? "resend";
  if (!["resend", "sendgrid"].includes(mailProvider)) throw new Error("MAIL_PROVIDER must be resend or sendgrid.");
  const sendGridWebhookPublicKey = optional(env.SENDGRID_WEBHOOK_PUBLIC_KEY);
  if (sendGridWebhookPublicKey && !/^[A-Za-z0-9+/]+={0,2}$/.test(sendGridWebhookPublicKey)) throw new Error("SENDGRID_WEBHOOK_PUBLIC_KEY must be a base64 encoded public key.");
  if (sendGridWebhookPublicKey) {
    try {
      const key = createPublicKey({ key: Buffer.from(sendGridWebhookPublicKey, "base64"), format: "der", type: "spki" });
      if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    } catch { throw new Error("SENDGRID_WEBHOOK_PUBLIC_KEY must be a base64 P-256 SPKI public key."); }
  }
  const mailProviderApiKey = secret(required(env, "MAIL_PROVIDER_API_KEY"), "MAIL_PROVIDER_API_KEY");
  const subscriberTokenSecret = secret(required(env, "SUBSCRIBER_TOKEN_SECRET"), "SUBSCRIBER_TOKEN_SECRET");
  const webhookSigningSecret = secret(required(env, "WEBHOOK_SIGNING_SECRET"), "WEBHOOK_SIGNING_SECRET");
  const mailDkimSelector = required(env, "MAIL_DKIM_SELECTOR").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(mailDkimSelector)) throw new Error("MAIL_DKIM_SELECTOR must be a DNS label.");
  const resendWebhookSecret = optionalSecret(optional(env.RESEND_WEBHOOK_SECRET), "RESEND_WEBHOOK_SECRET");
  const aiProviderUrl = optional(env.AI_PROVIDER_URL);
  const aiProviderApiKey = optional(env.AI_PROVIDER_API_KEY);
  const aiProviderModel = optional(env.AI_PROVIDER_MODEL);
  if (Boolean(aiProviderUrl) !== Boolean(aiProviderApiKey) || Boolean(aiProviderUrl) !== Boolean(aiProviderModel)) throw new Error("AI_PROVIDER_URL, AI_PROVIDER_API_KEY, and AI_PROVIDER_MODEL must be configured together or all omitted.");
  return {
    environment,
    pageHost,
    appHost,
    pageName,
    pageTagline,
    pageTimezone,
    pageAccentColor,
    mailFromAddress,
    setupOperatorEmail,
    mailProviderApiKey,
    mailProvider,
    sendGridWebhookPublicKey,
    subscriberTokenSecret,
    webhookSigningSecret,
    mailDkimSelector,
    resendWebhookSecret,
    relaySecret: optionalSecret(optional(env.RER_MAIL_RELAY_SECRET), "RER_MAIL_RELAY_SECRET"),
    aiProviderUrl: aiProviderUrl ? httpsUrl(aiProviderUrl, "AI_PROVIDER_URL") : undefined,
    aiProviderApiKey,
    aiProviderModel: aiProviderModel ? text(aiProviderModel, "AI_PROVIDER_MODEL", 200) : undefined,
  };
}

export function resourceNames(environment) {
  return {
    worker: `lamp-${environment}`,
    database: `lamp-${environment}-db`,
    bucket: `lamp-${environment}-files`,
    queue: `lamp-${environment}-jobs`,
  };
}

export function renderWranglerToml(config, resources) {
  const aiVars = config.aiProviderUrl ? `AI_PROVIDER_URL = ${tomlString(config.aiProviderUrl)}\nAI_PROVIDER_MODEL = ${tomlString(config.aiProviderModel)}\n` : "";
  return `# Generated by pnpm setup. Do not edit: source values live outside the repository.\nname = ${tomlString(resources.worker)}\nmain = "src/server.ts"\ncompatibility_date = "2026-09-08"\ncompatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]\nroutes = [\n  { pattern = ${tomlString(config.pageHost)}, custom_domain = true },\n  { pattern = ${tomlString(config.appHost)}, custom_domain = true }\n]\n\n[triggers]\ncrons = ["* * * * *"]\n\n[assets]\nbinding = "ASSETS"\nrun_worker_first = true\n\n[vars]\nLAMP_PAGE_HOST = ${tomlString(config.pageHost)}\nLAMP_APP_HOST = ${tomlString(config.appHost)}\nMAIL_FROM_ADDRESS = ${tomlString(config.mailFromAddress)}\nMAIL_PROVIDER = ${tomlString(config.mailProvider)}\n${config.sendGridWebhookPublicKey ? `SENDGRID_WEBHOOK_PUBLIC_KEY = ${tomlString(config.sendGridWebhookPublicKey)}\n` : ""}${aiVars}\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = ${tomlString(resources.database)}\ndatabase_id = ${tomlString(resources.databaseId)}\nmigrations_dir = "migrations/core"\n\n[[r2_buckets]]\nbinding = "SNAPSHOTS"\nbucket_name = ${tomlString(resources.bucket)}\n\n[[queues.producers]]\nbinding = "JOBS"\nqueue = ${tomlString(resources.queue)}\n\n[[queues.consumers]]\nqueue = ${tomlString(resources.queue)}\nmax_batch_size = 10\nmax_batch_timeout = 5\nmax_retries = 5\n\n[[durable_objects.bindings]]\nname = "SNAPSHOT_CACHE"\nclass_name = "SnapshotCache"\n\n[[migrations]]\ntag = "snapshot-cache-v1"\nnew_sqlite_classes = ["SnapshotCache"]\n`;
}

export function renderRemoteArchiveWranglerToml(input) {
  const accountId = input.accountId?.trim();
  const databaseId = input.databaseId?.trim();
  const database = input.database?.trim();
  const bucket = input.bucket?.trim();
  const migrationsDir = input.migrationsDir?.trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? "")) throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character Cloudflare account ID for remote archive operations.");
  if (!/^[a-f0-9-]{36}$/i.test(databaseId ?? "")) throw new Error("The deployment record does not contain a valid D1 database ID for remote archive operations.");
  if (!database || !bucket) throw new Error("The deployment record is missing the D1 database or R2 bucket required for remote archive operations.");
  if (!migrationsDir || !isAbsolute(migrationsDir)) throw new Error("Remote archive configuration requires an absolute migrations/core path.");
  return `# Temporary remote-binding proxy generated by pnpm export/import.\n# It is never deployed and exists only while the archive command runs.\nname = "lamp-archive-proxy"\ncompatibility_date = "2026-08-31"\naccount_id = ${tomlString(accountId)}\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = ${tomlString(database)}\ndatabase_id = ${tomlString(databaseId)}\nmigrations_dir = ${tomlString(migrationsDir)}\nremote = true\n\n[[r2_buckets]]\nbinding = "SNAPSHOTS"\nbucket_name = ${tomlString(bucket)}\nremote = true\n`;
}

export async function writeDeploymentRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export async function readDeploymentRecord(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeGeneratedWrangler(path, config, resources) {
  await writeFile(path, renderWranglerToml(config, resources), "utf8");
}

export function deploymentRecordPath(environment) {
  return resolve(".seed", "deployment", `${environment}.json`);
}

function encode(value, length) {
  let encoded = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    encoded = crockford[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return encoded;
}

export function createUlid(timestamp = Date.now()) {
  const time = encode(BigInt(timestamp), 10);
  const random = encode(BigInt(`0x${randomBytes(10).toString("hex")}`), 16);
  return `${time}${random}`;
}

export function setupOperatorStatement(config, now = new Date().toISOString()) {
  const id = createUlid();
  const displayName = "Setup operator";
  return `INSERT INTO operators (id, email, display_name, is_setup_operator, created_at, updated_at) SELECT ${sqlLiteral(id)}, ${sqlLiteral(config.setupOperatorEmail)}, ${sqlLiteral(displayName)}, 1, ${sqlLiteral(now)}, ${sqlLiteral(now)} WHERE NOT EXISTS (SELECT 1 FROM operators WHERE is_setup_operator = 1);`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function setupPageSettingsStatement(config, now = new Date().toISOString()) {
  return `INSERT INTO page_settings (id, page_name, tagline, accent_color, timezone, hostname, feed_id, footer_credit_enabled, widget_allowed_origins, mail_from_address, created_at, updated_at) SELECT 'default', ${sqlLiteral(config.pageName)}, ${sqlLiteral(config.pageTagline)}, ${sqlLiteral(config.pageAccentColor)}, ${sqlLiteral(config.pageTimezone)}, ${sqlLiteral(config.pageHost)}, lower(hex(randomblob(16))), 1, '[]', ${sqlLiteral(config.mailFromAddress)}, ${sqlLiteral(now)}, ${sqlLiteral(now)} WHERE NOT EXISTS (SELECT 1 FROM page_settings WHERE id = 'default');`;
}
