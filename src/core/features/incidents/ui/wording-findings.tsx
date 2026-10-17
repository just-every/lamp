import { useState } from "react";
import type { WordingFinding } from "../wording-checks";

export function WordingFindings({ findings }: { findings: WordingFinding[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = findings.filter(finding => !dismissed.includes(finding.id));
  if (!visible.length) return null;
  return <div className="wording-findings field-note" aria-label="Wording findings" role="status">{visible.map(finding => <p key={finding.id}>{finding.message} <q>{finding.span.text}</q> <button className="text-link" type="button" onClick={() => setDismissed(current => [...current, finding.id])} aria-label={`Dismiss wording check: ${finding.message}`}>Dismiss</button></p>)}</div>;
}
