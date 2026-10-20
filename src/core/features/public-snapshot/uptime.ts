import type { PublicSnapshotSource } from "./repository";
import type { PublicSnapshotPolicies } from "./policies";
import { mostSevereState, type ComponentState } from "../../shared/domain";
import { DAY, REPORTING_DAYS, addCalendarDays, dayKey, escapeHtml, localMidnight } from "./format";

const MINUTE = 60_000;

export interface Uptime {
  percentage: string | null;
  trackingSince: string | null;
  coverageDays: number;
  coverageMinutes: number;
  marks: Array<{ day: string; downtimeMinutes: number | null; worstDowntimeState: ComponentState | null }>;
}

function reportingDays(windowStart: number, now: number, timezone: string) {
  const days: Array<{ day: string; startsAt: number; endsAt: number }> = [];
  const last = dayKey(now, timezone);
  for (let day = dayKey(windowStart, timezone); day <= last; day = addCalendarDays(day, 1)) {
    days.push({ day, startsAt: localMidnight(day, timezone), endsAt: localMidnight(addCalendarDays(day, 1), timezone) });
  }
  return days;
}

export function computeUptime(source: Pick<PublicSnapshotSource, "history" | "corrections">, componentId: string, now: number, timezone: string, policies: PublicSnapshotPolicies, startDate: string | null = null, window?: { startsAt: number; endsAt: number }): Uptime {
  const windowEnd = window?.endsAt ?? now;
  const events = source.history.filter((entry) => entry.componentId === componentId && entry.causeType !== "correction").sort((left, right) => left.changedAt.localeCompare(right.changedAt) || left.createdAt.localeCompare(right.createdAt) || (left.id ?? "").localeCompare(right.id ?? ""));
  const corrections = source.corrections.filter((entry) => entry.componentId === componentId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const windowStart = window?.startsAt ?? now - REPORTING_DAYS * DAY;
  const configuredStart = startDate ? localMidnight(startDate, timezone) : Number.NEGATIVE_INFINITY;
  const days = reportingDays(windowStart, window ? windowEnd - 1 : now, timezone);
  const marks: Uptime["marks"] = days.map(({ day }) => ({ day, downtimeMinutes: null, worstDowntimeState: null }));
  const earliest = Math.min(...events.map((event) => new Date(event.changedAt).getTime()), ...corrections.map((correction) => new Date(correction.startsAt).getTime()));
  if (!Number.isFinite(earliest)) return { percentage: null, trackingSince: null, coverageDays: 0, coverageMinutes: 0, marks };
  const coverageStart = Math.max(windowStart, earliest, configuredStart);
  const coverageMinutes = Math.max(0, (windowEnd - coverageStart) / MINUTE);
  if (coverageMinutes <= 0) return { percentage: null, trackingSince: new Date(Math.max(earliest, configuredStart)).toISOString(), coverageDays: 0, coverageMinutes: 0, marks };

  const boundaries = new Set<number>([coverageStart, windowEnd]);
  for (const event of events) boundaries.add(new Date(event.changedAt).getTime());
  for (const correction of corrections) { boundaries.add(new Date(correction.startsAt).getTime()); boundaries.add(new Date(correction.endsAt).getTime()); }
  const segments = [...boundaries].filter((instant) => instant >= coverageStart && instant <= windowEnd).sort((left, right) => left - right);
  let weightedDowntime = 0;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const [segmentStart, segmentEnd] = [segments[index]!, segments[index + 1]!];
    if (segmentEnd <= segmentStart) continue;
    const midpoint = segmentStart + (segmentEnd - segmentStart) / 2;
    const corrected = corrections.filter((entry) => new Date(entry.startsAt).getTime() <= midpoint && midpoint < new Date(entry.endsAt).getTime()).at(-1);
    const historical = events.filter((entry) => new Date(entry.changedAt).getTime() <= midpoint).at(-1);
    const state = corrected?.state ?? historical?.newState ?? "Operational";
    const weight = policies.uptimeDowntimeWeight(state);
    weightedDowntime += ((segmentEnd - segmentStart) / MINUTE) * weight;
    if (weight === 0) continue;
    for (let day = 0; day < days.length; day += 1) {
      const overlap = Math.max(0, Math.min(segmentEnd, days[day]!.endsAt) - Math.max(segmentStart, days[day]!.startsAt));
      if (overlap > 0) {
        const mark = marks[day]!;
        mark.downtimeMinutes = (mark.downtimeMinutes ?? 0) + (overlap / MINUTE) * weight;
        mark.worstDowntimeState = mostSevereState([mark.worstDowntimeState ?? state, state]);
      }
    }
  }
  for (let day = 0; day < days.length; day += 1) {
    if (days[day]!.endsAt <= coverageStart || days[day]!.startsAt >= windowEnd) marks[day]!.downtimeMinutes = null;
    else if (marks[day]!.downtimeMinutes === null) marks[day]!.downtimeMinutes = 0;
  }
  const percentage = Math.floor((100 - (weightedDowntime / coverageMinutes) * 100) * 100) / 100;
  return { percentage: `${Math.max(0, percentage).toFixed(2)}%`, trackingSince: new Date(Math.max(earliest, configuredStart)).toISOString(), coverageDays: Math.floor(coverageMinutes / (24 * 60)), coverageMinutes, marks };
}

function firstDayCoverage(uptime: Uptime) {
  const minutes = Math.floor(uptime.coverageMinutes);
  if (minutes < 1) return "less than 1 minute";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "", remainder ? `${remainder} minute${remainder === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ");
}

export function uptimeMarkup(component: { name: string; uptime: Uptime }, _timezone: string, _generatedAt: string) {
  const coverage = component.uptime.percentage === null
    ? "No data"
    : component.uptime.coverageDays === 0
      ? `${component.uptime.percentage} over ${firstDayCoverage(component.uptime)}`
      : component.uptime.coverageDays < REPORTING_DAYS
        ? `${component.uptime.percentage} over ${component.uptime.coverageDays} whole day${component.uptime.coverageDays === 1 ? "" : "s"}`
        : component.uptime.percentage;
  const marks = component.uptime.marks.map((mark) => {
    const label = mark.downtimeMinutes === null ? `${mark.day}: no data` : mark.downtimeMinutes > 0 ? `${mark.day}: Downtime ${mark.downtimeMinutes.toFixed(mark.downtimeMinutes % 1 === 0 ? 0 : 1)} minutes (weighted)${mark.worstDowntimeState ? `; worst state: ${mark.worstDowntimeState}` : ""}` : `${mark.day}: no downtime`;
    const stateClass = mark.worstDowntimeState === "Major outage" ? " major-outage" : "";
    return `<span class="uptime-mark ${mark.downtimeMinutes === null ? "no-data" : mark.downtimeMinutes > 0 ? `downtime${stateClass}` : "good"}" role="listitem" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>`;
  }).join("");
  return `<div class="uptime"><span class="uptime-number">${escapeHtml(coverage)}</span><div class="uptime-marks" role="list" aria-label="${REPORTING_DAYS}-day uptime record for ${escapeHtml(component.name)}">${marks}</div></div>`;
}
