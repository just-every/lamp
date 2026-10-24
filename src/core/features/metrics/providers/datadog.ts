import type { MetricCredentials, PullQuery } from "../types.ts";
import { list, MINUTE, MinutePoints, numeric, object, requestJson, timestamp, type ProviderContext } from "./common.ts";

const SITES: Record<string, string> = {
  "datadoghq.com": "https://api.datadoghq.com", "us": "https://api.datadoghq.com",
  "datadoghq.eu": "https://api.datadoghq.eu", "eu": "https://api.datadoghq.eu",
  "us3.datadoghq.com": "https://api.us3.datadoghq.com", "us3": "https://api.us3.datadoghq.com",
  "us5.datadoghq.com": "https://api.us5.datadoghq.com", "us5": "https://api.us5.datadoghq.com",
  "ap1.datadoghq.com": "https://api.ap1.datadoghq.com", "ap1": "https://api.ap1.datadoghq.com",
  "ap2.datadoghq.com": "https://api.ap2.datadoghq.com", "ap2": "https://api.ap2.datadoghq.com",
  "uk1.datadoghq.com": "https://api.uk1.datadoghq.com", "uk1": "https://api.uk1.datadoghq.com",
  "ddog-gov.com": "https://api.ddog-gov.com", "us1-fed": "https://api.ddog-gov.com",
  "us2.ddog-gov.com": "https://api.us2.ddog-gov.com", "us2-fed": "https://api.us2.ddog-gov.com",
};

/** Datadog v1 query response: {status:"ok", series:[{interval, pointlist:[[ms,number|null]]}]}. */
export async function datadog(input: PullQuery, credentials: MetricCredentials, context: ProviderContext) {
  const site = input.region?.toLowerCase() || "datadoghq.com";
  if (!Object.hasOwn(SITES, site)) throw new Error("Choose a supported Datadog site.");
  const origin = SITES[site];
  if (!credentials.applicationKey) throw new Error("Datadog needs an application key scoped to timeseries_query.");
  // The default Datadog gauge fill is linear. Support a single metric expression
  // and explicitly disable filling; arithmetic/grouped results must be aggregated
  // by the owner into one query series before they can become a public metric.
  if (!/^(?:avg|min|max|sum):[a-zA-Z0-9_.]+\{[^{}\r\n]*\}(?:\.(?:rollup\((?:avg|min|max|sum|count),\s*(?:[1-9]|[1-5]\d|60)\)|as_count\(\)|as_rate\(\)))*(?:\.fill\(null\))?$/.test(input.query)) {
    throw new Error("Use one Datadog avg, min, max or sum metric expression, optionally with a rollup of at most 60 seconds and .fill(null).");
  }
  const query = /\.fill\(null\)\s*$/i.test(input.query) ? input.query : `${input.query}.fill(null)`;
  const url = new URL("/api/v1/query", origin);
  url.searchParams.set("from", String(context.window.from / 1000));
  url.searchParams.set("to", String(context.window.to / 1000));
  url.searchParams.set("query", query);
  const body = object(await requestJson(url, { headers: { Accept: "application/json", "DD-API-KEY": credentials.key, "DD-APPLICATION-KEY": credentials.applicationKey } }, context.signal));
  if (body.status !== "ok" || body.error || body.errors) throw new Error("Datadog could not execute the metric query.");
  const series = list(body.series, 1);
  const points = new MinutePoints(context.window);
  for (const entry of series) {
    const item = object(entry);
    if (typeof item.interval !== "number" || !Number.isFinite(item.interval) || item.interval <= 0 || item.interval > MINUTE) {
      throw new Error("Datadog must return samples at a resolution of one minute or finer.");
    }
    for (const pair of list(item.pointlist)) {
      const values = list(pair, 2);
      if (values.length !== 2) throw new Error("Datadog returned a malformed point.");
      points.add(timestamp(values[0]), numeric(values[1]));
    }
  }
  return points.result();
}
