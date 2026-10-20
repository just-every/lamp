import type { SubscriberReportingRepository } from "./repository";
import type { DailyCount, ReportingRange, SubscriberReportingResponse } from "./types";

export const reportingDefinitions = {
  current: "Counts include pending, active and deactivated subscribers, excluding deleted people. Dates filter growth only.",
  components: "Each subscription counts for every component it follows. These counts overlap; adding them does not give a subscriber total.",
  growth: "Growth counts pending and active subscribers. Confirming a subscription leaves the count unchanged. Changing channel counts as leaving one and joining another.",
  tracking: "Changes count on the UTC day they happen here, including imports, undo, expiry and deletion. Tracking starts with the first change or report view. The first day and today are partial. Earlier growth is unknown; imports are not backdated.",
  baseline: "The starting count is pending and active subscribers when tracking began. Each day starts with the previous day's total and adds joins minus departures. Backups keep these anonymous totals; page imports count as new changes.",
  coverage: "All subscribers follow this public page in its language. Audience and language breakdowns are unavailable.",
};

export interface SubscriberReportingService { report(range: ReportingRange): Promise<SubscriberReportingResponse> }
export function createSubscriberReportingService(repository: SubscriberReportingRepository): SubscriberReportingService {
  return {
    async report(range) {
      const facts = await repository.read(range);
      const daily: DailyCount[] = [];
      const channels = facts.baseline.map(row => row.channel);
      const inventory = new Map(facts.opening.map(row => [row.channel, row.eligible]));
      const changes = new Map(facts.daily.map(row => [`${row.day}/${row.channel}`, row]));
      const first = range.from > facts.trackingStartedAt.slice(0, 10) ? range.from : facts.trackingStartedAt.slice(0, 10);
      for (let day = first; day < range.to && day <= facts.measuredAt.slice(0, 10);) {
        for (const channel of channels) {
          const fact = changes.get(`${day}/${channel}`);
          const joined = fact?.joined ?? 0, left = fact?.left ?? 0, openingInventory = inventory.get(channel)!;
          const netChange = joined - left, closingInventory = openingInventory + netChange;
          daily.push({ day, channel, joined, left, netChange, openingInventory, closingInventory });
          inventory.set(channel, closingInventory);
        }
        day = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
      }
      const counts = channels.flatMap(channel => (["pending", "active", "deactivated"] as const).map(state => ({ channel, state, count: facts.counts.find(row => row.channel === channel && row.state === state)?.count ?? 0 })));
      return {
        ...range, timezone: "UTC", measuredAt: facts.measuredAt, trackingStartedAt: facts.trackingStartedAt,
        baseline: facts.baseline, counts, components: facts.components, deactivationReasons: facts.deactivationReasons, daily,
        total: counts.reduce((total, row) => total + row.count, 0),
        eligible: counts.filter(row => row.state !== "deactivated").reduce((total, row) => total + row.count, 0),
        coverage: "partial", unsupportedDimensions: ["audience", "language"], definitions: reportingDefinitions,
      };
    },
  };
}
