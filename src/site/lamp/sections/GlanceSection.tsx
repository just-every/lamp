import { StatusPagePlate } from '../plates/StatusPagePlate';
import { SectionText } from './SectionText';
import { LampPool } from './LampPool';
import './section.css';
import './glance.css';

// Section 1: the public status page, leading with who is affected and what still works, in the hero's light.
export function GlanceSection() {
  return <section data-moment id="status-page" className="lamp-section lamp-glance" aria-labelledby="lamp-glance-title">
    <SectionText id="lamp-glance-title" eyebrow="Status page" title="Who’s affected, and what still works." className="lamp-glance__text">
      <p className="lamp-section__sentence">Every update leads with impact, in plain words.</p>
    </SectionText>
    <div className="lamp-section__plates lamp-glance__plates"><LampPool className="lamp-glance__pool" /><StatusPagePlate /></div>
  </section>;
}
