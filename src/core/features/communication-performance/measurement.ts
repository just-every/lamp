import type { ChannelReach, Commitments, IncidentFact, IncidentPerformance, PerformanceFacts, ReachSummary, UpdateFact } from "./types";
import type { PostmortemDuePolicy } from "../reports/policies";

export const definitions = {
  cohort: "Includes incidents opened in the selected month in your page timezone. Figures include later updates and their current delivery results.",
  firstUpdateLatency: "Time from the first accepted alert to the first public update. Backdated Lamp updates use when they were actually published; imports use the original publication time. Without both times in that order, the delay is unknown.",
  commitments: "Each Lamp update with a next-update time makes a promise, except backdated updates. Publishing again by that deadline keeps it. Corrections count at their actual publication time. Future promises are pending; overdue promises are missed. Imported promises are unknown.",
  resolution: "Time from opening to resolution. Backdating a Lamp resolution cannot shorten it: the later of its stated and actual publication time is used. Imports keep the source timeline. Unresolved incidents have no duration yet.",
  reach: "Send totals count each email or webhook once. Subscriber totals count each person once across updates and, for monthly totals, incidents. Deleting a subscriber keeps anonymous totals. Delivery does not mean an update was read.",
  providerAccepted: "Accepted means the mail provider took the email; delivered means it confirmed delivery. A webhook is delivered when its endpoint accepts it. Retries count once. Accepted and delivered overlap; do not add them.",
  failureRate: "Bounced, complained and failed sends divided by all planned email and webhook sends, including queued and skipped sends. Retries and operator Slack or Teams posts are excluded.",
  imports: "Imported delivery counts are unknown, not zero. Mixed totals include known Lamp sends and show incomplete coverage.",
  operatorPosts: "Slack and Teams totals count posts and whether the service accepted them. They do not count people or email delivery.",
  reportsOwed: "Reports due depend on the highest component impact, resolution and whether a report is published. A manual incident impact override does not change this.",
};

export function commitmentCounts(kept: number, missed: number, pending: number): Commitments {
  const evaluated = kept + missed;
  return { kept, missed, pending, evaluated, keptRate: evaluated ? kept / evaluated : null };
}

export function commitments(updates: UpdateFact[], measuredAt: string): Commitments {
  const actual = updates.filter(update => !update.retainedImport).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.updateId.localeCompare(b.updateId));
  let kept = 0, missed = 0, pending = 0;
  for (const [index, update] of actual.entries()) {
    if (update.isRetroactive || !update.nextUpdateAt) continue;
    const deadline = Date.parse(update.nextUpdateAt), next = actual[index + 1];
    if (next) {
      if (Date.parse(next.createdAt) <= deadline) kept++;
      else missed++;
    } else if (Date.parse(measuredAt) > deadline) missed++;
    else pending++;
  }
  return commitmentCounts(kept, missed, pending);
}

export function reachSummary(facts: PerformanceFacts, scopeId: string, updates: UpdateFact[], importedWithoutUpdates = false): ReachSummary {
  const unknownDeliveryUpdates = updates.filter(update => update.retainedImport).length;
  const unknown = unknownDeliveryUpdates > 0 || importedWithoutUpdates;
  const hasKnown = updates.some(update => !update.retainedImport);
  const channels: ChannelReach[] = (["email", "webhook"] as const).map(channel => {
    const fact = facts.channels.find(row => row.scopeId === scopeId && row.channel === channel);
    const coverage = unknown ? (hasKnown || fact ? "partial" : "unknown") : "known";
    const zero = coverage === "unknown" ? null : 0;
    return {
      channel, coverage,
      committed: fact?.committed ?? zero, distinctCommitted: fact?.distinctCommitted ?? zero,
      providerAccepted: fact?.providerAccepted ?? zero, distinctProviderAccepted: fact?.distinctProviderAccepted ?? zero,
      delivered: fact?.delivered ?? zero, distinctDelivered: fact?.distinctDelivered ?? zero,
      queued: fact?.queued ?? zero, bounced: fact?.bounced ?? zero, complained: fact?.complained ?? zero,
      suppressed: fact?.suppressed ?? zero, failed: fact?.failed ?? zero,
      firstProviderAcceptedAt: fact?.firstProviderAcceptedAt ?? null,
    };
  });
  const known = channels.some(channel => channel.committed !== null);
  const denominator = known ? channels.reduce((sum, row) => sum + (row.committed ?? 0), 0) : null;
  const failures = known ? channels.reduce((sum, row) => sum + (row.bounced ?? 0) + (row.complained ?? 0) + (row.failed ?? 0), 0) : null;
  return {
    channels, unknownDeliveryUpdates,
    operatorPosts: (["slack", "teams"] as const).map(channel => {
      const fact = facts.posts.find(row => row.scopeId === scopeId && row.channel === channel);
      return { channel, committed: fact?.committed ?? 0, accepted: fact?.accepted ?? 0, rejected: fact?.rejected ?? 0, uncertain: fact?.uncertain ?? 0, pending: fact?.pending ?? 0 };
    }),
    deliveryFailure: { failures, denominator, rate: denominator ? failures! / denominator : null, denominatorLabel: "planned email/webhook sends (including queued and skipped)" },
  };
}

export function incidentPerformance(incident: IncidentFact, facts: PerformanceFacts, measuredAt: string, policy: PostmortemDuePolicy): IncidentPerformance {
  const updates = facts.updates.filter(update => update.incidentId === incident.incidentId);
  const first = updates.map(update => update.retainedImport ? update.publishedAt : update.createdAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  const latency = first && incident.firstAcceptedAlertAt ? Date.parse(first) - Date.parse(incident.firstAcceptedAlertAt) : null;
  let resolvedAt = incident.resolvedAt;
  if (incident.lifecycle !== "Resolved") resolvedAt = null;
  if (resolvedAt) {
    const resolution = updates.filter(update => update.lifecycle === "Resolved" && update.publishedAt === resolvedAt && !update.retainedImport).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (resolution && Date.parse(resolution.createdAt) > Date.parse(resolvedAt)) resolvedAt = resolution.createdAt;
  }
  const duration = resolvedAt ? Date.parse(resolvedAt) - Date.parse(incident.openedAt) : null;
  return {
    ...reachSummary(facts, `incident:${incident.incidentId}`, updates, Boolean(incident.retainedImport && !updates.length)),
    incidentId: incident.incidentId, reference: incident.reference, title: incident.title, openedAt: incident.openedAt, resolvedAt,
    firstAcceptedAlertAt: incident.firstAcceptedAlertAt, firstPublicUpdateAt: first,
    firstUpdateLatencyMs: latency !== null && latency >= 0 ? latency : null,
    resolutionDurationMs: duration !== null && duration >= 0 ? duration : null,
    commitments: commitments(updates, measuredAt),
    reportOwed: incident.lifecycle === "Resolved" && policy.isDue({ resolvedAt: incident.resolvedAt, impact: incident.peakImpact, hasPublishedReport: Boolean(incident.reportPublishedAt), now: measuredAt }),
    retainedImport: Boolean(incident.retainedImport),
  };
}
