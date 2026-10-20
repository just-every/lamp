export interface RecoveryReceipt {
  id: string;
  sourceId: string;
  source: string;
  groupedPreset: string | null;
  deduplicationKey: string | null;
  state: "firing" | "recovered" | "invalid";
  receivedAt: string;
  recoveredAt: string | null;
  updatedAt: string;
}

export interface RecoveryMember {
  sourceId: string;
  source: string;
  groupKey: string;
  fingerprint: string;
  state: "firing" | "resolved";
  receivedAt: string;
  recoveredAt: string | null;
}

export interface RecoveryEvidence {
  receipts: RecoveryReceipt[];
  members: RecoveryMember[];
}

export interface RecoveryCheck {
  passed: boolean;
  checkedAt: string;
  holdMinutes: 5;
  items: Array<{
    source: string;
    key: string;
    state: "firing" | "holding" | "recovered";
    evidenceAt: string;
    recoveredAt: string | null;
  }>;
  notTracked: string[];
}

export class RecoveryCheckError extends Error {
  constructor(public readonly recovery: RecoveryCheck) {
    super("A monitor still reports a problem or recovered less than five minutes ago. Give a reason to publish Resolved now.");
  }
}

/** This checks reported alert recovery, not continuous monitor sampling.
 * Group members retain their latest reported recovery time: repeated recovery
 * notifications cannot manufacture a longer period of observed passing. */
export function checkRecovery(evidence: RecoveryEvidence, checkedAt: string): RecoveryCheck {
  const groupedKeys = new Set(evidence.members.map(member => JSON.stringify([member.sourceId, member.groupKey])));
  const latest = new Map<string, RecoveryReceipt>();
  const stillFiring = (receipt: RecoveryReceipt) => receipt.state === "firing" && receipt.recoveredAt === null;
  // Receipt times have millisecond precision and ULID randomness is unordered.
  // Where arrival order is unknowable, an unrecovered firing wins the tie.
  const ordered = [...evidence.receipts].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)
    || Number(stillFiring(a)) - Number(stillFiring(b)) || a.id.localeCompare(b.id));
  for (const receipt of ordered) {
    if (receipt.state === "invalid") continue;
    if (receipt.deduplicationKey === null) throw new Error("An accepted alert has no deduplication key.");
    const key = JSON.stringify([receipt.sourceId, receipt.deduplicationKey]);
    // Historical single-alert evidence still counts if its source was later
    // reconfigured. Only actual group membership supersedes aggregate receipts.
    if (!groupedKeys.has(key)) latest.set(key, receipt);
  }
  const item = (source: string, key: string, evidenceAt: string, recoveredAt: string | null): RecoveryCheck["items"][number] => ({
    source, key, evidenceAt, recoveredAt,
    state: recoveredAt === null ? "firing" : Date.parse(checkedAt) - Date.parse(recoveredAt) >= 5 * 60_000 ? "recovered" : "holding",
  });
  const items = [
    ...[...latest.values()].map(receipt => item(receipt.source, receipt.deduplicationKey!, receipt.receivedAt, receipt.recoveredAt)),
    ...evidence.members.map(member => item(member.source, `${member.groupKey}/${member.fingerprint}`, member.receivedAt, member.state === "resolved" ? member.recoveredAt : null)),
  ];
  const notTracked = ["Vendor dependencies", "Public-page traffic baseline", "Linked support tickets", "Continuous monitor passing samples"];
  if (!items.length) notTracked.unshift("Linked monitors and alerts (none received)");
  return { passed: items.every(item => item.state === "recovered"), checkedAt, holdMinutes: 5, items, notTracked };
}
