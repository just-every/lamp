import { defaultPostmortemDuePolicy, type PostmortemDuePolicy } from "../reports/policies";
import { calendarMonth, pageMonth } from "./month";
import { commitmentCounts, definitions, incidentPerformance, reachSummary } from "./measurement";
import type { CommunicationPerformanceRepository } from "./repository";
import type { IncidentReachResponse, PerformanceResponse } from "./types";

export interface CommunicationPerformanceService {
  incidentReach(incidentId: string, updateId?: string): Promise<IncidentReachResponse | null>;
  monthly(input: { month?: string; incidentId?: string }): Promise<PerformanceResponse>;
}
export function createCommunicationPerformanceService(repository: CommunicationPerformanceRepository, duePolicy: PostmortemDuePolicy = defaultPostmortemDuePolicy, now: () => string = () => new Date().toISOString()): CommunicationPerformanceService {
  return {
    async incidentReach(incidentId, updateId) {
      const measuredAt = now(), timezone = await repository.timezone();
      const facts = await repository.read({ incidentId, measuredAt });
      const incident = facts.incidents[0];
      if (!incident || (updateId && !facts.updates.some(update => update.updateId === updateId))) return null;
      return {
        incidentId, timezone, measuredAt, definitions,
        incident: incidentPerformance(incident, facts, measuredAt, duePolicy),
        updates: facts.updates.filter(update => !updateId || update.updateId === updateId).map(update => ({
          ...reachSummary(facts, `update:${update.updateId}`, [update]),
          updateId: update.updateId, publishedAt: update.publishedAt,
          actualPublicationAt: update.retainedImport ? null : update.createdAt, retainedImport: Boolean(update.retainedImport),
          selectedChannels: facts.selections.filter(selection => selection.updateId === update.updateId).map(selection => selection.channel),
        })).reverse(),
      };
    },
    async monthly(input) {
      const measuredAt = now(), timezone = await repository.timezone();
      const range = calendarMonth(input.month ?? pageMonth(measuredAt, timezone), timezone);
      const facts = await repository.read({ ...range, incidentId: input.incidentId, measuredAt });
      const incidents = facts.incidents.map(incident => incidentPerformance(incident, facts, measuredAt, duePolicy));
      const latencies = incidents.flatMap(incident => incident.firstUpdateLatencyMs === null ? [] : [incident.firstUpdateLatencyMs]);
      const durations = incidents.flatMap(incident => incident.resolutionDurationMs === null ? [] : [incident.resolutionDurationMs]);
      const firstUpdateLatencyTotalMs = latencies.reduce((sum, latency) => sum + latency, 0);
      const resolutionDurationTotalMs = durations.reduce((sum, duration) => sum + duration, 0);
      return {
        ...range, timezone, measuredAt, definitions, incidents,
        summary: {
          ...reachSummary(facts, "month", facts.updates, facts.incidents.some(incident => incident.retainedImport && !facts.updates.some(update => update.incidentId === incident.incidentId))),
          incidentCount: incidents.length,
          commitments: commitmentCounts(incidents.reduce((sum, incident) => sum + incident.commitments.kept, 0), incidents.reduce((sum, incident) => sum + incident.commitments.missed, 0), incidents.reduce((sum, incident) => sum + incident.commitments.pending, 0)),
          reportsOwed: incidents.filter(incident => incident.reportOwed).length,
          knownFirstUpdateLatencyCount: latencies.length, unknownFirstUpdateLatencyCount: incidents.length - latencies.length,
          firstUpdateLatencyTotalMs, averageFirstUpdateLatencyMs: latencies.length ? firstUpdateLatencyTotalMs / latencies.length : null,
          resolvedDurationCount: durations.length, resolutionDurationTotalMs, averageResolutionDurationMs: durations.length ? resolutionDurationTotalMs / durations.length : null,
        },
      };
    },
  };
}
