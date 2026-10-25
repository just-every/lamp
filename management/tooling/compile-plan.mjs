import {unstable_readConfig} from 'wrangler';
import {fileURLToPath} from 'node:url';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex');
const lampRoot = new URL('../../', import.meta.url);
function required(vars, key, pattern) {
  const value = vars[key];
  if (typeof value !== 'string' || !value.trim() || (pattern && !pattern.test(value))) throw new Error(`Invalid or missing ${key}`);
  return value.trim();
}
async function migrations(directory, prefix) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' && prefix === 'ext') return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.name.endsWith('.sql')) continue;
    if (!entry.isFile() || !/^[\w.-]+\.sql$/.test(entry.name)) throw new Error('Migration must be a regular SQL file');
    const sql = await readFile(new URL(entry.name, directory), 'utf8');
    result.push({ binding: 'DB', name: `${prefix}-${entry.name}`, sha256: digest(sql), sql });
  }
  return result;
}
export async function lampPlan({ installationId, environment, variables, root = lampRoot }) {
  if (typeof installationId !== 'string' || !installationId.trim()) throw new Error('installationId required');
  if (!['production', 'preview'].includes(environment)) throw new Error('environment must be production or preview');
  const hostname = /^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const config = {
    pageHost: required(variables, 'LAMP_PAGE_HOST', hostname), appHost: required(variables, 'LAMP_APP_HOST', hostname),
    pageName: required(variables, 'LAMP_PAGE_NAME'), pageTagline: required(variables, 'LAMP_PAGE_TAGLINE'),
    pageAccentColor: required(variables, 'LAMP_ACCENT_COLOR', /^#[0-9a-fA-F]{6}$/),
    pageTimezone: required(variables, 'LAMP_PAGE_TIMEZONE'), mailFromAddress: required(variables, 'MAIL_FROM_ADDRESS', email),
    setupOperatorEmail: required(variables, 'SETUP_OPERATOR_EMAIL', email),
  };
  new Intl.DateTimeFormat('en', { timeZone: config.pageTimezone });
  if (config.pageHost === config.appHost) throw new Error('Lamp app and page host must differ');
  const provider = required(variables, 'MAIL_PROVIDER', /^(resend|sendgrid|mailgun|ses|postmark)$/);
  const template = unstable_readConfig({config:fileURLToPath(new URL('wrangler.jsonc',root))});
  const date=template.compatibility_date,flags=template.compatibility_flags;
  if(!date||!Array.isArray(flags)||!template.d1_databases.some(row=>row.binding==='DB')||!template.r2_buckets.some(row=>row.binding==='SNAPSHOTS')||!template.queues.producers.some(row=>row.binding==='JOBS')||!template.durable_objects.bindings.some(row=>row.name==='SNAPSHOT_CACHE'&&row.class_name==='SnapshotCache'))throw new Error('Lamp topology changed');
  const prefix = `rer-${digest(installationId).slice(0, 16)}-${environment === 'production' ? 'prod' : 'preview'}-`;
  const sqlMigrations = [...await migrations(new URL('migrations/core/', root), 'core'), ...await migrations(new URL('migrations/ext/', root), 'ext')];
  const { setupPageSettingsStatement } = await import(new URL('scripts/ops-config.mjs', root));
  const sql = setupPageSettingsStatement(config);
  sqlMigrations.push({ binding: 'DB', name: 'setup-initial-page.sql', sha256: digest(sql), sql });
  const publicVariables = { LAMP_PAGE_HOST: config.pageHost, LAMP_APP_HOST: config.appHost, AUTH_ORIGIN:`https://${config.appHost}`, SETUP_OPERATOR_EMAIL:config.setupOperatorEmail, MAIL_FROM_ADDRESS: config.mailFromAddress, MAIL_PROVIDER: provider };
  for (const key of ['MAIL_DKIM_SELECTOR', 'MAIL_SECONDARY_PROVIDER', 'MAILGUN_REGION', 'SES_REGION', 'SES_CONFIGURATION_SET', 'SES_EVENT_TOPIC_ARN', 'SENDGRID_WEBHOOK_PUBLIC_KEY', 'AI_PROVIDER_URL', 'AI_PROVIDER_MODEL']) if (variables[key]) publicVariables[key] = required(variables, key);
  const secretNames = ['SETUP_TOKEN', 'SESSION_SECRET', 'MAIL_PROVIDER_API_KEY', 'SUBSCRIBER_TOKEN_SECRET', 'WEBHOOK_SIGNING_SECRET'];
  if (variables.MAIL_SECONDARY_PROVIDER && (!['resend','sendgrid','mailgun','ses','postmark'].includes(variables.MAIL_SECONDARY_PROVIDER) || variables.MAIL_SECONDARY_PROVIDER === provider)) throw new Error('The secondary must be a different direct mail provider');
  if (variables.MAILGUN_REGION && !['us','eu'].includes(variables.MAILGUN_REGION)) throw new Error('MAILGUN_REGION must be us or eu');
  if ([provider,variables.MAIL_SECONDARY_PROVIDER].includes('resend')) secretNames.push('RESEND_WEBHOOK_SECRET');
  if ([provider,variables.MAIL_SECONDARY_PROVIDER].includes('ses')) {
    publicVariables.SES_REGION=required(variables,'SES_REGION',/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/);
    publicVariables.SES_CONFIGURATION_SET=required(variables,'SES_CONFIGURATION_SET',/^[A-Za-z0-9_-]{1,64}$/);
    publicVariables.SES_EVENT_TOPIC_ARN=required(variables,'SES_EVENT_TOPIC_ARN',/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/);
  }
  if ([provider,variables.MAIL_SECONDARY_PROVIDER].includes('postmark')) secretNames.push('POSTMARK_WEBHOOK_SECRET');
  if ([provider,variables.MAIL_SECONDARY_PROVIDER].includes('mailgun')) secretNames.push('MAILGUN_WEBHOOK_SIGNING_KEY');
  if (variables.MAIL_SECONDARY_PROVIDER) secretNames.push('MAIL_SECONDARY_API_KEY');
  if (variables.AI_PROVIDER_URL) secretNames.push('AI_PROVIDER_API_KEY');
  if (environment === 'preview' && (!Array.isArray(variables.controlledProviders) || !variables.controlledProviders.length)) throw new Error('Preview requires explicit controlledProviders');
  return {
    schema: 1, workerName: prefix + 'lamp', environment,
    resources: [{ kind: 'd1', binding: 'DB', name: prefix + 'db' }, { kind: 'r2', binding: 'SNAPSHOTS', name: prefix + 'snapshots' }, { kind: 'queue', binding: 'JOBS', name: prefix + 'jobs' }],
    migrations: sqlMigrations, compatibilityDate: date, compatibilityFlags: flags,
    durableObjects: [{ binding: 'SNAPSHOT_CACHE', className: 'SnapshotCache' }],
    durableObjectMigrations: [{ tag: 'snapshot-cache-v1', newSqliteClasses: ['SnapshotCache'] }],
    publicVariables, secretNames, optionalSecretNames: ["SLACK_SIGNING_SECRET", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "POSTMARK_ACCOUNT_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE"], healthPath: '/health',
    recovery: 'Preserve source and database backup before migration. Restore into fresh installation resources and verify owner workflows before switching traffic.',
    schedules: environment === 'production' ? ['* * * * *'] : [],
    queueConsumers: environment === 'production' ? [{ binding: 'JOBS', maxBatchSize: 10, maxBatchTimeout: 5, maxRetries: 5 }] : [],
    ...(environment === 'preview' ? { previewEffects: { schedulesDisabled: true, controlledProviders: variables.controlledProviders } } : {}),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [installationId, environment, file] = process.argv.slice(2);
  if (!file) throw new Error('Usage: node scripts/delivery/lamp-plan.mjs INSTALLATION_ID production|preview config.json');
  const variables = JSON.parse(await readFile(file, 'utf8'));
  console.log(JSON.stringify(await lampPlan({ installationId, environment, variables }), null, 2));
}
