import { createUlid } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import { readGroupedAlerts, type GroupedPreset } from "./grouped-alerts";
import type { AlertSourceRow, AlertReceiptRow, IntakeRepository } from "./repository";
import type { AlertIntakePolicy } from "./policies";
import type { IntakeResult } from "./service";

export async function acceptGroupedAlert({ repository, source, preset, requestHash, rawBody, parsed, timestamp, policy, onDraftCreated, events }: {
  repository: IntakeRepository; source: AlertSourceRow; preset: GroupedPreset; requestHash: string; rawBody: string; parsed: unknown; timestamp: string; policy: AlertIntakePolicy; onDraftCreated: (incidentId: string) => Promise<void>; events?: Pick<LampEventDispatcher, "alertAccepted">;
}): Promise<IntakeResult> {
  const reading = readGroupedAlerts(preset, parsed, source.labelMatchers ?? []);
  const error = "refused" in reading ? reading.refused : reading.alerts.every(alert => !alert.componentIds.length) ? "Unmapped alert group: no alert labels match a configured component." : null;
  if (error || "refused" in reading) {
    const receipt: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error, createdAt: timestamp, updatedAt: timestamp };
    await repository.recordInvalid(receipt);
    return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
  }
  const recovered = reading.alerts.every(alert => alert.state === "resolved");
  const existingId = await repository.findOpenIncident(source.id, reading.key);
  const creates = !recovered && !existingId && policy.createsDraft({ sourceId: source.id, deduplicationKey: reading.key, recovered });
  const incident = creates ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: reading.title || "Alert group requiring review", operatorId: source.createdByOperatorId, timestamp } : null;
  const unmapped = reading.alerts.filter(alert => !alert.componentIds.length).map(alert => alert.fingerprint);
  const receipt: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: reading.key, incidentId: existingId ?? incident?.id ?? null, state: recovered ? "recovered" : "firing", receivedAt: timestamp, recoveredAt: recovered ? timestamp : null, payloadJson: rawBody, error: unmapped.length ? `Unmapped alert fingerprints: ${unmapped.join(", ")}` : null, createdAt: timestamp, updatedAt: timestamp };
  const recorded = await repository.recordReceipt(receipt, incident, reading);
  if (!recorded.replayed && recorded.receipt.incidentId) {
    if (recorded.receipt.state === "recovered") await repository.markRecovered(source.id, reading.key, timestamp);
    await repository.resolveUnpublishedDraft(recorded.receipt.incidentId, timestamp);
    if (recorded.incidentCreated) await onDraftCreated(recorded.receipt.incidentId);
    await events?.alertAccepted({ sourceId: source.id, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: timestamp });
  }
  return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: recorded.replayed };
}
