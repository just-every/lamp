import type { ReactNode } from "react";

/** An optional text an update may carry. It shows under "Who's affected?" once asked for from the + and always while it
 * holds text; hidden, it stays mounted, so nothing typed is lost. Its label names the field alone, and a count appears
 * once it nears its limit. */
export function OptionalText({ id, label, value, max, shown, onChange, children }: { id: string; label: string; value: string; max: number; shown: boolean; onChange: (value: string) => void; children?: ReactNode }) {
  return <div className="form-label option-text" hidden={!shown && !value}><label htmlFor={id}>{label}</label><textarea id={id} value={value} maxLength={max} rows={2} onChange={(event) => onChange(event.target.value)} />{value.length > max * 0.8 ? <span className="character-count">{value.length}/{max}</span> : null}{children}</div>;
}
