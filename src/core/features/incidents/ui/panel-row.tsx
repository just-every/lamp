import { useId, type ReactNode } from "react";

import { Glyph, type GlyphName } from "./local-glyphs";

/** One named row of the incident panel: a disclosure button with its icon, name, one-line summary and chevron. Its
 * content stays mounted while closed, so nothing typed in it is lost. A link to `id`, or to anything inside the row,
 * opens it (incident-panel.tsx). */
export function PanelRow({ name, title, summary, glyph, open, onToggle, id, children }: { name: string; title: string; summary: ReactNode; glyph: GlyphName; open: boolean; onToggle: (name: string) => void; id?: string; children: ReactNode }) {
  const base = useId();
  return <section id={id} className={`panel-row${open ? " is-open" : ""}`} data-panel-row={name} aria-labelledby={`${base}-name`}>
    <h3 className="panel-row-heading">
      <button type="button" className="panel-row-toggle" aria-expanded={open} aria-controls={`${base}-body`} aria-labelledby={`${base}-name`} aria-describedby={`${base}-summary`} onClick={() => onToggle(name)}>
        <Glyph name={glyph} className="panel-row-icon" />
        <span className="panel-row-text"><span id={`${base}-name`} className="panel-row-name">{title}</span><span id={`${base}-summary`} className="panel-row-summary">{summary}</span></span>
        <Glyph name="chevron" className="panel-row-chevron" />
      </button>
    </h3>
    <div id={`${base}-body`} className="panel-row-body" hidden={!open}>{children}</div>
  </section>;
}
