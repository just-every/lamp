import type { ReactNode } from 'react';

// A section's words: its eyebrow, its headline (which names the section for assistive technology) and what follows.
// The headline takes focus, without a ring, when the footer index glides to its section (FooterIndex.tsx).
export function SectionText({ id, eyebrow, title, className, children }: { id: string; eyebrow?: string; title: string; className: string; children?: ReactNode }) {
  return <div className={`lamp-section__text ${className}`}>
    {eyebrow ? <p className="lamp-section__eyebrow">{eyebrow}</p> : null}
    <h2 id={id} className="lamp-section__title" tabIndex={-1}>{title}</h2>
    {children}
  </div>;
}
