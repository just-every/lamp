import { Buffer } from 'node:buffer';
import { retireD1ImportCustody, type D1ImportContext, type D1Sql } from '../../../../modules/import-kit/src/d1/index.ts';
import { statuspageTargets } from './targets';

/** A subscriber leaving Lamp, with the exact addresses they were known by. */
export interface CustodySubject { id: string; values: string[] }

/** Lamp's own read of the door's retained plan snapshots and upload bundles:
 * every record an upload held, imported or not, as text. Upload chunks are
 * base64 of one UTF-8 bundle, and a chunk may split a character. */
async function doorTexts(db: D1Database): Promise<string[]> {
  const [plans, uploads] = await db.batch<{ owner: string; body: string }>([
    db.prepare('SELECT plan_id AS owner,body FROM ik_door_plan_chunks ORDER BY plan_id,ordinal'),
    db.prepare('SELECT upload_id AS owner,base64 AS body FROM ik_door_chunks ORDER BY upload_id,ordinal'),
  ]);
  const grouped = <T>(rows: Array<{ owner: string; body: string }>, part: (body: string) => T) => {
    const owners = new Map<string, T[]>();
    for (const row of rows) owners.set(row.owner, [...owners.get(row.owner) ?? [], part(row.body)]);
    return [...owners.values()];
  };
  return [
    ...grouped(plans.results, (body) => body).map((parts) => parts.join('')),
    ...grouped(uploads.results, (body) => Buffer.from(body, 'base64')).map((parts) => Buffer.concat(parts).toString('utf8')),
  ];
}

/** Which subjects import custody holds: a subscriber an import created, or an
 * address inside a retained door bundle or plan snapshot. Those are erased
 * through the kit; anyone else is an ordinary native deletion. */
export async function subjectsInCustody(db: D1Database, subjects: CustodySubject[]): Promise<CustodySubject[]> {
  if (!subjects.length) return [];
  const imported = new Set((await db.prepare("SELECT DISTINCT target_id AS id FROM ik_provenance WHERE destination='lamp' AND target_kind='subscriber' AND target_id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(subjects.map((subject) => subject.id))).all<{ id: string }>()).results.map((row) => row.id));
  if (subjects.every((subject) => imported.has(subject.id))) return subjects;
  // Addresses compare case-insensitively: a source may spell one in any case.
  const texts = (await doorTexts(db)).map((text) => text.toLowerCase());
  const held = (value: string) => [value, JSON.stringify(value).slice(1, -1)].map((form) => form.toLowerCase()).some((form) => texts.some((text) => text.includes(form)));
  return subjects.filter((subject) => imported.has(subject.id) || subject.values.some((value) => value && held(value)));
}

/** Erase a subscriber from Lamp's import custody in one D1 batch with their
 * native deletion: their imported records become tombstones in every import,
 * the door's retained bundles and plan snapshots are withdrawn whole (they are
 * indivisible), and the kit journals it. `authority` is the deletion's own
 * admission, checked before and after the batch's writes. Lamp's archives never
 * carry import custody, so `checkpoint`, the deletion's record, fences it. */
export async function retireSubscriberCustody(db: D1Database, subject: CustodySubject, native: D1Sql[], checkpoint: D1Sql[], authorization: { principalId: string; authority: D1Sql }) {
  const context: D1ImportContext = {
    destination: 'lamp', namespace: 'subscriber-erasure', mappingVersion: '1',
    storage: { database: db as never, targets: statuspageTargets },
    authorization: { principalId: authorization.principalId, predicate: () => authorization.authority },
  };
  return retireD1ImportCustody({ target: { kind: 'subscriber', id: subject.id }, values: subject.values.filter(Boolean) }, native, context, checkpoint);
}
