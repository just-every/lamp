import { useEffect, useRef, useState } from "react";

import { ApiError, appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { SaveNote } from "../../intake/ui/tool-parts";
import type { SavePhase } from "../../intake/ui/use-source-autosave";
import type { PersonInput } from "../types";
import { failureText } from "./wording";

export type PersonRow = { operatorId: string; subject: string };
export type OperatorChoice = { id: string; displayName: string; email: string };
export const emptyPerson = (): PersonRow => ({ operatorId: "", subject: "" });
const started = (row: PersonRow) => Boolean(row.operatorId || row.subject.trim());
const complete = (row: PersonRow) => Boolean(row.operatorId && row.subject.trim());
/** The rows an owner has begun, ready to send; a blank row is only a place to type. */
export const peopleOf = (rows: PersonRow[]): PersonInput[] => rows.filter(started).map(row => ({ operatorId: row.operatorId, subject: row.subject.trim() }));

/** Once the registration exists, People save as they change (typing after a short pause, choices at once), one write at
 * a time and always the newest list. A row still being filled is not sent, and a refused save keeps every value. */
export function usePeopleAutosave(enabled: boolean, unavailable: string | null, onSaved: () => void) {
  const [phase, setPhase] = useState<SavePhase>("saved");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<PersonRow[] | null>(null);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useRef(onSaved);
  notify.current = onSaved;
  useEffect(() => () => clearTimeout(timer.current), []);

  async function flush() {
    if (sending.current) return;
    sending.current = true;
    try {
      while (latest.current) {
        const rows = latest.current; latest.current = null;
        setPhase("saving"); setError(null);
        try { await appApi("/api/app/sign-in/okta/people", { method: "PUT", body: JSON.stringify({ people: peopleOf(rows) }) }); setPhase("saved"); notify.current(); }
        catch (cause) {
          latest.current ??= rows;
          setPhase("error"); setError(failureText(cause instanceof ApiError ? cause.message : "", "okta", unavailable));
          return;
        }
      }
    } finally { sending.current = false; }
  }
  return {
    phase, error,
    changed(rows: PersonRow[], immediate: boolean) {
      if (!enabled || rows.some(row => started(row) && !complete(row))) return;
      latest.current = rows; setPhase("waiting");
      clearTimeout(timer.current);
      if (immediate) void flush(); else timer.current = setTimeout(() => void flush(), 600);
    },
    retry() { void flush(); },
  };
}

/** Okta signs in only the people listed: each active or invited operator beside the Okta user ID that is theirs. */
export function OktaPeople({ rows, operators, onChange, save }: { rows: PersonRow[]; operators: OperatorChoice[]; onChange: (rows: PersonRow[], immediate: boolean) => void; save: ReturnType<typeof usePeopleAutosave> | null }) {
  const update = (index: number, field: keyof PersonRow, value: string) => onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row), field === "operatorId");
  return <div className="tool-step">
    <p>Okta signs in only the people listed here. Find each user ID in Okta under Directory › People; it starts with 00u.</p>
    {save && <SaveNote phase={save.phase} error={save.error} retry={save.retry} held={0} />}
    <ul className="label-rows">{rows.map((row, index) => <li key={index} className="label-row">
      <label className="form-label">Person<select aria-label={`Person ${index + 1}`} value={row.operatorId} onChange={event => update(index, "operatorId", event.target.value)}>
        <option value="">Choose a person</option>
        {operators.map(operator => <option key={operator.id} value={operator.id}>{operator.displayName} · {operator.email}</option>)}
      </select></label>
      <label className="form-label">Okta user ID<input aria-label={`Okta user ID ${index + 1}`} maxLength={255} autoComplete="off" value={row.subject} placeholder="00u1abcd2EFGH3ijkl4" onChange={event => update(index, "subject", event.target.value)} /></label>
      <Button type="button" variant="secondary" className="table-action" aria-label={`Remove person ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index), true)}>Remove</Button>
    </li>)}</ul>
    <div className="form-actions label-rows-actions"><Button type="button" variant="secondary" onClick={() => onChange([...rows, emptyPerson()], false)}>Add a person</Button></div>
  </div>;
}
