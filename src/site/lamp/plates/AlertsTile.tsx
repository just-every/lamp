import { Plate } from './Plate';
import { ALERT_SOURCE } from './sample';
import './alerts-tile.css';

const LABEL = "Drawing of an alert source on Lamp's Alerts screen: Payments monitor, configured, authenticated by HMAC-SHA256 signed requests and deduplicated by the path $.alert.id.";

// T2: the operator's Alerts screen, its configured source card only: how the monitor signs its alerts, and the path
// whose value keeps one incident per problem.
export function AlertsTile() {
  return <Plate label={LABEL} className="lamp-tile lamp-alerts">
    <div className="lamp-alerts__heading">
      <div><span className="lamp-plate__eyebrow">Authenticated source</span><span className="lamp-plate__title lamp-plate__title--tile">{ALERT_SOURCE.name}</span></div>
      <span className="lamp-plate__pill">Configured</span>
    </div>
    <dl className="lamp-alerts__facts">
      <div><dt>Authentication</dt><dd>{ALERT_SOURCE.authentication}</dd></div>
      <div><dt>{ALERT_SOURCE.dedupe[0]}</dt><dd className="lamp-plate__mono">{ALERT_SOURCE.dedupe[1]}</dd></div>
    </dl>
  </Plate>;
}
