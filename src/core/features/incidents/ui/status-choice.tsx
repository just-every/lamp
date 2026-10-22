import { INCIDENT_LIFECYCLES, type IncidentLifecycle } from "../../../shared/domain";

/** The lifecycle this update sets (UPDATE-003), one click: Investigating, Identified, Monitoring or Resolved. */
export function StatusChoice({ value, onChange, showLegend = false }: { value: IncidentLifecycle; onChange: (lifecycle: IncidentLifecycle) => void; showLegend?: boolean }) {
  return <fieldset className={showLegend ? "status-choice option-group" : "status-choice"}>
    <legend className={showLegend ? undefined : "sr-only"}>Status</legend>
    {INCIDENT_LIFECYCLES.map(lifecycle => <label key={lifecycle} className="choice-pill"><input type="radio" name="lifecycle" value={lifecycle} checked={value === lifecycle} onChange={() => onChange(lifecycle)} />{lifecycle}</label>)}
  </fieldset>;
}
