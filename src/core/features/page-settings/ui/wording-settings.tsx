import { useState } from "react";

export function WordingSettings({ terms, friendlyLength, onTermsChange, onLengthChange }: { terms: string[]; friendlyLength: number; onTermsChange: (terms: string[]) => void; onLengthChange: (length: number) => void }) {
  const [text, setText] = useState(terms.join("\n"));
  return <section className="data-card" aria-labelledby="wording-settings-title"><h2 id="wording-settings-title">Wording checks</h2><p>Check updates for recovery promises, private addresses and terms you choose. You can still publish after a warning.</p><div className="settings-grid"><label className="form-label">Terms to flag<textarea value={text} onChange={event => { setText(event.target.value); onTermsChange(event.target.value.split("\n").map(term => term.trim()).filter(Boolean)); }} /><small>One customer name, codename or phrase per line. Matching ignores case.</small></label><label className="form-label">Preferred field length<input type="number" min="1" max="500" required value={friendlyLength} onChange={event => onLengthChange(Number(event.target.value))} /><small>Longer wording is flagged; the normal field limits still apply.</small></label></div></section>;
}
