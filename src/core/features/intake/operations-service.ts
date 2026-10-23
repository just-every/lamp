import { createUlid } from "../../shared/ids";
import { readOperations, operationsComponents } from "./operations";
import type { AlertSourceRow, AlertReceiptRow, IntakeRepository } from "./repository";
import type { AlertIntakePolicy } from "./policies";
import type { LampEventDispatcher } from "../../api/extensions";
import type { IntakeResult } from "./service";

export async function acceptOperations(input: { repository: IntakeRepository; source: AlertSourceRow; requestHash: string; rawBody: string; parsed: unknown; timestamp: string; policy: AlertIntakePolicy; onDraftCreated: (incidentId: string) => Promise<void>; events?: Pick<LampEventDispatcher, "alertAccepted"> }): Promise<IntakeResult> {
  const { repository, source, requestHash, rawBody, parsed, timestamp, policy, events, onDraftCreated } = input;
  const reading = readOperations(parsed);
  const existingId = "refused" in reading ? null : await repository.findOpenIncident(source.id, reading.key);
  const componentIds = "refused" in reading ? [] : operationsComponents(reading, source.labelMatchers ?? []);
  const reason = "refused" in reading ? reading.refused : reading.action === "Create" && !componentIds.length
    ? "Unmapped responder alert. Add a tag or entity component matcher." : !existingId && reading.action !== "Create" ? "No open incident is linked to this alertId." : null;
  // AddNote's body lives only in internal notes. Even the retained intake receipt
  // contains no note text, and the brief repository excludes this action entirely.
  const payloadJson = !("refused" in reading) && reading.action === "AddNote"
    ? JSON.stringify({ action: "AddNote", alert: { alertId: reading.key } }) : rawBody;
  const base: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson, error: reason ?? null, createdAt: timestamp, updatedAt: timestamp };
  if ("refused" in reading || reason) {
    await repository.recordInvalid(base);
    return { status: 400, receiptId: base.id, incidentId: null, replayed: false };
  }
  const create = reading.action === "Create" && !existingId && policy.createsDraft({ sourceId: source.id, deduplicationKey: reading.key, recovered: false });
  const incident = create ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: reading.title, operatorId: source.createdByOperatorId, timestamp } : null;
  const receipt: AlertReceiptRow = { ...base, deduplicationKey: reading.key, incidentId: existingId ?? incident?.id ?? null, state: reading.recovered ? "recovered" : "firing", recoveredAt: reading.recovered ? timestamp : null };
  const recorded = await repository.recordReceipt(receipt, incident, undefined, reading.action === "Create" ? componentIds : [],
    reading.action === "AddNote" ? { body: `Responder note${reading.actor ? ` from ${reading.actor}` : ""}: ${reading.note}`, operatorId: source.createdByOperatorId } : undefined);
  if (recorded.replayed) return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: true };
  if (reading.recovered) {
    await repository.markRecovered(source.id, reading.key, timestamp);
    if (recorded.receipt.incidentId) await repository.resolveUnpublishedDraft(recorded.receipt.incidentId, timestamp);
  }
  if (recorded.incidentCreated && recorded.receipt.incidentId) await onDraftCreated(recorded.receipt.incidentId);
  await events?.alertAccepted({ sourceId: source.id, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: timestamp });
  return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: false };
}
