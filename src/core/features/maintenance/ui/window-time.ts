/** datetime-local uses the operator browser's wall clock, not UTC digits. */
export function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function windowInstant(value: string, recorded: string): string {
  // Retain sub-minute precision and the original side of a DST overlap when
  // the minute-resolution field has not changed.
  return value === localDate(recorded) ? recorded : new Date(value).toISOString();
}
