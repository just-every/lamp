import { useId, useState, type ReactNode } from "react";

/** "More options": everything an update can carry beyond the first screen, closed until asked for.
 * It stays mounted while closed, so nothing typed in it is lost. */
export function MoreOptions({ label = "More options", children, footer }: { label?: string; children: ReactNode; footer: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <div className="composer-footer">
      <button type="button" className="more-options-toggle" aria-expanded={open} aria-controls="more-options" onClick={() => setOpen(current => !current)}>{label}</button>
      {footer}
    </div>
    <div id="more-options" className="more-options" hidden={!open}>{children}</div>
  </>;
}

/** An optional text an update may carry, with a count once it nears its limit. Its label names the field alone. */
export function OptionalText({ label, value, max, onChange, children }: { label: string; value: string; max: number; onChange: (value: string) => void; children?: ReactNode }) {
  const id = useId();
  return <div className="form-label option-text"><label htmlFor={id}>{label}</label><textarea id={id} value={value} maxLength={max} rows={2} onChange={(event) => onChange(event.target.value)} />{value.length > max * 0.8 ? <span className="character-count">{value.length}/{max}</span> : null}{children}</div>;
}

/** The incident's own private tools (notes, review, correction, public impact, deletion), closed at the end of the record. */
export function IncidentActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="incident-actions">
    <button type="button" className="more-options-toggle" aria-expanded={open} aria-controls="incident-actions" onClick={() => setOpen(current => !current)}>Private actions</button>
    <div id="incident-actions" className="incident-actions-panel" hidden={!open}>{children}</div>
  </div>;
}
