import { nativeEventResource } from './event-resource';
/** Read-only native evidence; private contents and capabilities stay in D1. */
export function createAgentWitnessRepository(db: D1Database) {
  async function snapshot() {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{name: string}>()).results;
    const records: Record<string, Array<{id: string; digest: string; event: {uri:string;type:string} | null}>> = {};
    for (const {name} of tables) {
      // Policy, credential-use counters and transport audits change during a
      // refusal. The shared harness checks those separately. The private RPC
      // transport retains refused job receipts too; its native effects remain
      // in their original object, schedule and outbox tables below.
      if (/^(agent_door_|bs_|oa_sessions$|oa_tokens$|oa_rate_|d1_migrations$|lamp_agent_jobs$)/.test(name)) continue;
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const rows = (await db.prepare(`SELECT * FROM ${quoted}`).all<Record<string, unknown>>()).results;
      records[name] = await Promise.all(rows.map(async row => {
        const json = JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
        const bytes = new TextEncoder().encode(json);
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        return {id: typeof row.id === 'string' ? row.id : digest, digest, event: nativeEventResource(name,row)};
      }));
      records[name].sort((a,b) => a.id.localeCompare(b.id) || a.digest.localeCompare(b.digest));
    }
    return {records};
  }
  return {snapshot};
}
