import { Link } from "@tanstack/react-router";

import type { IntakeService } from "../service";
import { useOperatorTime } from "../../../app/client/ui/states";

export type Receipt = Awaited<ReturnType<IntakeService["listReceipts"]>>[number];

function receiptLabel(receipt: Receipt) {
  if (receipt.direction === "note") return receipt.state === "invalid" ? "Note failed" : "Note sent";
  return receipt.state === "firing" ? "Accepted" : receipt.state === "recovered" ? "Recovered" : "Rejected";
}

function receiptClass(state: Receipt["state"]) {
  return state === "firing" ? "state-active" : state === "recovered" ? "state-monitoring" : "state-failed";
}

/** What arrived through the connected tools, newest first. The page shows it only once something has arrived. */
export function ReceiptsCard({ receipts, linked = "" }: { receipts: Receipt[]; linked?: string }) {
  const formatOperatorTime = useOperatorTime();
  return <section className="data-card receipt-card" aria-labelledby="receipts-title">
    <div className="card-heading"><h2 id="receipts-title">Recent alerts</h2><span className="count-label">{receipts.length} shown</span></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Recent alerts"><table>
      <thead><tr><th scope="col">Received</th><th scope="col">From</th><th scope="col">Result</th><th scope="col">Incident</th><th scope="col">Reason</th></tr></thead>
      <tbody>{receipts.map(receipt => <tr id={`receipt-${receipt.id}`} key={receipt.id} className={receipt.id === linked ? "is-linked" : undefined}>
        <td data-label="Received">{formatOperatorTime(receipt.receivedAt)}</td>
        <td data-label="From"><strong>{receipt.sourceName}</strong></td>
        <td data-label="Result"><span className={`state-pill ${receiptClass(receipt.state)}`}>{receiptLabel(receipt)}</span></td>
        <td data-label="Incident">{receipt.incidentId ? <Link className="text-link" to="/app/incidents/$incidentId" params={{ incidentId: receipt.incidentId }}>Open draft</Link> : "—"}</td>
        <td data-label="Reason">{receipt.error ?? (receipt.direction === "note" ? "Publication note sent to PagerDuty." : "Received.")}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
