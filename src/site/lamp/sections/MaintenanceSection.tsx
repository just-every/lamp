import { MaintenancePagePlate } from '../plates/MaintenancePagePlate';
import { ReminderEmailPlate } from '../plates/ReminderEmailPlate';
import { SectionText } from './SectionText';
import './section.css';
import './maintenance.css';

// Section 6: planned maintenance on the page and the reminder email the day before, staged on one panel.
export function MaintenanceSection() {
  return <section data-moment id="maintenance" className="lamp-section lamp-maintenance" aria-labelledby="lamp-maintenance-title">
    <SectionText id="lamp-maintenance-title" eyebrow="Maintenance" title="Maintenance runs itself." className="lamp-section__text--side lamp-maintenance__text">
      <p className="lamp-section__sentence">It starts, finishes and tells subscribers, with no one at the desk.</p>
    </SectionText>
    <div className="lamp-section__plates lamp-stage lamp-maintenance__plates">
      <MaintenancePagePlate />
      <ReminderEmailPlate />
    </div>
  </section>;
}
