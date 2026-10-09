import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import { constantTimeEqual, hashOpaqueToken, hmacSha256 } from "../../platform/security/opaque-tokens";
import { defaultAlertIntakePolicy, type AlertIntakePolicy } from "./policies";
import type { AlertReceiptRow, AlertReceiptView, AlertSourceRow, IntakeRepository } from "./repository";

export interface AlertSourceInput { name: string; credentialKind: AlertSourceRow["credentialKind"]; signingSecret?: string; bearerToken?: string; timestampHeader?: string; signatureHeader?: string; deduplicationPath: string; titlePath: string; statePath: string; recoveredValue?: string; }
export type AlertSourceView = Omit<AlertSourceRow, "signingSecret" | "bearerTokenHash"> & { endpointPath: string };
export interface IntakeResult { status: 202 | 400; receiptId: string; incidentId: string | null; replayed: boolean; }
export interface VerifiedAlertRequest { source: AlertSourceRow; rawBody: string; }
export interface IntakeService { listSources(): Promise<AlertSourceView[]>; listReceipts(limit?: number): Promise<AlertReceiptView[]>; saveSource(input: AlertSourceInput, operatorId: string, existingId?: string): Promise<AlertSourceView>; authenticate(sourceId: string, request: Request): Promise<VerifiedAlertRequest>; acceptVerified(request: VerifiedAlertRequest): Promise<IntakeResult>; accept(sourceId: string, request: Request): Promise<IntakeResult>; }

function sourceView(source: AlertSourceRow): AlertSourceView {
  const { signingSecret: _secret, bearerTokenHash: _hash, ...view } = source;
  return { ...view, endpointPath: `/api/intake/${source.id}` };
}

function readPath(payload: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, "");
  if (!clean) return payload;
  return clean.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean).reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) return /^\d+$/.test(segment) ? value[Number(segment)] : undefined;
    return (value as Record<string, unknown>)[segment];
  }, payload);
}
function validTimestamp(value: string | null) { const instant = value ? new Date(value).getTime() : Number.NaN; return Number.isFinite(instant) && Math.abs(Date.now() - instant) <= 5 * 60 * 1000; }

export function createIntakeService(
  repository: IntakeRepository,
  policy: AlertIntakePolicy = defaultAlertIntakePolicy,
  onDraftCreated: (incidentId: string) => Promise<void>,
  events?: Pick<LampEventDispatcher, "alertAccepted">,
): IntakeService {
  return {
    async listSources() { return (await repository.listSources()).map(sourceView); },
    async listReceipts(limit = 100) { return repository.listReceipts(Math.min(Math.max(limit, 1), 250)); },
    async saveSource(input, operatorId, existingId) {
      if (!input.name.trim() || !input.deduplicationPath || !input.titlePath || !input.statePath) throw new Error("A source name and all three JSON paths are required.");
      const existing = existingId ? await repository.findSource(existingId) : null;
      if (existingId && !existing) throw new AlertSourceNotFoundError();
      if (input.credentialKind === "hmac-sha256" && !input.signingSecret && (!existing || existing.credentialKind !== "hmac-sha256" || !existing.signingSecret)) throw new Error("An HMAC source requires a signing secret.");
      if (input.credentialKind === "bearer-token" && !input.bearerToken && (!existing || existing.credentialKind !== "bearer-token" || !existing.bearerTokenHash)) throw new Error("A bearer source requires a bearer token.");
      const timestamp = nowIso();
      const source: AlertSourceRow = { id: existing?.id ?? createUlid(), name: input.name.trim(), credentialKind: input.credentialKind, signingSecret: input.credentialKind === "hmac-sha256" ? (input.signingSecret ?? existing?.signingSecret ?? null) : null, bearerTokenHash: input.credentialKind === "bearer-token" ? (input.bearerToken ? await hashOpaqueToken(input.bearerToken) : existing?.bearerTokenHash ?? null) : null, timestampHeader: (input.timestampHeader ?? existing?.timestampHeader ?? "x-lamp-timestamp").toLowerCase(), signatureHeader: (input.signatureHeader ?? existing?.signatureHeader ?? "x-lamp-signature").toLowerCase(), deduplicationPath: input.deduplicationPath, titlePath: input.titlePath, statePath: input.statePath, recoveredValue: input.recoveredValue ?? existing?.recoveredValue ?? "recovered", createdByOperatorId: existing?.createdByOperatorId ?? operatorId, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      await repository.upsertSource(source);
      return sourceView(source);
    },
    async authenticate(sourceId, request) {
      const source = await repository.findSource(sourceId);
      if (!source) throw new AlertSourceNotFoundError();
      const rawBody = await request.text();
      if (source.credentialKind === "hmac-sha256") {
        const timestamp = request.headers.get(source.timestampHeader);
        const signature = request.headers.get(source.signatureHeader);
        if (!validTimestamp(timestamp) || !signature || !source.signingSecret || !constantTimeEqual(await hmacSha256(source.signingSecret, `${timestamp}.${rawBody}`), signature)) throw new UnauthorizedAlertError();
      } else {
        const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
        if (!token || !source.bearerTokenHash || !constantTimeEqual(await hashOpaqueToken(token), source.bearerTokenHash)) throw new UnauthorizedAlertError();
      }
      return { source, rawBody };
    },
    async acceptVerified(request) {
      const { source, rawBody } = request;
      const sourceId = source.id;
      const requestHash = await hashOpaqueToken(rawBody);
      const replay = await repository.findReceipt(sourceId, requestHash);
      if (replay) return { status: replay.state === "invalid" ? 400 : 202, receiptId: replay.id, incidentId: replay.incidentId, replayed: true };
      const timestamp = nowIso();
      let parsed: unknown;
      try { parsed = JSON.parse(rawBody) as unknown; }
      catch {
        const receipt: AlertReceiptRow = { id: createUlid(), sourceId, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: "Alert payload must be JSON.", createdAt: timestamp, updatedAt: timestamp };
        await repository.recordInvalid(receipt);
        return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
      }
      const deduplicationValue = readPath(parsed, source.deduplicationPath);
      if (typeof deduplicationValue !== "string" || !deduplicationValue.trim()) {
        const receipt: AlertReceiptRow = { id: createUlid(), sourceId, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: "The configured deduplication path did not produce a string.", createdAt: timestamp, updatedAt: timestamp };
        await repository.recordInvalid(receipt); return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
      }
      const key = deduplicationValue.trim(); const state = readPath(parsed, source.statePath); const recovered = state === source.recoveredValue;
      const existingIncidentId = await repository.findOpenIncident(sourceId, key);
      const createsDraft = !recovered && !existingIncidentId && policy.createsDraft({ sourceId, deduplicationKey: key, recovered });
      const incident = createsDraft ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: typeof readPath(parsed, source.titlePath) === "string" ? String(readPath(parsed, source.titlePath)).trim().slice(0, 250) || "Alert requiring review" : "Alert requiring review", operatorId: source.createdByOperatorId, timestamp } : null;
      const receipt: AlertReceiptRow = { id: createUlid(), sourceId, requestHash, deduplicationKey: key, incidentId: existingIncidentId ?? incident?.id ?? null, state: recovered ? "recovered" : "firing", receivedAt: timestamp, recoveredAt: recovered ? timestamp : null, payloadJson: rawBody, error: null, createdAt: timestamp, updatedAt: timestamp };
      const recorded = await repository.recordReceipt(receipt, incident);
      if (recorded.replayed) return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: true };
      if (recovered) await repository.markRecovered(sourceId, key, timestamp);
      if (recorded.incidentCreated && recorded.receipt.incidentId) await onDraftCreated(recorded.receipt.incidentId);
      await events?.alertAccepted({ sourceId, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: recorded.receipt.receivedAt });
      return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: false };
    },
    async accept(sourceId, request) {
      return this.acceptVerified(await this.authenticate(sourceId, request));
    },
  };
}
export class UnauthorizedAlertError extends Error {}
export class AlertSourceNotFoundError extends Error {}
