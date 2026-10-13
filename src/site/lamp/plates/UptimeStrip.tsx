import { uptimeMarks } from './sample';
import './uptime-strip.css';

// The 90-day strip: one mark per reporting day, 91 of them (the window's first calendar day through today), placed by
// SVG attributes and drawn by class: available, weighted downtime or no data.
export function UptimeStrip() {
  return <svg className="lamp-strip" viewBox="0 0 455 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {uptimeMarks.map((mark, index) => <rect key={index} className={`lamp-strip__mark lamp-strip__mark--${mark}`} x={index * 5} y="0" width="4" height="14" rx="0.6" />)}
  </svg>;
}
