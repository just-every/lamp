import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { isPublicAddress, validateDestination } from './destination.ts';
import type { TrustedTransport, WireRequest, WireResponse } from './types.ts';

/** Resolves once, validates EVERY answer, and pins that address to the TLS connection's lookup.
 * TLS SNI/certificate verification still uses the original hostname; no redirect is followed. */
export class NodePinnedTransport implements TrustedTransport {
  private timeoutMs: number;
  private maxResponseBytes: number;
  constructor(options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 15000; this.maxResponseBytes = options.maxResponseBytes ?? 65536;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30000 || !Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1 || this.maxResponseBytes > 1048576) throw new Error('Invalid transport limits');
  }
  async send(wire: WireRequest): Promise<WireResponse> {
    const url = validateDestination(wire.url);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), this.timeoutMs); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Destination DNS is not public');
    const pinned = addresses[0]!;
    for (const name of Object.keys(wire.headers)) if (/^(host|connection|transfer-encoding|content-length|proxy-authorization)$/i.test(name)) throw new Error('Forbidden transport header');
    return new Promise((resolve, reject) => {
      let settled = false, response: IncomingMessage | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: Error) => {
        if (settled) return;
        // Reject synchronously before destroy can race a queued response end event.
        settled = true; clearTimeout(timer); reject(error);
        response?.destroy(); req.destroy();
      };
      const req = request(url, {
        method: 'POST', agent: false, rejectUnauthorized: true,
        headers: { ...wire.headers, 'content-length': Buffer.byteLength(wire.body) },
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      }, res => {
        response = res;
        if (settled) { res.destroy(); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > this.maxResponseBytes) fail(new Error('Response limit exceeded'));
          else chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('Response aborted')));
        res.on('close', () => { if (!res.complete) fail(new Error('Response incomplete')); });
        res.on('end', () => {
          if (settled) return;
          if (!res.complete) { fail(new Error('Response incomplete')); return; }
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
          settled = true; clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      });
      timer = setTimeout(() => fail(new Error('Transport timeout')), this.timeoutMs);
      req.on('close', () => { if (!settled) fail(new Error('Transport closed')); });
      req.on('error', fail);
      req.end(wire.body);
    });
  }
}
