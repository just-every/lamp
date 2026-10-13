import { OVERALL, generatedTime, summary } from './sample';
import './status-band.css';

// The public page's status band: the overall status, the newest update's summary and when the snapshot was made.
export function StatusBand() {
  return <div className="lamp-band">
    <span className="lamp-plate__eyebrow">Overall status</span>
    <span className="lamp-plate__title lamp-plate__title--page">{OVERALL}</span>
    <span className="lamp-band__summary">{summary}</span>
    <span className="lamp-plate__small lamp-plate__muted">Snapshot generated {generatedTime}.</span>
  </div>;
}
