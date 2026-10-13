import { Plate } from './Plate';
import { INC11_REPORT } from './sample';
import './report-tile.css';

const LABEL = 'Drawing of a post-incident report: what happened and what we changed, opening with its summary and timeline.';

// T1: the post-incident report as the incident page prints it, its first two fields in the product's order; the cause
// and remediation follow below the crop.
export function ReportTile() {
  const fields = [['Summary', INC11_REPORT.summary], ['Timeline', INC11_REPORT.timeline]];
  return <Plate label={LABEL} className="lamp-tile lamp-report">
    <span className="lamp-plate__eyebrow">Post-incident report</span>
    <span className="lamp-plate__title lamp-plate__title--tile">What happened and what we changed</span>
    <dl className="lamp-report__fields">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </Plate>;
}
