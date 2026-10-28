import type { MetricCredentials, PullQuery } from "../types.ts";
import { list, MinutePoints, numeric, object, requestJson, secondsTimestamp, type ProviderContext } from "./common.ts";

/** /results/{checkid}: {results:[{time:seconds,status,responsetime:milliseconds}]}. */
export async function pingdom(input: PullQuery, credentials: MetricCredentials, context: ProviderContext) {
  if (!/^[1-9]\d{0,15}$/.test(input.query)) throw new Error("Use a Pingdom check ID as the metric query.");
  const points = new MinutePoints(context.window);
  // Summary.performance only offers hour/day/week buckets. Raw observations
  // exist only during this request and are reduced before returning to storage.
  for (let page = 0; page < 4; page++) {
    const url = new URL(`/api/3.1/results/${input.query}`, "https://api.pingdom.com");
    url.searchParams.set("from", String(context.window.from / 1000));
    url.searchParams.set("to", String(context.window.to / 1000));
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(page * 1000));
    const body = object(await requestJson(url, { headers: { Accept: "application/json", Authorization: `Bearer ${credentials.key}` } }, context.signal));
    if (body.error) throw new Error("Pingdom could not execute the metric query.");
    const rows = list(body.results, 1000);
    for (const entry of rows) {
      const row = object(entry);
      const at = secondsTimestamp(row.time);
      if (typeof row.status !== "string" || !["up", "down", "unconfirmed", "unconfirmed_down", "unknown", "paused"].includes(row.status)) {
        throw new Error("Pingdom returned an invalid check status.");
      }
      const value = numeric(row.responsetime);
      if (value !== null && value < 0) throw new Error("Pingdom returned an invalid response time.");
      // Missing responses are represented by zero during failure/unknown states;
      // they must not create a fabricated zero-latency observation.
      if (row.status === "up") points.add(at, value);
    }
    if (rows.length < 1000) return points.result();
  }
  throw new Error("Pingdom returned too many results; use a shorter pull window.");
}
