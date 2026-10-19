import { computeUptime } from "../public-snapshot/uptime";
import { defaultPublicSnapshotPolicies, type PublicSnapshotPolicies } from "../public-snapshot/policies";
import type { AvailabilityReportRepository } from "./repository";
import { reportPeriod } from "./period";
import type { AvailabilityReport, ClaimEvent } from "./types";

export interface AvailabilityReportService { report(input: { component: string; month?: string; quarter?: string }): Promise<AvailabilityReport | null> }

function claimOverlaps(events: ClaimEvent[], start: number, end: number): boolean {
  return events.some((event, index) => event.state !== null && Date.parse(event.changedAt) < end && (events[index + 1] ? Date.parse(events[index + 1]!.changedAt) : Infinity) > start);
}

export function createAvailabilityReportService(repository: AvailabilityReportRepository, policies: PublicSnapshotPolicies = defaultPublicSnapshotPolicies, now: () => string = () => new Date().toISOString()): AvailabilityReportService {
  return {
    async report(input) {
      const range = reportPeriod(input), generatedAt = now(), facts = await repository.read(input.component);
      if (!facts.component) return null;
      const startsAt = Date.parse(range.startsAt), endsAt = Date.parse(range.endsAt), observedEnd = Math.min(endsAt, Date.parse(generatedAt));
      const uptime = computeUptime(facts, input.component, observedEnd, facts.pageTimezone, policies, facts.component.uptimeStartDate, { startsAt, endsAt: observedEnd });
      const overlaps = (start: string, end: string | null) => Date.parse(start) < endsAt && (end ? Date.parse(end) : Infinity) > startsAt;
      const incidents = facts.incidents.filter(incident => {
        const events = facts.events.filter(event => event.causeType === "incident" && event.causeId === incident.id);
        // Older published attachments/history can precede the ledger's first
        // state change or release. Keep that evidenced prefix, too.
        const history = facts.history.filter(event => event.causeType === "incident" && event.causeId === incident.id);
        const firstClaim = [incident.attachedAt, history[0]?.changedAt].filter((at): at is string => Boolean(at)).sort()[0];
        if (events.length) {
          const prefixEnd = incident.endsAt && incident.endsAt < events[0]!.changedAt ? incident.endsAt : events[0]!.changedAt;
          return claimOverlaps(events, startsAt, endsAt) || Boolean(firstClaim && firstClaim < prefixEnd && overlaps(firstClaim, prefixEnd));
        }
        return firstClaim ? overlaps(firstClaim, incident.endsAt) : false;
      }).map(({ attachedAt: _attachedAt, ...incident }) => incident);
      const maintenance = facts.maintenance.filter(record => overlaps(record.startsAt, record.endsAt) || claimOverlaps(facts.events.filter(event => event.causeType === "maintenance" && event.causeId === record.id), startsAt, endsAt));
      const weights = ["Major outage", "Partially unavailable", "Degraded performance", "Under maintenance", "Operational"] as const;
      return {
        ...range, component: { id: facts.component.id, name: facts.component.name }, timezone: "UTC", generatedAt, observedUntil: new Date(observedEnd).toISOString(), basis: "claimed",
        uptime: uptime.percentage, downtimeMinutes: uptime.percentage === null ? null : uptime.marks.reduce((sum, day) => sum + (day.downtimeMinutes ?? 0), 0).toFixed(2),
        trackingSince: uptime.trackingSince, coverageDays: uptime.coverageDays, incidents, maintenance,
        method: `Claimed availability from component state history, with corrections; overlapping claims use the page's aggregate state, never added together. Weighted downtime minutes per minute: ${weights.map(state => `${state} ${policies.uptimeDowntimeWeight(state)}`).join(", ")}. Percentage rounded down to two decimals over tracked elapsed time only, starting at the later of the period start, first history and configured uptime start date (in the page's timezone). Period end is exclusive; future time is not counted. No linked measured evidence is available. Maintenance rows include scheduled/cancelled windows, labelled by state; those rows alone do not establish downtime.`,
      };
    },
  };
}
