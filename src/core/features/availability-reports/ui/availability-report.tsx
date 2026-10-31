import { useId, useState } from "react";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { usePageTimezone } from "../../../app/client/ui/timezone";
import { pageMonth } from "../../communication-performance/month";
import "./availability-report.css";

/** One component's report for a month or quarter in the page's time zone, in its drawer's History. */
export function AvailabilityReport({ component }: { component: { id: string } }) {
  const timezone = usePageTimezone();
  const id = useId(), [kind, setKind] = useState("month");
  const [month, setMonth] = useState(() => pageMonth(new Date().toISOString(), timezone));
  const [year, setYear] = useState(() => month.slice(0, 4));
  const [quarter, setQuarter] = useState(() => String(Math.floor((Number(month.slice(5)) - 1) / 3) + 1));
  const [downloading, setDownloading] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const valid = kind === "month" ? /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 1000 && Number(month.slice(0, 4)) <= 9998 : /^\d{4}$/.test(year) && Number(year) >= 1000 && Number(year) <= 9998;
  const download = async (format: "csv" | "pdf") => {
    const period = kind === "month" ? month : `${year}-Q${quarter}`;
    const query = new URLSearchParams({ component: component.id, [kind]: period, format });
    setDownloading(format); setError(null);
    try {
      const response = await fetch(`/api/app/availability-report?${query}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Availability report returned ${response.status}.`);
      }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = `availability-${component.id}-${period}.${format}`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The availability report could not be downloaded."); }
    finally { setDownloading(null); }
  };
  return <section className="availability-report" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>Availability report</h3>
    <div className="availability-report-fields">
      <label className="form-label" htmlFor={`${id}-period`}><span>Period <span className="field-hint">in {timezone}</span></span><select id={`${id}-period`} value={kind} onChange={event => setKind(event.target.value)}><option value="month">Month</option><option value="quarter">Quarter</option></select></label>
      {kind === "month" ? <label className="form-label" htmlFor={`${id}-month`}>Month<input id={`${id}-month`} type="month" min="1000-01" max="9998-12" required value={month} onChange={event => setMonth(event.target.value)} /></label> : <>
        <label className="form-label" htmlFor={`${id}-year`}>Year<input id={`${id}-year`} type="number" min="1000" max="9998" required value={year} onChange={event => setYear(event.target.value)} /></label>
        <label className="form-label" htmlFor={`${id}-quarter`}>Quarter<select aria-label="Quarter" id={`${id}-quarter`} value={quarter} onChange={event => setQuarter(event.target.value)}>{[1, 2, 3, 4].map(number => <option key={number} value={number}>Q{number}</option>)}</select></label>
      </>}
    </div>
    <div className="availability-report-actions">{(["csv", "pdf"] as const).map(format => <Button key={format} type="button" variant="secondary" disabled={!valid || Boolean(downloading)} onClick={() => download(format)}>{downloading === format ? "Downloading…" : `Download ${format.toUpperCase()}`}</Button>)}</div>
    {error && <FormError>{error}</FormError>}
  </section>;
}
