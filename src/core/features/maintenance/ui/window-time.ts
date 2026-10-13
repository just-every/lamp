import { fromPageDateTime, toPageDateTime } from "../../../app/client/ui/timezone";

export function windowInstant(value: string, recorded: string, timezone: string): string | null {
  // An unchanged field preserves the recorded seconds and side of a DST fold.
  return value === toPageDateTime(recorded, timezone) ? recorded : fromPageDateTime(value, timezone);
}
