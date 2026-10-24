export type MetricProvider = "datadog" | "newrelic" | "pingdom" | "prometheus";
export interface PullQuery {
  provider: MetricProvider;
  query: string;
  endpoint: string | null;
  accountId: string | null;
  region: string | null;
}
export interface MetricCredentials { key: string; applicationKey?: string }
/** One aggregate value per UTC minute, never a stored raw observation. */
export interface AggregatePoint { at: number; value: number }
export interface MetricDefinition {
  id: string; componentId: string; sourceId: string | null; name: string; unit: string;
  provider: MetricProvider | "push" | "uptime"; query: string; endpoint: string | null;
  accountId: string | null; region: string | null; connected: boolean;
  lastReportedAt: number | null; error: string | null;
}
export interface PublicMetric {
  id: string; componentId: string; name: string; unit: string; source: MetricDefinition["provider"];
  lastReportedAt: number | null; points: AggregatePoint[];
}
