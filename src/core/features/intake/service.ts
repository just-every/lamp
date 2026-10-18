import { isGroupedPreset, type LabelMatcher } from "./grouped-alerts";
import { acceptGroupedAlert } from "./grouped-service";
import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import { constantTimeEqual, createOpaqueToken, hashOpaqueToken, hmacSha256 } from "../../platform/security/opaque-tokens";
import { readPath } from "./alert-title";
import { readPreset, type AlertPreset } from "./presets";
import { defaultAlertIntakePolicy, type AlertIntakePolicy } from "./policies";
import type { AlertReceiptRow, AlertReceiptView, AlertSourceRow, IntakeRepository } from "./repository";

export interface AlertSourceInput { name: string; preset?: AlertPreset; labelMatchers?: LabelMatcher[]; componentId?: string; credentialKind: AlertSourceRow["credentialKind"]; signingSecret?: string; bearerToken?: string; timestampHeader?: string; signatureHeader?: string; deduplicationPath: string; titlePath: string; statePath: string; recoveredValue?: string; }
export type AlertSourceView = Omit<AlertSourceRow, "signingSecret" | "bearerTokenHash"> & { endpointPath: string; /** Shown once, when Lamp generated a preset's token. */ token?: string };
/** The operator API's view: `endpointUrl` is on the public page host, the only host that routes `/api/intake/*`. */
export type AlertSourceEndpointView = AlertSourceView & { endpointUrl: string };
export interface IntakeResult { status: 202 | 400; receiptId: string; incidentId: string | null; replayed: boolean; }
export interface VerifiedAlertRequest { source: AlertSourceRow; rawBody: string; }
export interface IntakeService { listSources(): Promise<AlertSourceView[]>; listReceipts(limit?: number): Promise<AlertReceiptView[]>; saveSource(input: AlertSourceInput, operatorId: string, existingId?: string): Promise<AlertSourceView>; authenticate(sourceId: string, request: Request, pathToken?: string): Promise<VerifiedAlertRequest>; acceptVerified(request: VerifiedAlertRequest): Promise<IntakeResult>; accept(sourceId: string, request: Request): Promise<IntakeResult>; }

function sourceView(source: AlertSourceRow): AlertSourceView {
  const { signingSecret: _secret, bearerTokenHash: _hash, ...view } = source;
  return { ...view, endpointPath: `/api/intake/${source.id}` };
}

function validTimestamp(value: string | null) { const instant = value ? new Date(value).getTime() : Number.NaN; return Number.isFinite(instant) && Math.abs(Date.now() - instant) <= 5 * 60 * 1000; }

export function createIntakeService(
  repository: IntakeRepository,
  policy: AlertIntakePolicy = defaultAlertIntakePolicy,
  onDraftCreated: (incidentId: string) => Promise<void>,
  events?: Pick<LampEventDispatcher, "alertAccepted">,
): IntakeService {
  async function acceptPreset(source: AlertSourceRow, requestHash: string, rawBody: string, parsed: unknown, timestamp: string): Promise<IntakeResult> {
    const reading = readPreset(source.preset!, parsed);
    if ("refused" in reading) {
      const receipt: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: reading.refused, createdAt: timestamp, updatedAt: timestamp };
      await repository.recordInvalid(receipt);
      return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
    }
    const existingIncidentId = await repository.findOpenIncident(source.id, reading.key);
    const createsDraft = !reading.recovered && !existingIncidentId && policy.createsDraft({ sourceId: source.id, deduplicationKey: reading.key, recovered: false });
    const incident = createsDraft ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: reading.title, operatorId: source.createdByOperatorId, timestamp, ...(source.componentId ? { component: { id: source.componentId, state: reading.state } } : {}) } : null;
    const receipt: AlertReceiptRow = { id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: reading.key, incidentId: existingIncidentId ?? incident?.id ?? null, state: reading.recovered ? "recovered" : "firing", receivedAt: timestamp, recoveredAt: reading.recovered ? timestamp : null, payloadJson: rawBody, error: null, createdAt: timestamp, updatedAt: timestamp };
    const recorded = await repository.recordReceipt(receipt, incident);
    if (recorded.replayed) return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: true };
    if (reading.recovered) {
      await repository.markRecovered(source.id, reading.key, timestamp);
      if (recorded.receipt.incidentId) await repository.resolveUnpublishedDraft(recorded.receipt.incidentId, timestamp);
    }
    if (recorded.incidentCreated && recorded.receipt.incidentId) await onDraftCreated(recorded.receipt.incidentId);
    await events?.alertAccepted({ sourceId: source.id, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: recorded.receipt.receivedAt });
    return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: false };
  }

  return {
    async listSources() { return (await repository.listSources()).map(sourceView); },
    async listReceipts(limit = 100) { return repository.listReceipts(Math.min(Math.max(limit, 1), 250)); },
    async saveSource(input, operatorId, existingId) {
      const existing = existingId ? await repository.findSource(existingId) : null;
      if (existingId && !existing) throw new AlertSourceNotFoundError();
      // A preset reads its tool's own payload, so its paths only describe that shape.
      let generated: string | undefined;
      if (input.preset) {
        if (isGroupedPreset(input.preset) ? !input.labelMatchers?.length : !input.componentId) throw new Error("A monitor preset needs its component or label-to-component mappings.");
        if (!input.bearerToken && !existing?.bearerTokenHash) generated = createOpaqueToken();
        input = { ...input, credentialKind: "bearer-token", bearerToken: input.bearerToken ?? generated, deduplicationPath: `preset:${input.preset}`, titlePath: `preset:${input.preset}`, statePath: `preset:${input.preset}` };
      }
      if (!input.name.trim() || !input.deduplicationPath || !input.titlePath || !input.statePath) throw new Error("A source name and all three JSON paths are required.");
      if (input.credentialKind === "hmac-sha256" && !input.signingSecret && (!existing || existing.credentialKind !== "hmac-sha256" || !existing.signingSecret)) throw new Error("An HMAC source requires a signing secret.");
      if (input.credentialKind === "bearer-token" && !input.bearerToken && (!existing || existing.credentialKind !== "bearer-token" || !existing.bearerTokenHash)) throw new Error("A bearer source requires a bearer token.");
      const timestamp = nowIso();
      const source: AlertSourceRow = { id: existing?.id ?? createUlid(), name: input.name.trim(), credentialKind: input.credentialKind, signingSecret: input.credentialKind === "hmac-sha256" ? (input.signingSecret ?? existing?.signingSecret ?? null) : null, bearerTokenHash: input.credentialKind === "bearer-token" ? (input.bearerToken ? await hashOpaqueToken(input.bearerToken) : existing?.bearerTokenHash ?? null) : null, timestampHeader: (input.timestampHeader ?? existing?.timestampHeader ?? "x-lamp-timestamp").toLowerCase(), signatureHeader: (input.signatureHeader ?? existing?.signatureHeader ?? "x-lamp-signature").toLowerCase(), deduplicationPath: input.deduplicationPath, titlePath: input.titlePath, statePath: input.statePath, recoveredValue: input.recoveredValue ?? existing?.recoveredValue ?? "recovered", labelMatchers: isGroupedPreset(input.preset) ? input.labelMatchers : [], preset: input.preset ?? null, componentId: input.preset ? input.componentId ?? null : null, createdByOperatorId: existing?.createdByOperatorId ?? operatorId, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      await repository.upsertSource(source);
      return generated ? { ...sourceView(source), token: generated } : sourceView(source);
    },
    async authenticate(sourceId, request, pathToken) {
      const source = await repository.findSource(sourceId);
      if (!source) throw new AlertSourceNotFoundError();
      const rawBody = await request.text();
      if (source.credentialKind === "hmac-sha256") {
        const timestamp = request.headers.get(source.timestampHeader);
        const signature = request.headers.get(source.signatureHeader);
        if (!validTimestamp(timestamp) || !signature || !source.signingSecret || !constantTimeEqual(await hmacSha256(source.signingSecret, `${timestamp}.${rawBody}`), signature)) throw new UnauthorizedAlertError();
      } else {
        // Tools that cannot send a header present a preset's token as the endpoint's last path segment.
        const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? (source.preset ? pathToken : undefined);
        if (pathToken !== undefined && !source.preset) throw new UnauthorizedAlertError();
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
      if (isGroupedPreset(source.preset)) return acceptGroupedAlert({ repository, source, preset: source.preset, requestHash, rawBody, parsed, timestamp, policy, onDraftCreated, events });
      if (source.preset) return acceptPreset(source, requestHash, rawBody, parsed, timestamp);
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
