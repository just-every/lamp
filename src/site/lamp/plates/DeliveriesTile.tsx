import { Plate } from './Plate';
import { DELIVERIES } from './sample';
import './deliveries-tile.css';

const LABEL = 'Drawing of the Deliveries log: persisted transport outcomes, never reader tracking, with one email delivered and one bounced.';

// T4: the operator's delivery log, its email rows: what the transport reported, never whether anyone read it.
export function DeliveriesTile() {
  return <Plate label={LABEL} className="lamp-tile lamp-deliveries">
    <div className="lamp-deliveries__heading">
      <div><span className="lamp-plate__eyebrow">Notification audit</span><span className="lamp-plate__title lamp-plate__title--tile">Deliveries</span></div>
      <u className="lamp-plate__link">Export CSV</u>
    </div>
    <p className="lamp-plate__small lamp-deliveries__lede">Persisted transport outcomes, never reader tracking.</p>
    <table className="lamp-deliveries__table">
      <thead><tr><th>Destination</th><th>Channel</th><th>Outcome</th></tr></thead>
      <tbody>{DELIVERIES.filter(([, channel]) => channel === 'email').map(([destination, channel, outcome]) => <tr key={destination}><td>{destination}</td><td>{channel}</td><td>{outcome}</td></tr>)}</tbody>
    </table>
  </Plate>;
}
