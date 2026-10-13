import { ManagePlate } from '../plates/ManagePlate';
import { SectionText } from './SectionText';
import './section.css';
import './subscribers.css';

// Section 4: the subscriber's own Manage subscription page, staged on a panel, the text beside it.
export function SubscribersSection() {
  return <section data-moment id="subscribers" className="lamp-section lamp-subscribers" aria-labelledby="lamp-subscribers-title">
    <SectionText id="lamp-subscribers-title" eyebrow="Subscribers" title="Customers hear only what they follow." className="lamp-section__text--side lamp-subscribers__text">
      <p className="lamp-section__sentence">They pick components, and leave in one click.</p>
    </SectionText>
    <div className="lamp-section__plates lamp-stage lamp-subscribers__plates"><ManagePlate /></div>
  </section>;
}
