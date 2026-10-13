import { Plate } from './Plate';
import { UpdateBlock } from './UpdateBlock';
import { HOST, INC11, inc11Updates } from './sample';
import './incident-record-plate.css';

const LABEL = 'Drawing of incident INC-11, Slow checkout pages, resolved, with its published updates kept as written, newest first: resolved at 09:54, monitoring at 09:47 and identified at 09:31 on 2 September 2026, and earlier ones below.';

// Plate E2: the incident's own page, its main column: the heading, then its published updates, newest first, kept as
// written. It ends at an entry boundary, after Identified; a short rail fading out says the record runs on.
export function IncidentRecordPlate() {
  return <Plate label={LABEL} className="lamp-record" strip={`${HOST}/incidents/${INC11.reference}`}>
    <span className="lamp-plate__small lamp-plate__muted">Status / {INC11.reference}</span>
    <div className="lamp-record__heading">
      <div>
        <span className="lamp-plate__eyebrow">Incident</span>
        <span className="lamp-plate__title lamp-plate__title--screen">{INC11.title}</span>
        <span className="lamp-plate__small">{INC11.reference}</span>
      </div>
      <span className="lamp-plate__pill">{INC11.lifecycle}</span>
    </div>
    <p className="lamp-record__meta">Affecting Checkout</p>
    {inc11Updates.slice(0, 3).map((update, index) => <UpdateBlock key={update.lifecycle} update={update} current={index === 0} />)}
    <span className="lamp-record__more" />
  </Plate>;
}
