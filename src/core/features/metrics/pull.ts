import type { AggregatePoint, MetricCredentials, PullQuery } from "./types.ts";
import { MINUTE, MAX_POINTS, type QueryWindow } from "./providers/common.ts";
import { datadog } from "./providers/datadog.ts";
import { newrelic } from "./providers/newrelic.ts";
import { pingdom } from "./providers/pingdom.ts";
import { prometheus } from "./providers/prometheus.ts";

/** Pull only complete UTC minutes, at most one day, with one shared 10s deadline. */
export async function queryMetric(input: PullQuery, credentials: MetricCredentials, window: QueryWindow): Promise<AggregatePoint[]> {
  if (!Number.isSafeInteger(window.from) || !Number.isSafeInteger(window.to) || window.from < 0 || window.to <= window.from || window.to - window.from > MAX_POINTS * MINUTE) {
    throw new Error("Metric pulls need a time window of at most one day.");
  }
  if (!input.query.trim() || input.query.length > 4096) throw new Error("Metric queries must contain between 1 and 4096 characters.");
  if (!credentials.key || credentials.key.length > 8192 || /[\r\n]/.test(credentials.key)
    || credentials.applicationKey !== undefined && (!credentials.applicationKey || credentials.applicationKey.length > 8192 || /[\r\n]/.test(credentials.applicationKey))) {
    throw new Error("Connect a valid read-only metric provider key.");
  }
  if (input.provider !== "prometheus" && input.endpoint) throw new Error("This metric provider uses its fixed API endpoint.");
  const bounded = { from: Math.ceil(window.from / MINUTE) * MINUTE, to: Math.floor(window.to / MINUTE) * MINUTE };
  if (bounded.to <= bounded.from) return [];
  const context = { window: bounded, signal: AbortSignal.timeout(10_000) };
  switch (input.provider) {
    case "datadog": return datadog(input, credentials, context);
    case "newrelic": return newrelic(input, credentials, context);
    case "pingdom": return pingdom(input, credentials, context);
    case "prometheus": return prometheus(input, credentials, context);
    default: throw new Error("Choose a supported metric provider.");
  }
}
