import { useId } from "react";
import type { MetricDefinition } from "../types";
export type MetricFields = Pick<MetricDefinition,"name"|"unit"|"query"|"endpoint"|"accountId"|"region">;
export function MetricFieldsForm({value,provider,onChange}:{value:MetricFields;provider:MetricDefinition["provider"];onChange:(value:MetricFields)=>void}) {
  const regionLabel=useId(),queryLabel=useId();
  const field=(key:keyof MetricFields,next:string|null)=>onChange({...value,[key]:next});
  return <>
    <label className="form-label">Metric name<input required maxLength={80} value={value.name} onChange={event=>field("name",event.target.value)} /></label>
    <label className="form-label">Unit<input required readOnly={["pingdom","uptime"].includes(provider)} maxLength={24} value={value.unit} placeholder="ms" onChange={event=>field("unit",event.target.value)} /></label>
    {provider!=="push"&&provider!=="uptime"&&<label className="form-label"><span id={queryLabel}>{provider==="pingdom"?"Pingdom check ID":"Metric query"}</span><textarea aria-labelledby={queryLabel} required maxLength={1000} value={value.query} onChange={event=>field("query",event.target.value)} placeholder={provider==="datadog"?"avg:system.load.1{*}":provider==="newrelic"?"SELECT average(duration) AS value FROM Transaction":provider==="prometheus"?"avg(http_request_duration_seconds)":"12345"} /></label>}
    {provider==="prometheus"&&<label className="form-label">Prometheus endpoint<input required type="url" value={value.endpoint??""} placeholder="https://metrics.example.com" onChange={event=>field("endpoint",event.target.value||null)} /></label>}
    {provider==="newrelic"&&<label className="form-label">New Relic account ID<input required inputMode="numeric" value={value.accountId??""} onChange={event=>field("accountId",event.target.value||null)} /></label>}
    {(provider==="datadog"||provider==="newrelic")&&<label className="form-label"><span id={regionLabel}>Provider region</span><select aria-labelledby={regionLabel} value={value.region??""} onChange={event=>field("region",event.target.value||null)}><option value="">United States</option><option value="eu">Europe</option></select></label>}
  </>;
}
