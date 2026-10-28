import type { AggregatePoint } from "../types.ts";

export interface QueryWindow { from: number; to: number }
export interface ProviderContext { window: QueryWindow; signal: AbortSignal }
export const MINUTE = 60_000;
export const MAX_POINTS = 1_440;
export const MAX_SAMPLES = 10_000;

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The metric provider returned a malformed response.");
  return value as Record<string, unknown>;
}

export function list(value: unknown, max = MAX_SAMPLES): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("The metric provider returned an invalid or oversized result.");
  return value;
}

export function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("The metric provider returned an invalid timestamp.");
  return value;
}

export function secondsTimestamp(value: unknown): number {
  return timestamp(timestamp(value) * 1000);
}

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("The metric provider returned an invalid value.");
  return value;
}

/** One reported series, reduced to observed UTC minutes without filling any gaps. */
export class MinutePoints {
  private readonly buckets = new Map<number, { mean: number; count: number }>();
  private samples = 0;
  constructor(private readonly window: QueryWindow) {}

  add(at: number, value: number | null) {
    if (++this.samples > MAX_SAMPLES) throw new Error("The metric provider returned too many samples.");
    if (value === null || at < this.window.from || at >= this.window.to) return;
    const minute = Math.floor(at / MINUTE) * MINUTE;
    const existing = this.buckets.get(minute);
    if (existing) {
      const count = existing.count + 1;
      // Weighted form avoids overflowing a sum of otherwise finite observations.
      existing.mean = existing.mean * (existing.count / count) + value / count;
      existing.count = count;
    } else this.buckets.set(minute, { mean: value, count: 1 });
    if (this.buckets.size > MAX_POINTS) throw new Error("The metric provider returned too many minute points.");
  }

  result(): AggregatePoint[] {
    return [...this.buckets].sort(([left], [right]) => left - right).map(([at, { mean }]) => {
      if (!Number.isFinite(mean)) throw new Error("The metric provider returned an invalid aggregate.");
      return { at, value: mean };
    });
  }
}

/** Never include a provider response, URL, query or key in an exception. */
export async function requestJson(url: URL, init: RequestInit, signal: AbortSignal, maxBytes = 1_048_576): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url.href, { ...init, redirect: "manual", signal }); }
  catch { throw new Error(signal.aborted ? "The metric provider timed out." : "The metric provider could not be reached."); }
  if (!response.ok || response.status >= 300 || response.redirected) {
    await response.body?.cancel();
    throw new Error(`The metric provider refused the request (HTTP ${response.status}).`);
  }
  if (Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("The metric provider response is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The metric provider returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("The metric provider response is too large.");
      }
      chunks.push(value);
    }
  } catch {
    throw new Error(signal.aborted ? "The metric provider timed out." : "The metric provider response could not be read within its size limit.");
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("The metric provider returned invalid JSON."); }
}
