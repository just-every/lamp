import type { OwnerClaimConfig } from '../../../owner-claim/index.mjs';
import type { D1Database, D1Sql, D1TargetAdapter, D1ImportContext } from '../d1/types.ts';
import type { ImportMapping, ImportPlan, Json, ParsedRecord, ReaderLimits, PersistedImport, SourceBundle } from '../types.ts';
import type { DoorGrant } from './grants.ts';

export interface ImportDoorOptions {
  database: D1Database;
  targets: D1TargetAdapter;
  /** The same server-owned configuration supplied to owner-claim. */
  claim: OwnerClaimConfig;
  /** The seed's actual owner principal, so its ordinary import history/undo works. */
  ownerPrincipalId: string;
  destination: string;
  mapping: Pick<ImportMapping, 'version'> & Partial<ImportMapping>;
  parse?(value: Json, index: number): ParsedRecord | ParsedRecord[];
  format: 'json' | 'ndjson';
  limits?: ReaderLimits;
  reversalPolicy?: D1ImportContext['reversalPolicy'];
  /** Lamp adaptation: reuse its asynchronous source readers and native planner.
   * Called only after grant admission; the ordinary door planner still validates
   * mappings, quotas, catch-up, fingerprints and all native writes. */
  prepareSource?(bytes: Uint8Array, context: D1ImportContext, namespace: string): Promise<{source: SourceBundle; mapping: ImportMapping}>;
}
export interface DoorTarget { kind: string; id: string; ownerPlanId: string; sourceIdentity: string }
export interface DoorRecord {
  kind: string; sourceId: string; sourceHash: string; targets: DoorTarget[];
  explanation?: string;
}
export interface DoorDifferences {
  additions: string[]; replacements: string[]; unchanged: string[];
  gone: string[]; conflicts: string[];
}
export interface DoorSnapshot {
  id: string; namespace: string; bundleSha256: string; kitNamespace: string;
  previous: string | null; records: DoorRecord[]; sourceCount: number;
  plan: ImportPlan; differences: DoorDifferences;
  standingApproval: { id: string; at: string } | null;
}
export interface DoorPlanRow {
  id: string; installation_id: string; namespace: string; bundle_sha256: string;
  fingerprint: string; previous_id: string | null; job_id: string | null;
  complete: number; snapshot_hash: string;
}
export interface DoorRequest {
  options: ImportDoorOptions; grant: Readonly<DoorGrant>; kid: string;
  authority: D1Sql;
  persisted?: Promise<PersistedImport>;
}
