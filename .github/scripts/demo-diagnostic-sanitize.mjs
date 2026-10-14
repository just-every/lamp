import {pathToFileURL} from 'node:url';

export const target = Object.freeze({
  account: 'b20c0ca9cab0c2b70e13d7cf724b89bd', worker: 'lamp-demo-proof--demo',
  applicationId: 'a03118c8-6ddd-4209-9fff-25906839288e',
  applicationName: 'demo-32c3770b9546606b5ae032fead52aef7', host: 'demo.test.run-lamp.com',
});
export const integer = value => Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : null;
export function timestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) && ms >= 946684800000 && ms < 4102444800000 ? new Date(ms).toISOString() : null;
}
const unknown = () => [{category: 'unclassified'}];
export function sanitize(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown();
  if (kind === 'application') return [{category: 'application-identity',
    matches: value.id === target.applicationId && value.name === target.applicationName && value.account_id === target.account,
    logsEnabled: typeof value.configuration?.observability?.logs?.enabled === 'boolean' ? value.configuration.observability.logs.enabled : null,
  }];
  if (kind === 'instance') {
    const states = ['provisioning', 'running', 'failed', 'stopping', 'stopped', 'unhealthy', 'inactive', 'unknown'];
    return [{category: 'instance-status', state: states.includes(value.status?.state) ? value.status.state : 'unknown',
      updatedAt: timestamp(value.status?.updated_at), startedAt: timestamp(value.started_at), exitCode: integer(value.status?.exit_code)}];
  }
  if (kind === 'api-error') return [{category: 'capture-unavailable',
    providerCodes: (Array.isArray(value.errors) ? value.errors : []).slice(0, 10).map(error => integer(error?.code)).filter(code => code !== null && code >= 0)}];
  if (kind !== 'tail' || !Array.isArray(value.logs)) return unknown();
  const records = [];
  for (const log of value.logs.slice(0, 1000)) {
    const message = log?.message;
    if (log?.level !== 'error' || !Array.isArray(message) || message.length !== 2 || message[0] !== 'Demo start failed:') continue;
    let category = 'container-start-error', status;
    if (message[1] === 'demo container never became healthy') category = 'health-timeout';
    else if (typeof message[1] === 'string') {
      const claim = /^owner claim answered ([1-5][0-9]{2})$/.exec(message[1]);
      if (claim) { category = 'owner-claim-rejected'; status = Number(claim[1]); }
    }
    records.push({category, ...(status ? {status} : {}), eventAt: timestamp(value.eventTimestamp), logAt: timestamp(log.timestamp)});
  }
  return records.length ? records : unknown();
}

// Public proof interface: one provider JSON record per input line. No arbitrary
// string (including error/stack/request/claim/DO-cookie IDs) is ever emitted.
export function consume(stream, kind, channel, emit) {
  let pending = '', discarding = false;
  const output = line => {
    let records;
    try { records = sanitize(kind, JSON.parse(line)); } catch { records = unknown(); }
    for (const record of records) emit({at: new Date().toISOString(), channel, ...record});
  };
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    for (const part of chunk.split(/(?<=\n)/)) {
      const complete = part.endsWith('\n');
      if (!discarding) {
        pending += part;
        if (pending.length > 1048576) { pending = ''; discarding = true; }
      }
      if (complete) { output(discarding ? '' : pending); pending = ''; discarding = false; }
    }
  });
  stream.on('end', () => { if (pending || discarding) output(discarding ? '' : pending); pending = ''; });
  stream.on('error', () => emit({at: new Date().toISOString(), channel, category: 'capture-unavailable'}));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [kind, channel] = process.argv.slice(2);
  if (!['tail', 'application', 'instance', 'api-error'].includes(kind) || !['stdout', 'stderr'].includes(channel) || process.argv.length !== 4) {
    process.stdout.write('{"category":"capture-unavailable"}\n'); process.exitCode = 1;
  } else consume(process.stdin, kind, channel, record => process.stdout.write(`${JSON.stringify(record)}\n`));
}
