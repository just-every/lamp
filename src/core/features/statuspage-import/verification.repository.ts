import { canonicalJson, readD1ImportJob, readD1PersistedImport, sha256, type D1ImportContext, type TargetRow } from '../../../../modules/import-kit/src/d1/index';
import { stored } from '../../../../modules/import-kit/src/d1/jobs';
import { attachmentHash } from '../../../../modules/import-kit/src/provenance/identity';
import type { ProvenanceRow } from '../../../../modules/import-kit/src/types';
import type { NativeValue } from './rows';

/** The policy describes the real version-1 mapping; its implementation is bound
 * separately by the candidate revision in the signed receipt. */
const mappingPolicy = 'Lamp Move in mapping v1: Sorry groups and components retain order and source identity; notice messages and publication times map to native incident or maintenance history. Source lifecycle and field transformations are named by the reviewed accounting report. Public captures have no subscribers. Every mapped source entity is one atomic native target with retained source/artifact provenance; import sends no notifications.';

const digest = (value: unknown) => sha256(canonicalJson(value));
const key = (kind: string, id: string) => canonicalJson([kind, id]);
const targetIdentity = (destination: string, kind: string, id: string) => digest([destination, kind, id]);
const order = (values: string[]) => values.sort();

function rowDigest(row: Pick<TargetRow, 'destination' | 'targetKind' | 'targetId' | 'value' | 'attachment'>) {
  return digest({ targetIdentitySha256: targetIdentity(row.destination, row.targetKind, row.targetId), valueSha256: digest(row.value), attachmentSha256: attachmentHash(row.attachment) });
}

function provenanceDigest(row: Pick<ProvenanceRow, 'sourceIdentity' | 'sourceKind' | 'sourceId' | 'sourceHash' | 'artifactHash' | 'location' | 'destination' | 'targetKind' | 'targetId' | 'valueHash' | 'attachmentHash'>) {
  return digest({ sourceIdentitySha256: row.sourceIdentity, sourceKind: row.sourceKind, sourceIdSha256: sha256(row.sourceId), sourceSha256: row.sourceHash, artifactSha256: row.artifactHash, locationSha256: digest(row.location), targetIdentitySha256: targetIdentity(row.destination, row.targetKind, row.targetId), valueSha256: row.valueHash, attachmentSha256: row.attachmentHash });
}

/** Multiset difference: duplicate rows cannot disappear through set equality. */
function difference(source: string[], target: string[]) {
  const counts = new Map<string, number>();
  for (const value of source) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of target) counts.set(value, (counts.get(value) ?? 0) - 1);
  return [...counts.values()].reduce((total, count) => total + Math.abs(count), 0);
}

function comparison(source: string[], target: string[]) {
  return { sourceCount: source.length, targetCount: target.length, sourceManifestSha256: digest(source), targetManifestSha256: digest(target) };
}

function entityCounts(rows: Array<Pick<TargetRow, 'targetKind' | 'value'>>) {
  const counts = { group: 0, component: 0, incident: 0, maintenance: 0, updates: 0 };
  for (const row of rows) {
    if (row.targetKind === 'group' || row.targetKind === 'component' || row.targetKind === 'incident' || row.targetKind === 'maintenance') counts[row.targetKind]++;
    const tables = (row.value as unknown as NativeValue).tables;
    if (row.targetKind === 'incident') counts.updates += tables.incident_updates?.length ?? 0;
    if (row.targetKind === 'maintenance') counts.updates += tables.import_maintenance_updates?.length ?? 0;
  }
  return counts;
}

/** Read-only receipt evidence. Stored plan, provenance and actual native values
 * are independently projected before hashing. Nothing returns source messages,
 * names, subscriber destinations, uploaded bytes or before-images. The kit's
 * complete-set read fences custody and native data under current authority. */
export async function readImportVerification(id: string, context: D1ImportContext) {
  const before = await readD1ImportJob(id, context);
  if (before.state !== 'completed') throw new Error('Import verification requires a completed import.');
  const { plan } = await stored(id, context);
  if (plan.entries.some(entry => entry.erased)) throw new Error('Erased source records cannot issue an import verification receipt.');
  const persisted = await readD1PersistedImport(context);
  // Global counts include completed work: a silently created delivery or an
  // invitation claim remains observable even if the import queued no pending
  // outbox work. No recipient, message or invitation value is returned.
  const authority = context.authorization.predicate('read', context.destination);
  const notifications = await context.storage.database.prepare(`SELECT
    (SELECT count(*) FROM notification_outbox) AS outbox,
    (SELECT count(*) FROM notification_delivery_records) AS deliveries,
    (SELECT count(*) FROM statuspage_import_invites) AS invitations
    WHERE ${authority.sql}`).bind(...authority.params ?? []).first<{ outbox: number; deliveries: number; invitations: number }>();
  if (!notifications) throw new Error('NOT_AUTHORIZED');
  const after = await readD1ImportJob(id, context);
  if (canonicalJson(before) !== canonicalJson(after)) throw new Error('The import changed while its verification evidence was read.');

  const effects = plan.entries.flatMap(entry => entry.effects.map(effect => ({ entry, effect })));
  const actualProvenance = persisted.provenance.filter(row => row.jobId === id && !row.reversed);
  const owned = new Set([...effects.map(({ effect }) => key(effect.targetKind, effect.targetId)), ...actualProvenance.map(row => key(row.targetKind, row.targetId))]);
  const actualRows = persisted.rows.filter(row => owned.has(key(row.targetKind, row.targetId)));
  const expectedRows = effects.map(({ effect }) => ({ destination: plan.destination, ...effect }));
  const manifests = {
    rows: { source: order(expectedRows.map(rowDigest)), target: order(actualRows.map(rowDigest)) },
    provenance: {
      source: order(effects.map(({ entry, effect }) => provenanceDigest({ sourceIdentity: entry.identity, sourceKind: entry.source.kind, sourceId: entry.source.sourceId, sourceHash: entry.source.payloadHash, artifactHash: entry.source.artifactHash, location: entry.source.location, destination: plan.destination, targetKind: effect.targetKind, targetId: effect.targetId, valueHash: digest(effect.value), attachmentHash: attachmentHash(effect.attachment) }))),
      target: order(actualProvenance.map(provenanceDigest)),
    },
    attachments: {
      source: order(expectedRows.filter(row => row.attachment).map(row => digest({ targetIdentitySha256: targetIdentity(row.destination, row.targetKind, row.targetId), attachmentSha256: attachmentHash(row.attachment) }))),
      target: order(actualRows.filter(row => row.attachment).map(row => digest({ targetIdentitySha256: targetIdentity(row.destination, row.targetKind, row.targetId), attachmentSha256: attachmentHash(row.attachment) }))),
    },
  };
  const items = plan.entries.filter(entry => entry.unmapped.length).map(entry => ({ sourceIdentitySha256: entry.identity, sourceKind: entry.source.kind, fields: [...new Set(entry.unmapped.map(item => item.field ?? 'record'))].sort() })).sort((a, b) => a.sourceIdentitySha256.localeCompare(b.sourceIdentitySha256));
  const revisions = actualProvenance.filter(provenance => {
    const rows = actualRows.filter(row => row.targetKind === provenance.targetKind && row.targetId === provenance.targetId);
    return rows.length !== 1 || rows[0].revision !== provenance.appliedRevision;
  }).length;
  const differences = { rows: difference(manifests.rows.source, manifests.rows.target), provenance: difference(manifests.provenance.source, manifests.provenance.target), attachments: difference(manifests.attachments.source, manifests.attachments.target), revisions };
  return {
    job: { id: after.id, state: after.state, fingerprint: after.fingerprint },
    counts: plan.counts,
    mapping: { version: plan.mappingVersion, policy: mappingPolicy, policySha256: sha256(mappingPolicy) },
    reconciliation: { rows: comparison(manifests.rows.source, manifests.rows.target), provenance: comparison(manifests.provenance.source, manifests.provenance.target), attachments: comparison(manifests.attachments.source, manifests.attachments.target) },
    unmapped: { count: items.length, itemManifestSha256: digest(items), items },
    sourceCounts: entityCounts(expectedRows), nativeCounts: entityCounts(actualRows), manifests, differences, notifications,
    unexplainedDifferences: Object.values(differences).reduce((total, count) => total + count, 0),
  };
}
