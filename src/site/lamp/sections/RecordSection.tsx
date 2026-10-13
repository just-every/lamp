import { IncidentRecordPlate } from '../plates/IncidentRecordPlate';
import { UptimePlate } from '../plates/UptimePlate';
import { SectionText } from './SectionText';
import './section.css';
import './record.css';

// Section 5, the record, in two halves: the text over one component's 90-day availability, and an incident page that
// keeps every update it published.
export function RecordSection() {
  return <section data-moment id="history" className="lamp-section lamp-record-section" aria-labelledby="lamp-record-title">
    <div className="lamp-record-section__half">
      <SectionText id="lamp-record-title" eyebrow="History" title="Written in ink." className="lamp-record-section__text">
        <p className="lamp-section__sentence">Updates are never rewritten, and uptime is never rounded up.</p>
      </SectionText>
      <div className="lamp-section__plates lamp-record-section__uptime"><UptimePlate /></div>
    </div>
    <div className="lamp-section__plates lamp-record-section__incident"><IncidentRecordPlate /></div>
  </section>;
}
