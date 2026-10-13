import { createContext, useContext } from "react";

export const PageTimezoneContext = createContext<string | null>(null);
export function usePageTimezone() {
  const timezone = useContext(PageTimezoneContext);
  if (!timezone) throw new Error("The page time zone is not configured.");
  return timezone;
}

export function toPageDateTime(iso: string | null, timezone: string) {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

// Resolve a wall-clock input only in the page zone. DST gaps and folds require
// an explicit choice rather than silently using the browser's zone.
export function fromPageDateTime(value: string, timezone: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid date and time in the page time zone.");
  const approximate = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(approximate) || new Date(approximate).toISOString().slice(0, 16) !== value) throw new Error("Enter a valid date and time in the page time zone.");
  const candidates = new Set<number>();
  for (const offset of [-36, -12, 0, 12, 36]) {
    const instant = approximate + offset * 3600000;
    const wall = Date.parse(`${toPageDateTime(new Date(instant).toISOString(), timezone)}:00Z`);
    const candidate = approximate - (wall - instant);
    if (toPageDateTime(new Date(candidate).toISOString(), timezone) === value) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error("Choose an unambiguous time in the page time zone; this time is skipped or repeated by daylight saving.");
  return new Date([...candidates][0]).toISOString();
}
