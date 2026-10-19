import type { ReportPeriod } from "./types";

/** UTC calendar periods are half-open, including leap days and year rollover. */
export function reportPeriod(input: { month?: string; quarter?: string }): ReportPeriod {
  const period = input.month ?? input.quarter!;
  const year = Number(period.slice(0, 4));
  const month = input.month ? Number(period.slice(5)) - 1 : (Number(period.slice(6)) - 1) * 3;
  return { period, startsAt: new Date(Date.UTC(year, month, 1)).toISOString(), endsAt: new Date(Date.UTC(year, month + (input.month ? 1 : 3), 1)).toISOString() };
}
