import { ExportPlate } from '../plates/ExportPlate';
import { SectionText } from './SectionText';
import './section.css';
import './ownership.css';

// Section 8: in, live and out. The claim and the three steps from setup to the owner's own domain; beside them, the
// owner's own terminal running setup, deploy and export.
export function OwnershipSection() {
  return <section data-moment id="ownership" className="lamp-section lamp-ownership" aria-labelledby="lamp-ownership-title">
    <div className="lamp-stage lamp-ownership__panel">
      <SectionText id="lamp-ownership-title" eyebrow="Ownership" title="Your light, under your roof." className="lamp-ownership__text">
        <p className="lamp-section__sentence">It never phones home and exports in full.</p>
        <ol className="lamp-ownership__steps">
          <li><strong>Run the setup.</strong> It provisions Lamp.</li>
          <li><strong>Deploy.</strong> It checks your page is live before it finishes.</li>
          <li><strong>Use your own domain,</strong> like status.yourcompany.com.</li>
        </ol>
      </SectionText>
      <div className="lamp-section__plates lamp-ownership__plates"><ExportPlate /></div>
    </div>
  </section>;
}
