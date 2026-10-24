import { createUlid } from "../../shared/ids";
import { readOperationsAlert, operationsComponents } from "./vendor-alerts";
import type { AlertSourceRow, AlertReceiptRow, IntakeRepository } from "./repository";
import type { AlertIntakePolicy } from "./policies";
import type { LampEventDispatcher } from "../../api/extensions";
import type { IntakeResult } from "./service";

export async function acceptOperationsAlert(input: { repository: IntakeRepository; source: AlertSourceRow; requestHash: string; rawBody: string; parsed: unknown; timestamp: string; policy: AlertIntakePolicy; onDraftCreated: (incidentId: string) => Promise<void>; events?: Pick<LampEventDispatcher, "alertAccepted"> }): Promise<IntakeResult> {
  const { repository, source, requestHash, rawBody, parsed, timestamp, policy, events, onDraftCreated } = input;
  const reading = readOperationsAlert(parsed);
  const componentIds = "refused" in reading ? [] : operationsComponents(reading, source.labelMatchers ?? []);
  const reason = "refused" in reading ? reading.refused : !componentIds.length ? "Unmapped alert. Add a tag, entity or affected-service component matcher." : null;
  const base: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: reason ?? null, createdAt: timestamp, updatedAt: timestamp };
  if ("refused" in reading || reason) {
    await repository.recordInvalid(base);
    return { status: 400, receiptId: base.id, incidentId: null, replayed: false };
  }
  const existingId = await repository.findOpenIncident(source.id, reading.key);
  const create = reading.action === "Create" && !existingId && policy.createsDraft({ sourceId: source.id, deduplicationKey: reading.key, recovered: false });
  const incident = create ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: reading.title, operatorId: source.createdByOperatorId, timestamp } : null;
  const receipt: AlertReceiptRow = { ...base, deduplicationKey: reading.key, incidentId: existingId ?? incident?.id ?? null, state: reading.recovered ? "recovered" : "firing", recoveredAt: reading.recovered ? timestamp : null };
  const recorded = await repository.recordReceipt(receipt, incident, undefined, reading.action === "Create" ? componentIds : [], reading.action === "AddNote" ? { body: reading.note!, operatorId: source.createdByOperatorId } : undefined, reading.action === "Create" ? reading.title : undefined);
  if (recorded.replayed) return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: true };
  if (reading.recovered) {
    await repository.markRecovered(source.id, reading.key, timestamp);
    if (recorded.receipt.incidentId) await repository.resolveUnpublishedDraft(recorded.receipt.incidentId, timestamp);
  }
  if (recorded.incidentCreated && recorded.receipt.incidentId) await onDraftCreated(recorded.receipt.incidentId);
  await events?.alertAccepted({ sourceId: source.id, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: timestamp });
  return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: false };
}
