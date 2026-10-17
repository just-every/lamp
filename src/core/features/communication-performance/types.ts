export type SubscriberChannel = "email" | "webhook";
export type Coverage = "known" | "partial" | "unknown";

export interface ChannelReach {
  channel: SubscriberChannel;
  coverage: Coverage;
  committed: number | null;
  distinctCommitted: number | null;
  providerAccepted: number | null;
  distinctProviderAccepted: number | null;
  delivered: number | null;
  distinctDelivered: number | null;
  queued: number | null;
  bounced: number | null;
  complained: number | null;
  suppressed: number | null;
  failed: number | null;
  firstProviderAcceptedAt: string | null;
}
export interface Commitments { kept: number; missed: number; pending: number; evaluated: number; keptRate: number | null }
export interface OperatorPosts { channel: "slack" | "teams"; committed: number; accepted: number; rejected: number; uncertain: number; pending: number }
export interface ReachSummary {
  channels: ChannelReach[];
  unknownDeliveryUpdates: number;
  operatorPosts: OperatorPosts[];
  deliveryFailure: { failures: number | null; denominator: number | null; rate: number | null; denominatorLabel: string };
}
export interface UpdateReach extends ReachSummary {
  updateId: string; publishedAt: string; actualPublicationAt: string | null; retainedImport: boolean;
  selectedChannels: SubscriberChannel[];
}
export interface IncidentPerformance extends ReachSummary {
  incidentId: string; reference: string; title: string; openedAt: string; resolvedAt: string | null;
  firstAcceptedAlertAt: string | null; firstPublicUpdateAt: string | null;
  firstUpdateLatencyMs: number | null; resolutionDurationMs: number | null;
  commitments: Commitments; reportOwed: boolean; retainedImport: boolean;
}
export interface Measurement {
  timezone: string; measuredAt: string; definitions: Record<string, string>;
}
export interface IncidentReachResponse extends Measurement {
  incidentId: string; incident: IncidentPerformance; updates: UpdateReach[];
}
export interface PerformanceResponse extends Measurement {
  month: string; startsAt: string; endsAt: string;
  incidents: IncidentPerformance[];
  summary: ReachSummary & {
    incidentCount: number; commitments: Commitments; reportsOwed: number;
    knownFirstUpdateLatencyCount: number; unknownFirstUpdateLatencyCount: number;
    firstUpdateLatencyTotalMs: number; averageFirstUpdateLatencyMs: number | null;
    resolvedDurationCount: number; resolutionDurationTotalMs: number; averageResolutionDurationMs: number | null;
  };
}

export interface IncidentFact {
  incidentId: string; reference: string; title: string; lifecycle: string; openedAt: string; resolvedAt: string | null;
  peakImpact: import("../../shared/domain").ComponentState | null; retainedImport: number;
  firstAcceptedAlertAt: string | null; reportPublishedAt: string | null;
}
export interface UpdateFact {
  updateId: string; incidentId: string; lifecycle: string; publishedAt: string; createdAt: string;
  nextUpdateAt: string | null; isRetroactive: number; retainedImport: number;
}
export interface ChannelFact extends Omit<ChannelReach, "coverage"> { scopeId: string }
export interface PostFact extends OperatorPosts { scopeId: string }
export interface SelectionFact { updateId: string; channel: SubscriberChannel }
export interface PerformanceFacts {
  incidents: IncidentFact[]; updates: UpdateFact[]; channels: ChannelFact[]; posts: PostFact[]; selections: SelectionFact[];
}
