import type { MetricCredentials, PullQuery } from "../types.ts";
import { list, MinutePoints, object, requestJson, type ProviderContext } from "./common.ts";
import { prometheusDestination } from "./destination.ts";

/** Prometheus range API: {status:"success",data:{resultType:"matrix",result:[{values:[[seconds,"number"]]}]}}. */
export async function prometheus(input: PullQuery, credentials: MetricCredentials, context: ProviderContext) {
  const url = await prometheusDestination(input.endpoint, context.signal);
  url.searchParams.set("query", input.query);
  url.searchParams.set("start", String(context.window.from / 1000));
  url.searchParams.set("end", String((context.window.to - 60_000) / 1000));
  url.searchParams.set("step", "60");
  url.searchParams.set("lookback_delta", "60s");
  url.searchParams.set("timeout", "8s");
  const body = object(await requestJson(url, { headers: { Accept: "application/json", Authorization: `Bearer ${credentials.key}` } }, context.signal));
  if (body.status !== "success") throw new Error("Prometheus could not execute the metric query.");
  const data = object(body.data);
  if (data.resultType !== "matrix") throw new Error("Prometheus must return a range matrix.");
  const points = new MinutePoints(context.window);
  for (const entry of list(data.result, 1)) {
    const series = object(entry);
    if (series.histograms !== undefined) throw new Error("Prometheus histogram results need a numeric aggregation in the query.");
    for (const pair of list(series.values)) {
      const values = list(pair, 2);
      if (values.length !== 2 || typeof values[0] !== "number" || !Number.isFinite(values[0]) || values[0] < 0 || !Number.isSafeInteger(values[0] * 1000)) {
        throw new Error("Prometheus returned an invalid timestamp.");
      }
      const raw = values[1];
      if (raw === null || raw === "NaN" || raw === "+Inf" || raw === "-Inf") continue;
      if (typeof raw !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) {
        throw new Error("Prometheus returned an invalid numeric sample.");
      }
      points.add(values[0] * 1000, Number(raw));
    }
  }
  return points.result();
}
