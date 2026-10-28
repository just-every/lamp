import type { MetricCredentials, PullQuery } from "../types.ts";
import { list, MINUTE, MinutePoints, numeric, object, requestJson, secondsTimestamp, type ProviderContext } from "./common.ts";

const ENDPOINTS: Record<string, string> = {
  us: "https://api.newrelic.com/graphql", eu: "https://api.eu.newrelic.com/graphql", jp: "https://api.jp.newrelic.com/graphql",
};
const GRAPHQL = "query LampMetric($accountId: Int!, $nrql: Nrql!) { actor { account(id: $accountId) { nrql(query: $nrql) { results } } } }";

function boundedNrql(query: string) {
  // Strip quoted literals before inspecting keywords. Never interpolate NRQL into
  // GraphQL source: a fixed query plus variables cannot execute a mutation.
  const tokens = query.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, " literal ");
  if (!/^\s*SELECT\b/i.test(tokens) || !/\bAS\s+value\s+FROM\b/i.test(tokens)
    || (tokens.match(/\bSELECT\b/gi)?.length ?? 0) !== 1
    || /[;'"`]|--|\/\*|\*\//.test(tokens)
    || /\b(SINCE|UNTIL|TIMESERIES|FACET|COMPARE|LIMIT|SLIDE|EXTRAPOLATE|DELETE|INSERT|UPDATE|DROP|MUTATION|WITH|JOIN)\b/i.test(tokens)) {
    throw new Error("Use one NRQL SELECT expression AS value FROM an event type, with optional WHERE and no time or facet clauses.");
  }
  return query.trim();
}

/** NerdGraph nrql.results rows: {beginTimeSeconds,endTimeSeconds,value:number|null}. */
export async function newrelic(input: PullQuery, credentials: MetricCredentials, context: ProviderContext) {
  const region = input.region?.toLowerCase() || "us";
  if (!Object.hasOwn(ENDPOINTS, region)) throw new Error("Choose a supported New Relic region.");
  const endpoint = ENDPOINTS[region];
  if (!input.accountId || !/^[1-9]\d{0,9}$/.test(input.accountId) || Number(input.accountId) > 2_147_483_647) throw new Error("New Relic needs a valid account ID.");
  const query = boundedNrql(input.query);
  const points = new MinutePoints(context.window);
  // NRQL permits at most 366 timeseries buckets. Six-hour chunks preserve
  // one-minute resolution even when the caller requests a whole day.
  for (let from = context.window.from; from < context.window.to; from += 360 * MINUTE) {
    const to = Math.min(from + 360 * MINUTE, context.window.to);
    const nrql = `${query} SINCE ${from} UNTIL ${to} TIMESERIES 1 minute`;
    const body = object(await requestJson(new URL(endpoint), {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "API-Key": credentials.key },
      body: JSON.stringify({ query: GRAPHQL, variables: { accountId: Number(input.accountId), nrql } }),
    }, context.signal));
    if (body.errors !== undefined && list(body.errors).length) throw new Error("New Relic could not execute the metric query.");
    const result = object(object(object(object(body.data).actor).account).nrql);
    for (const entry of list(result.results, 366)) {
      const row = object(entry);
      const at = secondsTimestamp(row.beginTimeSeconds);
      const end = secondsTimestamp(row.endTimeSeconds);
      if (at % MINUTE || end - at !== MINUTE || at < from || end > to) throw new Error("New Relic returned an invalid minute interval.");
      points.add(at, numeric(row.value));
    }
  }
  return points.result();
}
