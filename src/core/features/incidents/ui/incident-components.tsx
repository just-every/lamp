import type { IncidentView } from "../service";

/** The sidebar describes committed attachments; the composer stages changes. */
export function IncidentComponents({ incident }: { incident: IncidentView }) {
  return <section className="context-section"><h2>Affected components</h2>
    {incident.components.length ? incident.components.map(component => <div className="component-fact" key={component.id}><strong>{component.componentName}</strong><span>{component.relationship} · {incident.lifecycle === "Resolved" ? "Released" : component.state}</span></div>) : <p>No components are attached. Choose components with this update before publishing.</p>}
  </section>;
}
