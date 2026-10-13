import { assertCode, assertLabel, sha256 } from './crypto.ts';
import { validateDestination } from './destination.ts';
import { IntegrationsRepository, pickEnvelope } from './repository.ts';
import type { Delivery, DeliveryProtocol, Envelope, Outcome, TrustedTransport, WireRequest } from './types.ts';

export class DeliveryService {
  private repository: IntegrationsRepository;
  private protocols: Map<string, DeliveryProtocol>;
  private transport: TrustedTransport;
  private now: () => number;
  private hashDestination: (url: string) => Promise<string>;
  constructor(options: { repository: IntegrationsRepository; protocols: DeliveryProtocol[]; transport: TrustedTransport; now?: () => number; hashDestination?: (url: string) => Promise<string> }) {
    this.repository = options.repository; this.protocols = new Map(); this.transport = options.transport; this.now = options.now ?? Date.now;
    this.hashDestination = options.hashDestination ?? sha256;
    for (const protocol of options.protocols) { assertLabel(protocol.id); if (this.protocols.has(protocol.id)) throw new Error('Duplicate protocol'); this.protocols.set(protocol.id, protocol); }
  }
  private protocol(id: string) { const protocol = this.protocols.get(id); if (!protocol) throw new Error('Unknown delivery protocol'); return protocol; }
  private async destinationHash(url: string) {
    const hash = await this.hashDestination(url);
    if (typeof hash !== 'string' || !/^(?:[a-z][a-z0-9-]{0,15}:)?[0-9a-f]{64}(?![\s\S])/.test(hash)) throw new Error('Invalid destination hash');
    return hash;
  }
  private checkWire(wire: WireRequest, envelope: Envelope) {
    validateDestination(wire.url);
    if (wire.body !== envelope.body) throw new Error('Protocol changed immutable body');
    const bytes = new TextEncoder().encode(wire.body);
    if (bytes.length > 1048576 || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== wire.body) throw new Error('Delivery body must be bounded valid UTF-8');
  }
  async enqueue(input: Envelope, options: { maxAttempts?: number; retryDelaysMs?: number[] } = {}) {
    const envelope = pickEnvelope(input);
    for (const label of [envelope.id, envelope.tenant, envelope.destinationId, envelope.event, envelope.protocol]) assertLabel(label);
    if (envelope.tenant !== this.repository.namespace || typeof envelope.body !== 'string') throw new Error('Invalid envelope tenant or body');
    const maxAttempts = options.maxAttempts ?? 4, delays = options.retryDelaysMs ?? [1000, 5000, 30000];
    if (!Array.isArray(delays)) throw new Error('Invalid bounded retry policy');
    const retryDelaysMs = [...delays];
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || retryDelaysMs.length < maxAttempts - 1 || retryDelaysMs.some(d => !Number.isSafeInteger(d) || d < 1 || d > 86400000)) throw new Error('Invalid bounded retry policy');
    const now = this.now(); const wire = await this.protocol(envelope.protocol).prepare(envelope, now); this.checkWire(wire, envelope);
    const destinationHash = await this.destinationHash(wire.url);
    const fingerprint = await sha256(JSON.stringify({ envelope, destinationHash, maxAttempts, retryDelaysMs }));
    return this.repository.insert({ ...envelope, destinationHash, fingerprint, maxAttempts, retryDelaysMs: [...retryDelaysMs], state: 'queued', attempts: 0, createdAt: now, nextAt: now, claim: null, claimUntil: null });
  }
  get(id: string) { return this.repository.get(id); }
  log(id: string) { return this.repository.log(id); }
  recoverExpired() { return this.repository.recoverExpired(this.now()); }
  async resolveUncertain(id: string, kind: 'accepted' | 'rejected', evidenceCode: string) {
    assertCode(evidenceCode); if (kind !== 'accepted' && kind !== 'rejected') throw new Error('Invalid resolution');
    await this.repository.resolve(id, { kind, code: evidenceCode }, this.now());
    return this.get(id);
  }
  async dispatchDue(limit = 100): Promise<(Delivery | null)[]> {
    await this.recoverExpired();
    const results: (Delivery | null)[] = [];
    for (const id of await this.repository.due(this.now(), limit)) results.push(await this.dispatch(id));
    return results;
  }
  async dispatch(id: string): Promise<Delivery | null> {
    await this.recoverExpired();
    const claim = await this.repository.claim(id, this.now(), 60000);
    if (!claim) return this.get(id);
    const delivery = (await this.get(id))!;
    let outcome: Outcome;
    // Preflight failures provably happen before transport; no credential/error text enters the log.
    let wire: WireRequest;
    try {
      wire = await this.protocol(delivery.protocol).prepare(pickEnvelope(delivery), this.now());
      this.checkWire(wire, delivery);
      if (await this.destinationHash(wire.url) !== delivery.destinationHash) throw new Error('Destination changed');
    } catch {
      outcome = { kind: 'rejected', code: 'preflight_failed' };
      if (!await this.repository.finish(id, claim, outcome, this.now(), null)) await this.recoverExpired();
      return this.get(id);
    }
    // Preparing a destination can yield. Recheck the durable claim before starting
    // an external effect; expired or reconciled work must never start a late send.
    const current = await this.get(id);
    if (!current || current.state !== 'sending' || current.claim !== claim || current.claimUntil! <= this.now()) {
      await this.recoverExpired();
      return this.get(id);
    }
    try {
      const response = await this.transport.send(wire);
      outcome = this.protocol(delivery.protocol).classify(response, this.now());
      if (!['accepted', 'rejected', 'retryable', 'uncertain'].includes(outcome.kind)) throw new Error('Invalid classification');
      assertCode(outcome.code);
      if (outcome.status !== undefined && (!Number.isInteger(outcome.status) || outcome.status < 100 || outcome.status > 599)) throw new Error('Invalid status');
      if (outcome.retryAfterMs !== undefined && (!Number.isFinite(outcome.retryAfterMs) || outcome.retryAfterMs < 0)) throw new Error('Invalid retry delay');
      if (outcome.kind === 'retryable' && (outcome.retryAfterMs ?? 0) > 86400000) outcome = { kind: 'rejected', code: 'retry_delay_exceeded', status: outcome.status };
      outcome = { kind: outcome.kind, code: outcome.code, ...(outcome.status === undefined ? {} : { status: outcome.status }), ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }) };
    } catch { outcome = { kind: 'uncertain', code: 'response_unknown' }; }
    const now = this.now();
    const nextAt = outcome.kind === 'retryable' && delivery.attempts < delivery.maxAttempts
      ? now + Math.max(delivery.retryDelaysMs[delivery.attempts - 1]!, (outcome.retryAfterMs ?? 0)) : null;
    // Storage failures propagate; a still-held claim later recovers as uncertain, never a replay.
    if (!await this.repository.finish(id, claim, outcome, now, nextAt)) await this.recoverExpired();
    return this.get(id);
  }
}
