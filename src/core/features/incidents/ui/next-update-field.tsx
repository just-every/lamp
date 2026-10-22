import { useEffect, useState } from "react";

import { FormError } from "../../../app/client/ui/states";
import { fromPageDateTime, toPageDateTime } from "../../../app/client/ui/timezone";

const QUICK = [{ label: "15 min", minutes: 15 }, { label: "30 min", minutes: 30 }, { label: "1 hour", minutes: 60 }, { label: "2 hours", minutes: 120 }];

/** The next-update commitment (UPDATE-001). A quick offset fills the time field;
 * the time shown in the field is what is promised, never a resolution estimate. */
export function NextUpdateField({ value, timezone, onChange, onError }: { value: string | null; timezone: string; onChange: (iso: string | null) => void; onError: (message: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  // The page zone is named only when it differs from the browser's, after hydration.
  const [otherZone, setOtherZone] = useState(false);
  useEffect(() => setOtherZone(Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone), [timezone]);
  const report = (message: string | null) => { setError(message); onError(message); };
  const choose = (minutes: number) => {
    setChosen(minutes); report(null);
    onChange(new Date(Math.ceil((Date.now() + minutes * 60_000) / 60_000) * 60_000).toISOString());
  };
  return <fieldset className="next-update-field">
    <legend>Next update</legend>
    <div className="next-update-choices">
      {QUICK.map(choice => <button key={choice.minutes} type="button" className="choice-pill" aria-pressed={chosen === choice.minutes && Boolean(value)} onClick={() => choose(choice.minutes)}>{choice.label}</button>)}
      <input aria-label="Next update date and time" type="datetime-local" value={toPageDateTime(value, timezone)} onChange={(event) => { setChosen(null); try { onChange(fromPageDateTime(event.target.value, timezone)); report(null); } catch (cause) { onChange(null); report((cause as Error).message); } }} />
    </div>
    {otherZone ? <small>Times in {timezone}.</small> : null}
    {value && Date.parse(value) > Date.now() + 86_400_000 ? <p role="status" className="time-warning">More than 24 hours away.</p> : null}
    {error ? <FormError>{error}</FormError> : null}
  </fieldset>;
}
