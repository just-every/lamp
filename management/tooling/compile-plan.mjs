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
  const provider = required(variables, 'MAIL_PROVIDER', /^(resend|sendgrid)$/);
  const template = await readFile(new URL('deploy/wrangler.template.toml', root), 'utf8');
  const date = template.match(/^compatibility_date\s*=\s*"([\d-]+)"/m)?.[1];
  const flags = JSON.parse(template.match(/^compatibility_flags\s*=\s*(\[[^\n]+\])/m)?.[1] ?? 'null');
  // Fail if topology changed; this compiler implements Lamp's actual declared graph.
  for (const declaration of ['binding = "DB"', 'binding = "SNAPSHOTS"', 'binding = "JOBS"', 'name = "SNAPSHOT_CACHE"', 'class_name = "SnapshotCache"', 'new_sqlite_classes = ["SnapshotCache"]', 'crons = ["* * * * *"]', 'max_batch_size = 10', 'max_batch_timeout = 5', 'max_retries = 5', 'tag = "snapshot-cache-v1"']) {
    if (!template.includes(declaration)) throw new Error(`Lamp topology changed: ${declaration}`);
  }
  if (!date || !Array.isArray(flags)) throw new Error('Missing compatibility settings');
  const prefix = `rer-${digest(installationId).slice(0, 16)}-${environment === 'production' ? 'prod' : 'preview'}-`;
  const sqlMigrations = [...await migrations(new URL('migrations/core/', root), 'core'), ...await migrations(new URL('migrations/ext/', root), 'ext')];
  const { setupOperatorStatement, setupPageSettingsStatement } = await import(new URL('scripts/ops-config.mjs', root));
  const sql = setupOperatorStatement(config) + '\n' + setupPageSettingsStatement(config);
  sqlMigrations.push({ binding: 'DB', name: 'setup-initial-owner.sql', sha256: digest(sql), sql });
  const publicVariables = { LAMP_PAGE_HOST: config.pageHost, LAMP_APP_HOST: config.appHost, MAIL_FROM_ADDRESS: config.mailFromAddress, MAIL_PROVIDER: provider };
  for (const key of ['MAIL_DKIM_SELECTOR', 'SENDGRID_WEBHOOK_PUBLIC_KEY', 'AI_PROVIDER_URL', 'AI_PROVIDER_MODEL']) if (variables[key]) publicVariables[key] = required(variables, key);
  const secretNames = ['MAIL_PROVIDER_API_KEY', 'SUBSCRIBER_TOKEN_SECRET', 'WEBHOOK_SIGNING_SECRET'];
  if (provider === 'resend') secretNames.push('RESEND_WEBHOOK_SECRET');
  if (variables.AI_PROVIDER_URL) secretNames.push('AI_PROVIDER_API_KEY');
  if (environment === 'preview' && (!Array.isArray(variables.controlledProviders) || !variables.controlledProviders.length)) throw new Error('Preview requires explicit controlledProviders');
  return {
    schema: 1, workerName: prefix + 'lamp', environment,
    resources: [{ kind: 'd1', binding: 'DB', name: prefix + 'db' }, { kind: 'r2', binding: 'SNAPSHOTS', name: prefix + 'snapshots' }, { kind: 'queue', binding: 'JOBS', name: prefix + 'jobs' }],
    migrations: sqlMigrations, compatibilityDate: date, compatibilityFlags: flags,
    durableObjects: [{ binding: 'SNAPSHOT_CACHE', className: 'SnapshotCache' }],
    durableObjectMigrations: [{ tag: 'snapshot-cache-v1', newSqliteClasses: ['SnapshotCache'] }],
    publicVariables, secretNames, healthPath: '/health',
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
