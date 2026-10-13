import { Plate } from './Plate';
import { EntryHeading, TimelineEntry } from './TimelineEntry';
import { HOST, SCH6, TIMEZONE, maintenanceNotices, maintenanceWindow } from './sample';
import './maintenance-page-plate.css';

const LABEL = 'Drawing of planned maintenance SCH-6, Card provider upgrade, on the status page: 22:00 on 14 October to 00:30 on 15 October 2026, UTC+01:00, affecting Checkout, with its scheduled notice and the reminder sent the day before.';

// Plate F1: the planned maintenance in the page's public record, with its notices newest first.
export function MaintenancePagePlate() {
  return <Plate label={LABEL} className="lamp-planned" strip={HOST} stripEnd={`Times: ${TIMEZONE}`}>
    <span className="lamp-plate__eyebrow">Public record</span>
    <span className="lamp-plate__title">Incidents and maintenance</span>
    <TimelineEntry time={maintenanceNotices[0].time}>
      <EntryHeading kind="Planned maintenance" title={SCH6.title} reference={SCH6.reference} state={SCH6.state} />
      <p className="lamp-entry__meta">{maintenanceWindow}</p>
      <p className="lamp-entry__meta">Affects {SCH6.components.join(', ')}</p>
      {maintenanceNotices.map((notice, index) => <div className={index === 0 ? 'lamp-planned__notice lamp-plate__current' : 'lamp-planned__notice'} key={notice.kind}>
        <div className="lamp-planned__head"><span className="lamp-plate__eyebrow">{notice.kind}</span><span className="lamp-plate__small lamp-plate__muted">{notice.time}</span></div>
        <p>{notice.body}</p>
      </div>)}
    </TimelineEntry>
  </Plate>;
}
