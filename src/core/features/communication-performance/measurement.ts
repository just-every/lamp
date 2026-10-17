import type { ChannelReach, Commitments, IncidentFact, IncidentPerformance, PerformanceFacts, ReachSummary, UpdateFact } from "./types";
import type { PostmortemDuePolicy } from "../reports/policies";

export const definitions = {
  cohort: "Incidents opened in the selected page-timezone calendar month, from its first instant inclusive to the next month's first instant exclusive. Their retained updates and delivery outcomes are measured now, including later activity.",
  firstUpdateLatency: "First accepted alert receipt (not incident opening) to first actual public publication. Native publications use created_at, including backdated updates. Imported source publications use their retained published_at. No accepted alert, no public update, or a publication before the accepted alert means unknown latency.",
  commitments: "Each native non-retroactive public update with a next-update deadline is one promise. The next actual native public publication, including a correction or backdated publication at its created_at, keeps it only at or before that deadline. Without a successor, future promises remain pending and are excluded from the share; overdue promises are missed. Imported promises are unavailable.",
  resolution: "Elapsed time from incident opening to current recorded resolution. For a native public resolution, use the later of its retained published_at and actual created_at, so later backdating cannot shorten it. Imported resolution durations retain the source timeline. Unresolved incidents have unknown duration.",
  reach: "Committed and outcome counts are immutable recipient-ledger rows per email/webhook channel. Distinct delivered subscribers are deduplicated by retained opaque subscriber ID across updates (and incidents for the monthly total). Erasure preserves counts. These are delivery facts, never opens or reads.",
  providerAccepted: "Successful provider-message attempts, reduced to one first accepted time per delivery. Email acceptance is separate from signed delivered receipts. Webhook delivered means its endpoint acknowledged the request. Accepted and delivered overlap and must not be added.",
  failureRate: "Bounced + complained + failed delivery rows divided by all committed email/webhook delivery rows. Queued and suppressed rows remain in the denominator. Retries and operator Slack/Teams posts are excluded.",
  imports: "Imported historical updates have unknown source delivery counts, not zero. Mixed totals show known ledger facts with partial coverage. Native later updates retain their own known counts.",
  operatorPosts: "Slack/Teams figures count Lamp operator-configured destination posts and provider acceptance, separately from subscriber reach. They do not measure people or signed email delivery.",
  reportsOwed: "The existing postmortem due policy is evaluated now using retained derived peak_impact, resolution and published-report facts; an operator impact override is not used.",
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
    deliveryFailure: { failures, denominator, rate: denominator ? failures! / denominator : null, denominatorLabel: "all known committed email/webhook delivery rows (including queued and suppressed)" },
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
