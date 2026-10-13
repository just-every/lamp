import { Plate } from './Plate';
import { StatusBand } from './StatusBand';
import { GENERATED_AT, HOST, STALE_BANNER, TIMEZONE } from './sample';
import './stale-plate.css';

const LABEL = 'Drawing of a Lamp status page served as its last known state: a banner says the content was generated at 12:12 UTC on 9 October 2026 and the current state could not be verified. The page still answers with status 200 and still shows Partially unavailable.';

// Plate D: the page served as its last known state, with the banner the product puts straight after <body>; its
// timestamp, printed as the product prints it, is kept whole on one line.
export function StalePlate() {
  const [lead, rest] = STALE_BANNER.split(GENERATED_AT);
  return <Plate label={LABEL} className="lamp-stale" strip={HOST} stripEnd={`Times: ${TIMEZONE}`} before={<p className="lamp-stale__banner lamp-plate__current">{lead}<span className="lamp-stale__time">{GENERATED_AT}</span>{rest}</p>}>
    <StatusBand />
    <p className="lamp-stale__response lamp-plate__mono lamp-plate__muted"><span>200</span> · <span>X-Lamp-Snapshot-State: stale</span></p>
  </Plate>;
}
