import { calendarMonth } from "../communication-performance/month";
import type { ReportPeriod } from "./types";

/** Page-zone calendar periods are half-open, including offset changes and year rollover. */
export function reportPeriod(input: { month?: string; quarter?: string }, timezone: string): ReportPeriod {
  const period = input.month ?? input.quarter!;
  const year = period.slice(0, 4);
  const firstMonth = input.month ? Number(period.slice(5)) : (Number(period.slice(6)) - 1) * 3 + 1;
  const first = calendarMonth(`${year}-${String(firstMonth).padStart(2, "0")}`, timezone);
  const last = input.month ? first : calendarMonth(`${year}-${String(firstMonth + 2).padStart(2, "0")}`, timezone);
  return { period, startsAt: first.startsAt, endsAt: last.endsAt };
}
