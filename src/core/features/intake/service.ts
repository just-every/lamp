import { acceptOperationsAlert } from "./operations-service";
import { isOperationsPreset, atlassianSite } from "./vendor-alerts";
import { acceptPagerDuty } from "./pagerduty-service";
import { verifyPagerDuty } from "./pagerduty";
import { sealUrl, sealingSecrets } from "../channels/sealing";
import type { MonitorMapping } from "./uptime";
import { isGroupedPreset, type LabelMatcher } from "./grouped-alerts";
import { acceptGroupedAlert } from "./grouped-service";
import { createUlid, nowIso } from "../../shared/ids";
import type { LampEventDispatcher } from "../../api/extensions";
import { constantTimeEqual, createOpaqueToken, hashOpaqueToken, hmacSha256 } from "../../platform/security/opaque-tokens";
import { readPath } from "./alert-title";
import { readPreset, type AlertPreset } from "./presets";
import { defaultAlertIntakePolicy, type AlertIntakePolicy } from "./policies";
import type { AlertReceiptRow, AlertReceiptView, AlertSourceActivity, AlertSourceRow, IntakeRepository } from "./repository";

export interface AlertSourceInput { name: string; preset?: AlertPreset; operationsApiKey?: string; atlassianSite?: string; atlassianEmail?: string; closeAlertOnResolve?: boolean; pagerDutyApiKey?: string; pagerDutyFromEmail?: string; monitorMappings?: MonitorMapping[]; labelMatchers?: LabelMatcher[]; componentId?: string; credentialKind: AlertSourceRow["credentialKind"]; signingSecret?: string; bearerToken?: string; timestampHeader?: string; signatureHeader?: string; deduplicationPath: string; titlePath: string; statePath: string; recoveredValue?: string; }
export type AlertSourceView = Omit<AlertSourceRow, "signingSecret" | "bearerTokenHash" | "responderSealedCredentials" | "responderConnected"> & { closeAlertOnResolve: boolean; webhookConnected: boolean; responderConnection: "connected" | "reconnect" | "not-connected"; endpointPath: string; /** Shown once, when Lamp generated a preset's token. */ token?: string;
  /** In the listing only: the last delivery that arrived, and the monitors an Uptime source's own events named. */
  lastReceivedAt?: string | null; monitors?: Array<{ monitorId: string; monitorName: string; lastSeenAt: string }> };
/** The operator API's view: `endpointUrl` is on the public page host, the only host that routes `/api/intake/*`. */
export type AlertSourceEndpointView = AlertSourceView & { endpointUrl: string };
export interface IntakeResult { status: 202 | 400; receiptId: string; incidentId: string | null; replayed: boolean; }
export interface VerifiedAlertRequest { source: AlertSourceRow; rawBody: string; }
export interface IntakeService { deleteSource(sourceId: string, operatorId: string): Promise<boolean>; listSources(): Promise<AlertSourceView[]>; listReceipts(limit?: number): Promise<AlertReceiptView[]>; saveSource(input: AlertSourceInput, operatorId: string, existingId?: string): Promise<AlertSourceView>; authenticate(sourceId: string, request: Request, pathToken?: string): Promise<VerifiedAlertRequest>; acceptVerified(request: VerifiedAlertRequest): Promise<IntakeResult>; accept(sourceId: string, request: Request): Promise<IntakeResult>; }

function sourceView(source: AlertSourceRow): AlertSourceView {
  const { signingSecret: _secret, bearerTokenHash: _hash, responderSealedCredentials: _sealed, responderConnected: _connected, ...view } = source;
  return { ...view, closeAlertOnResolve: source.closeAlertOnResolve ?? false, webhookConnected: source.credentialKind === "hmac-sha256" ? Boolean(_secret) : Boolean(_hash), responderConnection: _sealed ? "connected" : _connected ? "reconnect" : "not-connected", endpointPath: `/api/intake/${source.id}` };
}

function withActivity(source: AlertSourceView, activity: AlertSourceActivity): AlertSourceView {
  const lastReceivedAt = activity.deliveries.find(row => row.sourceId === source.id)?.lastReceivedAt ?? null;
  if (source.preset !== "uptime") return { ...source, lastReceivedAt };
  return { ...source, lastReceivedAt, monitors: activity.monitors.filter(row => row.sourceId === source.id).map(({ sourceId: _source, ...monitor }) => monitor) };
}

function validTimestamp(value: string | null) { const instant = value ? new Date(value).getTime() : Number.NaN; return Number.isFinite(instant) && Math.abs(Date.now() - instant) <= 5 * 60 * 1000; }

export function createIntakeService(
  repository: IntakeRepository,
  policy: AlertIntakePolicy = defaultAlertIntakePolicy,
  onDraftCreated: (incidentId: string) => Promise<void>,
  events?: Pick<LampEventDispatcher, "alertAccepted">,
  options: { webhookSecret?: string; onAccepted?: (source: AlertSourceRow, receipt: AlertReceiptRow, payload: unknown) => Promise<void>; onSourceDeleted?: () => Promise<void> } = {},
): IntakeService {
  async function acceptPreset(source: AlertSourceRow, requestHash: string, rawBody: string, parsed: unknown, timestamp: string): Promise<IntakeResult> {
    let reading = readPreset(source.preset!, parsed);
    const monitorId = "refused" in reading ? undefined : reading.monitorId;
    const mappedComponentId = !("refused" in reading) && source.preset === "uptime" ? source.monitorMappings?.find(row => row.monitorId === monitorId)?.componentId : source.componentId;
    if (!("refused" in reading) && source.preset === "uptime" && !mappedComponentId) reading = { refused: "Monitor not picked yet. Pick its component under Uptime." };
    const entityNames="refused" in reading?[]:reading.entityNames??[];
    if (!("refused" in reading) && source.preset === "newrelic" && source.labelMatchers?.length && !source.labelMatchers.some(row => entityNames.includes(row.labels.entity_name))) reading = { refused: "New Relic entity not mapped to this component." };
    if ("refused" in reading) {
      const receipt: AlertReceiptRow = { sourceVersion: source.updatedAt, id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: reading.refused, createdAt: timestamp, updatedAt: timestamp };
      await repository.recordInvalid(receipt);
      return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
    }
    const existingIncidentId = await repository.findOpenIncident(source.id, reading.key);
    const createsDraft = !reading.recovered && !existingIncidentId && policy.createsDraft({ sourceId: source.id, deduplicationKey: reading.key, recovered: false });
    const incident = createsDraft ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: reading.title, operatorId: source.createdByOperatorId, timestamp, ...(mappedComponentId ? { component: { id: mappedComponentId, state: reading.state } } : {}) } : null;
    const receipt: AlertReceiptRow = { sourceVersion: source.updatedAt, id: createUlid(), sourceId: source.id, requestHash, deduplicationKey: reading.key, incidentId: existingIncidentId ?? incident?.id ?? null, state: reading.recovered ? "recovered" : "firing", receivedAt: timestamp, recoveredAt: reading.recovered ? timestamp : null, payloadJson: rawBody, error: null, createdAt: timestamp, updatedAt: timestamp };
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
    async deleteSource(sourceId, operatorId) {
      const result=await repository.deleteSource(sourceId,operatorId,nowIso());
      if(result.deleted && result.publicChanged)await options.onSourceDeleted?.();
      return result.deleted;
    },
    async listSources() {
      const [sources, activity] = await Promise.all([repository.listSources(), repository.listActivity()]);
      return sources.map(source => withActivity(sourceView(source), activity));
    },
    async listReceipts(limit = 100) { return repository.listReceipts(Math.min(Math.max(limit, 1), 250)); },
    async saveSource(input, operatorId, existingId) {
      const existing = existingId ? await repository.findSource(existingId) : null;
      if (existingId && !existing) throw new AlertSourceNotFoundError();
      // A preset reads its tool's own payload, so its paths only describe that shape.
      let generated: string | undefined;
      if (input.preset) {
        // Uptime connects before any monitor is mapped: the owner picks from the monitors its own events name.
        if (input.preset !== "uptime" && ((isGroupedPreset(input.preset) || input.preset === "pagerduty" || isOperationsPreset(input.preset)) ? !input.labelMatchers?.length : !input.componentId)) throw new Error("A monitor preset needs its component or label-to-component mappings.");
        if (input.preset === "uptime" && new Set((input.monitorMappings ?? []).map(row => row.monitorId)).size !== (input.monitorMappings ?? []).length) throw new Error("Map each Uptime monitor only once.");
        // Uptime makes its own signing secret. Without that secret, Uptime is paired by a key Lamp makes, carried in the address Uptime keeps sealed.
        const credentialKind = input.preset === "pagerduty" ? "hmac-sha256" : input.preset === "uptime" ? input.credentialKind : "bearer-token";
        if (credentialKind === "bearer-token" && !input.bearerToken && !existing?.bearerTokenHash) generated = createOpaqueToken();
        input = { ...input, credentialKind, bearerToken: input.bearerToken ?? generated, ...(input.preset === "pagerduty" ? { timestampHeader: "unused", signatureHeader: "x-pagerduty-signature" } : {}), ...(input.preset === "uptime" ? { timestampHeader: "x-lamp-timestamp", signatureHeader: "x-lamp-signature" } : {}), deduplicationPath: `preset:${input.preset}`, titlePath: `preset:${input.preset}`, statePath: `preset:${input.preset}` };
      }
      if (!input.name.trim() || !input.deduplicationPath || !input.titlePath || !input.statePath) throw new Error("A source name and all three JSON paths are required.");
      if (input.preset !== "pagerduty" && input.credentialKind === "hmac-sha256" && !input.signingSecret && (!existing || existing.credentialKind !== "hmac-sha256" || !existing.signingSecret)) throw new Error("An HMAC source requires a signing secret.");
      if (input.credentialKind === "bearer-token" && !input.bearerToken && (!existing || existing.credentialKind !== "bearer-token" || !existing.bearerTokenHash)) throw new Error("A bearer source requires a bearer token.");
      if (input.preset === "pagerduty" && input.labelMatchers?.some(row => Object.keys(row.labels).some(key => key !== "service_id" && key !== "service_name"))) throw new Error("PagerDuty matchers use service_id or service_name.");
      if (input.preset === "newrelic" && input.labelMatchers?.some(row => row.componentId !== input.componentId || Object.keys(row.labels).some(key => key !== "entity_name") || !row.labels.entity_name?.trim())) throw new Error("New Relic entity names map to this source's selected component.");
      if (input.pagerDutyApiKey && input.preset !== "pagerduty") throw new Error("A PagerDuty API key needs a PagerDuty preset.");
      if (isOperationsPreset(input.preset) && input.labelMatchers?.some(row => Object.keys(row.labels).some(key => !["tag", "entity", "affected_service"].includes(key)))) throw new Error("Matchers use tag, entity or affected_service.");
      if (isOperationsPreset(input.preset) && input.labelMatchers?.some(row => Object.values(row.labels).some(value => !value.trim()))) throw new Error("Matcher values cannot be blank.");
      if (input.preset === "opsgenie" && input.labelMatchers?.some(row => "affected_service" in row.labels)) throw new Error("Affected-service matchers require JSM Operations.");
      if (input.operationsApiKey && !isOperationsPreset(input.preset)) throw new Error("Operations credentials need a JSM or Opsgenie preset.");
      const sourceId = existing?.id ?? createUlid();
      let sealed = existing?.preset === input.preset ? existing?.responderSealedCredentials ?? null : null;
      if (input.pagerDutyApiKey) {
        const fromEmail = input.pagerDutyFromEmail ?? await repository.operatorEmail(existing?.createdByOperatorId ?? operatorId);
        if (!fromEmail) throw new Error("Provide a PagerDuty user email for note authorship.");
        sealed = await sealUrl(JSON.stringify({ apiKey: input.pagerDutyApiKey, fromEmail }), sourceId, sealingSecrets(options.webhookSecret));
      }
      if (input.operationsApiKey) {
        let credentials: { apiKey: string; site?: string; email?: string; cloudId?: string } = { apiKey: input.operationsApiKey };
        if (input.preset === "jsm") {
          const site = atlassianSite(input.atlassianSite ?? "");
          const response = await fetch(`${site}/_edge/tenant_info`, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
          if (!response.ok) { await response.body?.cancel(); throw new Error("The Atlassian site could not be checked."); }
          const tenant = await response.json() as { cloudId?: unknown };
          if (typeof tenant.cloudId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant.cloudId)) throw new Error("The Atlassian site did not identify a cloud installation.");
          credentials = { apiKey: input.operationsApiKey, site, email: input.atlassianEmail, cloudId: tenant.cloudId };
        }
        if (input.preset === "jsm" && !input.atlassianEmail) throw new Error("JSM needs the Atlassian account email.");
        sealed = await sealUrl(JSON.stringify(credentials), sourceId, sealingSecrets(options.webhookSecret));
      }
      const timestamp = new Date(Math.max(Date.now(),existing ? Date.parse(existing.updatedAt)+1:0)).toISOString();
      // An endpoint awaiting PagerDuty's generated secret stores empty text; authentication refuses it.
      const source: AlertSourceRow = { id: sourceId, closeAlertOnResolve: input.closeAlertOnResolve ?? existing?.closeAlertOnResolve ?? false, responderSealedCredentials: sealed, responderConnected: Boolean(sealed || (existing?.preset === input.preset && existing?.responderConnected)), name: input.name.trim(), credentialKind: input.credentialKind, signingSecret: input.credentialKind === "hmac-sha256" ? (input.signingSecret ?? existing?.signingSecret ?? (input.preset === "pagerduty" ? "" : null)) : null, bearerTokenHash: input.credentialKind === "bearer-token" ? (input.bearerToken ? await hashOpaqueToken(input.bearerToken) : existing?.bearerTokenHash ?? null) : null, timestampHeader: (input.timestampHeader ?? existing?.timestampHeader ?? "x-lamp-timestamp").toLowerCase(), signatureHeader: (input.signatureHeader ?? existing?.signatureHeader ?? "x-lamp-signature").toLowerCase(), deduplicationPath: input.deduplicationPath, titlePath: input.titlePath, statePath: input.statePath, recoveredValue: input.recoveredValue ?? existing?.recoveredValue ?? "recovered", monitorMappings: input.preset === "uptime" ? input.monitorMappings ?? [] : [], labelMatchers: (isGroupedPreset(input.preset) || input.preset === "pagerduty" || input.preset === "newrelic" || isOperationsPreset(input.preset)) ? input.labelMatchers : [], preset: input.preset ?? null, componentId: input.preset ? input.componentId ?? null : null, createdByOperatorId: existing?.createdByOperatorId ?? operatorId, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp };
      try { await repository.upsertSource(source); }
      catch (cause) {
        // Source names are unique (alert_sources.name); say so instead of passing on the storage error.
        if (cause instanceof Error && cause.message.includes("UNIQUE constraint failed: alert_sources.name")) throw new Error("Another connected tool already has this name.");
        throw cause;
      }
      return generated ? { ...sourceView(source), token: generated } : sourceView(source);
    },
    async authenticate(sourceId, request, pathToken) {
      const source = await repository.findSource(sourceId);
      if (!source) throw new AlertSourceNotFoundError();
      const rawBytes = new Uint8Array(await request.arrayBuffer());
      if (source.preset === "pagerduty") {
        if (!source.signingSecret || !await verifyPagerDuty(source.signingSecret, rawBytes, request.headers.get("x-pagerduty-signature"))) throw new UnauthorizedAlertError();
      } else if (source.credentialKind === "hmac-sha256") {
        const timestamp = request.headers.get(source.timestampHeader);
        const signature = request.headers.get(source.signatureHeader);
        if (!validTimestamp(timestamp) || !signature || !source.signingSecret) throw new UnauthorizedAlertError();
        // Authenticate the timestamp prefix and received bytes before decoding.
        // TextDecoder may discard a BOM or replace invalid UTF-8 for JSON parsing.
        const prefix = new TextEncoder().encode(`${timestamp}.`);
        const signedBytes = new Uint8Array(prefix.length + rawBytes.length);
        signedBytes.set(prefix);
        signedBytes.set(rawBytes, prefix.length);
        if (!constantTimeEqual(await hmacSha256(source.signingSecret, signedBytes.buffer), signature)) throw new UnauthorizedAlertError();
      } else {
        // Tools that cannot send a header present a preset's token as the endpoint's last path segment.
        const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? (source.preset && !isOperationsPreset(source.preset) ? pathToken : undefined);
        if (pathToken !== undefined && !source.preset) throw new UnauthorizedAlertError();
        if (!token || !source.bearerTokenHash || !constantTimeEqual(await hashOpaqueToken(token), source.bearerTokenHash)) throw new UnauthorizedAlertError();
        // A paired Uptime still stamps each event; a stale or missing stamp is refused like a stale signature.
        if (source.preset === "uptime" && !validTimestamp(request.headers.get(source.timestampHeader))) throw new UnauthorizedAlertError();
      }
      return { source, rawBody: new TextDecoder().decode(rawBytes) };
    },
    async acceptVerified(request) {
      const accept = async (): Promise<IntakeResult> => {
      const { source, rawBody } = request;
      const sourceId = source.id;
      const requestHash = await hashOpaqueToken(rawBody);
      const replay = await repository.findReceipt(sourceId, requestHash);
      if (replay) return { status: replay.state === "invalid" ? 400 : 202, receiptId: replay.id, incidentId: replay.incidentId, replayed: true };
      const timestamp = nowIso();
      let parsed: unknown;
      try { parsed = JSON.parse(rawBody) as unknown; }
      catch {
        const receipt: AlertReceiptRow = { sourceVersion: source.updatedAt, id: createUlid(), sourceId, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: "Alert payload must be JSON.", createdAt: timestamp, updatedAt: timestamp };
        await repository.recordInvalid(receipt);
        return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
      }
      if (isOperationsPreset(source.preset)) return acceptOperationsAlert({ repository, source, requestHash, rawBody, parsed, timestamp, policy, onDraftCreated, events });
      if (source.preset === "pagerduty") return acceptPagerDuty({ repository, source, requestHash, rawBody, parsed, timestamp, policy, onDraftCreated, events });
      if (isGroupedPreset(source.preset)) return acceptGroupedAlert({ repository, source, preset: source.preset, requestHash, rawBody, parsed, timestamp, policy, onDraftCreated, events });
      if (source.preset) return acceptPreset(source, requestHash, rawBody, parsed, timestamp);
      const deduplicationValue = readPath(parsed, source.deduplicationPath);
      if (typeof deduplicationValue !== "string" || !deduplicationValue.trim()) {
        const receipt: AlertReceiptRow = { sourceVersion: source.updatedAt, id: createUlid(), sourceId, requestHash, deduplicationKey: null, incidentId: null, state: "invalid", receivedAt: timestamp, recoveredAt: null, payloadJson: rawBody, error: "The configured deduplication path did not produce a string.", createdAt: timestamp, updatedAt: timestamp };
        await repository.recordInvalid(receipt); return { status: 400, receiptId: receipt.id, incidentId: null, replayed: false };
      }
      const key = deduplicationValue.trim(); const state = readPath(parsed, source.statePath); const recovered = state === source.recoveredValue;
      const existingIncidentId = await repository.findOpenIncident(sourceId, key);
      const createsDraft = !recovered && !existingIncidentId && policy.createsDraft({ sourceId, deduplicationKey: key, recovered });
      const incident = createsDraft ? { id: createUlid(), reference: await repository.allocateIncidentReference(), title: typeof readPath(parsed, source.titlePath) === "string" ? String(readPath(parsed, source.titlePath)).trim().slice(0, 250) || "Alert requiring review" : "Alert requiring review", operatorId: source.createdByOperatorId, timestamp } : null;
      const receipt: AlertReceiptRow = { sourceVersion: source.updatedAt, id: createUlid(), sourceId, requestHash, deduplicationKey: key, incidentId: existingIncidentId ?? incident?.id ?? null, state: recovered ? "recovered" : "firing", receivedAt: timestamp, recoveredAt: recovered ? timestamp : null, payloadJson: rawBody, error: null, createdAt: timestamp, updatedAt: timestamp };
      const recorded = await repository.recordReceipt(receipt, incident);
      if (recorded.replayed) return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: true };
      if (recovered) await repository.markRecovered(sourceId, key, timestamp);
      if (recorded.incidentCreated && recorded.receipt.incidentId) await onDraftCreated(recorded.receipt.incidentId);
      await events?.alertAccepted({ sourceId, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, acceptedAt: recorded.receipt.receivedAt });
      return { status: 202, receiptId: recorded.receipt.id, incidentId: recorded.receipt.incidentId, replayed: false };
      };
      const result = await accept();
      if(result.status===202 && options.onAccepted) {
        const receipt = await repository.findReceipt(request.source.id, await hashOpaqueToken(request.rawBody));
        if(receipt)await options.onAccepted(request.source,receipt,JSON.parse(request.rawBody) as unknown);
      }
      return result;
    },
    async accept(sourceId, request) {
      return this.acceptVerified(await this.authenticate(sourceId, request));
    },
  };
}
export class UnauthorizedAlertError extends Error {}
export class AlertSourceNotFoundError extends Error {}
