import type { SubscriberReportingRepository } from "./repository";
import type { DailyCount, ReportingRange, SubscriberReportingResponse } from "./types";

export const reportingDefinitions = {
  current: "Current counts include pending, active and retained deactivated subscribers. Erased destinations (deleted: tombstones) are excluded. Date filters affect the trend only.",
  components: "Counts cover current visible components. All-component subscriptions count once for each component; selected subscriptions count for each selected visible component. Component counts overlap and must not be summed as subscriber totals.",
  growth: "Inventory means pending plus active subscribers, not confirmed delivery recipients. Joined and left count entries into and exits from that inventory. Pending confirmation does not change inventory. A channel change leaves the old channel and joins the new one.",
  tracking: "Daily changes use the UTC database observation day, including imports, undo, expiry and erasure. Tracking starts at the recorded baseline; its first day is partial, and the current day is incomplete. Earlier history is unknown. Imports are never backdated to subscriber creation dates.",
  baseline: "The baseline records eligible inventory when tracking began. Daily opening inventory is that baseline plus earlier observed net changes; closing inventory adds the day's net change. Technical archives retain these anonymous facts; page-data imports are observed as new changes.",
  coverage: "Audience and language reporting are unavailable because native audience and language subscriptions are not built. HIST-007 remains partial.",
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
