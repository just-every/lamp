import type { ReactNode } from 'react';
import './timeline-entry.css';

// One entry of the page's public record, laid out as the product lays it out: a hairline rail down the left with a
// ring at its top where the product draws its icon, and to its right the time above the entry.
export function TimelineEntry({ time, children }: { time: string; children: ReactNode }) {
  return <div className="lamp-entry">
    <span className="lamp-entry__rail" />
    <div className="lamp-entry__content">
      <span className="lamp-entry__time lamp-plate__muted">{time}</span>
      {children}
    </div>
  </div>;
}

/** The entry's heading: its kind, title and reference on the left, its state as a pill on the right. */
export function EntryHeading({ kind, title, reference, state }: { kind: string; title: string; reference: string; state: string }) {
  return <div className="lamp-entry__heading">
    <div>
      <span className="lamp-plate__eyebrow">{kind}</span>
      <span className="lamp-plate__title lamp-plate__title--item">{title}</span>
      <span className="lamp-plate__small">{reference}</span>
    </div>
    <span className="lamp-plate__pill">{state}</span>
  </div>;
}
