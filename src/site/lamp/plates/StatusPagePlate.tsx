import { Glyph } from './Glyph';
import { Plate } from './Plate';
import { StatusBand } from './StatusBand';
import { EntryHeading, TimelineEntry } from './TimelineEntry';
import { UpdateBlock } from './UpdateBlock';
import { COMPONENTS, HOST, INC14, TIMEZONE, groups, inc14Updates } from './sample';
import './status-page-plate.css';

const LABEL = 'Drawing of a Lamp status page. Overall status: Partially unavailable. Checkout is partially unavailable, card payments only; Website, Sign-in and Email receipts are operational. Current incident INC-14, Card payments failing, identified: customers paying by card at checkout are affected; about one in five card payments is declined; browsing, baskets and gift card payments still work; next update by 13:45.';

// Plate A: the public status page as served, its status band over the component list and the public record, ending
// where the current update ends.
export function StatusPagePlate() {
  const [identified] = inc14Updates;
  return <Plate label={LABEL} className="lamp-status" strip={HOST} stripEnd={`Times: ${TIMEZONE}`}>
    <div className="lamp-status__band">
      <StatusBand />
      <div className="lamp-status__overview">
        {COMPONENTS.slice(0, 2).map((component) => <div className="lamp-status__service" key={component.id}>
          <Glyph kind={component.state === 'Operational' ? 'check' : 'alert'} />
          <div><span className="lamp-plate__small lamp-plate__muted">{component.name}</span><strong>{component.state}</strong>{component.note ? <span className="lamp-plate__small">{component.note}</span> : null}</div>
        </div>)}
      </div>
    </div>
    <span className="lamp-status__times lamp-plate__small lamp-plate__muted">Times: {TIMEZONE}</span>
    <div className="lamp-status__record">
      <div className="lamp-status__components">
        <p className="lamp-status__utilities"><u className="lamp-plate__link">Resolved history</u><u className="lamp-plate__link">Subscribe</u><u className="lamp-plate__link">Atom feed</u></p>
        <span className="lamp-plate__eyebrow">Component health</span>
        <span className="lamp-plate__title">90-day availability</span>
        {groups.map((group) => <div className="lamp-status__group" key={group.name}>
          <span className="lamp-plate__eyebrow">{group.name}</span>
          {group.components.map((component) => <div className="lamp-status__row" key={component.id}>
            <span className="lamp-status__name">{component.name}</span>
            <span className="lamp-status__state"><span className={component.state === 'Operational' ? 'lamp-plate__dot' : 'lamp-plate__dot lamp-plate__dot--down'} />{component.state}</span>
            {component.note ? <span className="lamp-status__note lamp-plate__small">{component.note}</span> : null}
          </div>)}
        </div>)}
      </div>
      <div className="lamp-status__timeline">
        <span className="lamp-plate__eyebrow">Public record</span>
        <span className="lamp-plate__title">Incidents and maintenance</span>
        <TimelineEntry time={identified.time}>
          <EntryHeading kind="Current incident" title={INC14.title} reference={INC14.reference} state={INC14.lifecycle} />
          <p className="lamp-entry__meta">Affecting Checkout</p>
          <UpdateBlock update={identified} current />
        </TimelineEntry>
      </div>
    </div>
  </Plate>;
}
