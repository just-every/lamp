import type { ReactNode } from 'react';
import './plate.css';

type PlateProps = {
  /** What the drawing shows, for assistive technology: the plate's inner copy is decorative. */
  label: string;
  className: string;
  /** The header strip naming the surface (a host, an address or a file), where the product is a page. */
  strip?: string;
  /** What the strip shows at its far end: a note, or the surface's role as a chip. */
  stripEnd?: ReactNode;
  /** Anything the product puts above the page itself (the stale banner). */
  before?: ReactNode;
  children: ReactNode;
};

// A plate: a piece of Lamp's real UI drawn as live HTML on a clean product card (white, a 1px hairline, 12px corners
// and a soft shadow). It is one image to assistive technology.
export function Plate({ label, className, strip, stripEnd, before, children }: PlateProps) {
  return <figure className={`lamp-plate ${className}`} role="img" aria-label={label}>
    <div className="lamp-plate__sheet" aria-hidden="true">
      {before}
      {strip ? <div className="lamp-plate__strip"><span>{strip}</span>{stripEnd ? <span className="lamp-plate__strip-end">{stripEnd}</span> : null}</div> : null}
      <div className="lamp-plate__body">{children}</div>
    </div>
  </figure>;
}
