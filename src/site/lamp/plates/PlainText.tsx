import { SAME_WORDS } from './sample';
import './plain-text.css';

// Plain text as the product writes it, its fields joined by blank lines, drawn with a small gap in place of each blank
// line (no text changes). The line every surface shares carries the amber highlighter where `highlight` is set.
export function PlainText({ lines, highlight = false, className = 'lamp-plate__mono' }: { lines: readonly string[]; highlight?: boolean; className?: string }) {
  return <div className={`lamp-plain ${className}`}>
    {lines.map((line, index) => highlight && line === SAME_WORDS
      ? <p key={index} className="lamp-plain__same"><span className="lamp-plate__same">{line}</span></p>
      : <p key={index}>{line}</p>)}
  </div>;
}
