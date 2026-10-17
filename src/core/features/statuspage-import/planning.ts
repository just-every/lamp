import { cutoverFromPlan, type CutoverPreview } from "./cutover";
import { resolvePublicAddresses, sourcePublicAddresses } from "./public-addresses";
import { canonicalJson, planD1Import, sha256, type D1ImportContext, type ImportPlan, type SourceRecord, type TargetEffect } from "../../../../modules/import-kit/src/d1/index.ts";
import type { Json } from "../../../../modules/import-kit/src/types.ts";
import { mapSource, type Accounting, type EntityKind, type Snapshot } from "./rows";
import { entityTables } from "./rows";
import { moveInPlan } from './door-plan';
import { namespace, type ReadSource } from "./source";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

export async function planMoveIn(read: ReadSource, snapshot: Snapshot, context: D1ImportContext, operatorId: string, asOf: string): Promise<ImportPlan> {
  const namespace = read.namespace ?? "statuspage";
  const addresses = new Map<string, string>();
  for (const record of read.records.filter((record) => record.kind === "incident" || record.kind === "maintenance")) {
    for (const { path } of sourcePublicAddresses(record.sourceId, (record.payload as Record<string, unknown>).shortlink, namespace, read.publicAddresses?.[`${record.kind}:${record.sourceId}`])) {
      const identity = `${record.kind}:${record.sourceId}`;
      const existing = addresses.get(path);
      if (existing && existing !== identity) throw new Error(`Public address ${path} conflicts between ${existing} and ${identity}.`);
      addresses.set(path, identity);
    }
  }
  const mapped = mapSource(read.data, snapshot, operatorId, asOf, namespace);
  for (const item of read.accounting ?? []) {
    const entry = mapped.find(row => row.kind === item.kind && row.sourceId === item.sourceId);
    if (entry) {
      if (!entry.accounting.some(row => row.outcome === "rejected" || row.outcome === "skipped")) entry.accounting = [{ ...item, reason: `${entry.accounting.map(row => row.reason).join(" ")} ${item.reason}` }];
    } else mapped.push({ kind: item.kind as EntityKind, sourceId: item.sourceId, accounting: [item] });
  }
  const raw = new Map(read.records.map((record) => [`${record.kind}:${record.sourceId}`, record.payload]));
  const records: SourceRecord[] = [];
  const effects = new Map<string, TargetEffect>();
  for (const entry of mapped) {
    const key = `${entry.kind}:${entry.sourceId}`;
    const origin = read.origins.get(key)!;
    const payload = json({ raw: raw.get(key), accounting: entry.accounting, ...(read.publicAddresses ? { publicAddresses: read.publicAddresses[key] ?? [] } : {}) });
    records.push({ namespace, kind: entry.kind, sourceId: entry.sourceId, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: origin.sha256, location: { artifact: origin.name } });
    if (entry.value) {
      const owner = Object.keys(entityTables[entry.kind])[0];
      effects.set(key, { targetKind: entry.kind, targetId: String(entry.value.tables[owner][0].id), value: json(entry.value) });
    }
  }
  // The review instant and the source's file identities, so a report can be rebuilt from the plan alone.
  const identity = sha256(canonicalJson(read.artifacts.map((artifact) => ({ name: artifact.name, sha256: artifact.sha256 })).sort((a, b) => a.name.localeCompare(b.name))));
  const metadata = json({ raw: { asOf, ...(read.sourceInfo ? { sourceInfo: read.sourceInfo } : {}) }, accounting: [] });
  records.push({ namespace, kind: "metadata", sourceId: identity, payload: metadata, payloadHash: sha256(canonicalJson(metadata)), artifactHash: read.artifacts[0].sha256, location: { artifact: read.artifacts[0].name } });
  return planD1Import({ records, artifacts: read.artifacts, diagnostics: [] }, {
    version: "1",
    map: (source) => {
      const accounting = (source.payload as unknown as { accounting: Accounting[] }).accounting;
      const effect = effects.get(`${source.kind}:${source.sourceId}`);
      const rejected = accounting.find((item) => item.outcome === "rejected" && item.kind === source.kind);
      return {
        effects: effect ? [effect] : [],
        unmapped: accounting.filter((item) => item.outcome === "skipped" || item.outcome === "changed").map((item) => ({ field: item.kind, reason: item.reason })),
        ...(rejected ? { rejection: rejected.reason } : {}),
      };
    },
  }, context);
}

export type CountKind = EntityKind | "postmortem";
export type Counts = Record<CountKind, { read: number; imported: number; changed: number; skipped: number; rejected: number; "kept-private": number }>;
export interface MoveInReport { state: string; asOf: string; fingerprint: string; counts: Counts; items: Accounting[]; cutover: CutoverPreview; unavailableAddresses: string[] }

/** The dry-run report, rebuilt from the reviewed plan so a saved job reports exactly what it applied. */
export function reportFromPlan(plan: ImportPlan, state = "dry run"): MoveInReport {
  plan = moveInPlan(plan);
  const items = plan.entries.flatMap((entry) => entry.erased ? [] : ((entry.source.payload as { accounting?: Accounting[] }).accounting ?? []));
  const kinds = Object.keys(entityTables).filter(kind => kind !== "template" || plan.namespace === "statuspage" || items.some(item => item.kind === kind));
  if (plan.namespace === "statuspage" || items.some(item => item.kind === "postmortem")) kinds.push("postmortem");
  const counts = Object.fromEntries((kinds as CountKind[]).map((kind) => [kind, { read: 0, imported: 0, changed: 0, skipped: 0, rejected: 0, "kept-private": 0 }])) as Counts;
  for (const item of items) { counts[item.kind as CountKind].read += 1; counts[item.kind as CountKind][item.outcome] += 1; }
  const metadata = plan.entries.find((entry) => entry.source.kind === "metadata")?.source.payload as { raw?: { asOf?: string } } | undefined;
  const candidates = plan.entries.filter((entry) => !entry.erased && ["incident", "maintenance"].includes(entry.source.kind)).flatMap((entry) => entry.effects.map((effect) => ({ namespace: entry.source.namespace, sourceId: entry.source.sourceId, targetId: effect.targetId, targetKind: effect.targetKind, target: `${effect.targetKind}:${effect.targetId}`, publicAddresses: (entry.source.payload as { publicAddresses?: string[] }).publicAddresses, shortlink: (entry.source.payload as { raw?: { shortlink?: unknown } }).raw?.shortlink })));
  const { unavailable: unavailableAddresses } = resolvePublicAddresses(candidates);
  return { cutover: cutoverFromPlan(plan, metadata?.raw?.asOf ?? ""), unavailableAddresses, state, asOf: metadata?.raw?.asOf ?? "", fingerprint: plan.fingerprint, counts, items };
}
