import { StalePlate } from '../plates/StalePlate';
import { SectionText } from './SectionText';
import { StaticLamp } from './StaticLamp';
import './section.css';
import './resilience.css';

// Section 3, the page's one dark moment: an inset night panel with the page still lit. The lit pendant hangs from the
// panel's top edge over plate D, the page served as its last known state, and its light lands on the stale banner.
// Wide, the text on the left and the lamp and plate on the right; narrow, the lamp, the text, then the plate.
export function ResilienceSection() {
  return <section data-moment id="resilience" className="lamp-section lamp-resilience" aria-labelledby="lamp-resilience-title">
    <div className="lamp-resilience__panel">
      <SectionText id="lamp-resilience-title" eyebrow="Resilience" title="Down, not dark." className="lamp-resilience__text">
        <p className="lamp-section__sentence">Even with Lamp’s own database down, your page still answers and says how old it is.</p>
      </SectionText>
      <div className="lamp-resilience__stage">
        <StaticLamp className="lamp-resilience__lamp" />
        <div className="lamp-section__plates lamp-resilience__plates"><StalePlate /></div>
      </div>
    </div>
  </section>;
}
