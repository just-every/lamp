import type { PublicSnapshotSource } from "./repository";
import type { PublicSnapshotPolicies } from "./policies";
import { DAY, REPORTING_DAYS, addCalendarDays, dateLabel, dayKey, escapeHtml, localMidnight, timestamp } from "./format";

const MINUTE = 60_000;

export interface Uptime {
  percentage: string | null;
  trackingSince: string | null;
  coverageDays: number;
  marks: Array<{ day: string; downtimeMinutes: number | null }>;
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
  const marks = days.map(({ day }) => ({ day, downtimeMinutes: null as number | null }));
  const earliest = Math.min(...events.map((event) => new Date(event.changedAt).getTime()), ...corrections.map((correction) => new Date(correction.startsAt).getTime()));
  if (!Number.isFinite(earliest)) return { percentage: null, trackingSince: null, coverageDays: 0, marks };
  const coverageStart = Math.max(windowStart, earliest, configuredStart);
  const coverageMinutes = Math.max(0, (windowEnd - coverageStart) / MINUTE);
  if (coverageMinutes <= 0) return { percentage: null, trackingSince: new Date(Math.max(earliest, configuredStart)).toISOString(), coverageDays: 0, marks };

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
    const weight = policies.uptimeDowntimeWeight(corrected?.state ?? historical?.newState ?? "Operational");
    weightedDowntime += ((segmentEnd - segmentStart) / MINUTE) * weight;
    if (weight === 0) continue;
    for (let day = 0; day < days.length; day += 1) {
      const overlap = Math.max(0, Math.min(segmentEnd, days[day]!.endsAt) - Math.max(segmentStart, days[day]!.startsAt));
      if (overlap > 0) marks[day]!.downtimeMinutes = (marks[day]!.downtimeMinutes ?? 0) + (overlap / MINUTE) * weight;
    }
  }
  for (let day = 0; day < days.length; day += 1) {
    if (days[day]!.endsAt <= coverageStart || days[day]!.startsAt >= windowEnd) marks[day]!.downtimeMinutes = null;
    else if (marks[day]!.downtimeMinutes === null) marks[day]!.downtimeMinutes = 0;
  }
  const percentage = Math.floor((100 - (weightedDowntime / coverageMinutes) * 100) * 100) / 100;
  return { percentage: `${Math.max(0, percentage).toFixed(2)}%`, trackingSince: new Date(Math.max(earliest, configuredStart)).toISOString(), coverageDays: Math.floor(coverageMinutes / (24 * 60)), marks };
}

export function uptimeMarkup(component: { name: string; uptime: Uptime }, timezone: string, generatedAt: string) {
  const coverage = component.uptime.trackingSince && component.uptime.coverageDays === 0
    ? null
    : component.uptime.percentage === null
      ? "No data"
      : component.uptime.coverageDays < REPORTING_DAYS
        ? `${component.uptime.percentage} over ${component.uptime.coverageDays} whole day${component.uptime.coverageDays === 1 ? "" : "s"}`
        : component.uptime.percentage;
  const coverageMarkup = coverage === null && component.uptime.trackingSince
    ? `Tracking since ${timestamp(component.uptime.trackingSince, timezone)}`
    : escapeHtml(coverage ?? "No data");
  const marks = component.uptime.marks.map((mark) => {
    const label = mark.downtimeMinutes === null ? `${mark.day}: no data` : mark.downtimeMinutes > 0 ? `${mark.day}: ${mark.downtimeMinutes.toFixed(mark.downtimeMinutes % 1 === 0 ? 0 : 1)} weighted downtime minutes` : `${mark.day}: no downtime`;
    return `<span class="uptime-mark ${mark.downtimeMinutes === null ? "no-data" : mark.downtimeMinutes > 0 ? "downtime" : "good"}" role="listitem" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"></span>`;
  }).join("");
  return `<div class="uptime"><span class="uptime-number">${coverageMarkup}</span><div class="uptime-marks" role="list" aria-label="${REPORTING_DAYS}-day uptime record for ${escapeHtml(component.name)}">${marks}</div><span class="uptime-window">${REPORTING_DAYS}-day record ending ${escapeHtml(dateLabel(generatedAt, timezone))}</span></div>`;
}
