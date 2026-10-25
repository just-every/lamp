export type ReportingChannel = "email" | "webhook" | "sms";
export type ReportingState = "pending" | "active" | "deactivated";
export interface ReportingRange { from: string; to: string; channel?: ReportingChannel }
export interface CurrentCount { channel: ReportingChannel; state: ReportingState; count: number }
export interface ComponentCount extends CurrentCount { componentId: string; componentName: string; groupName: string | null }
export interface ReasonCount { channel: ReportingChannel; reason: string | null; count: number }
export interface BaselineCount { channel: ReportingChannel; eligible: number }
export interface DailyFact { day: string; channel: ReportingChannel; joined: number; left: number }
export interface DailyCount extends DailyFact { netChange: number; openingInventory: number; closingInventory: number }
export interface ReportingFacts {
  measuredAt: string;
  trackingStartedAt: string;
  baseline: BaselineCount[];
  opening: BaselineCount[];
  counts: CurrentCount[];
  components: ComponentCount[];
  deactivationReasons: ReasonCount[];
  daily: DailyFact[];
}
export interface SubscriberReportingResponse extends ReportingRange {
  timezone: "UTC";
  measuredAt: string;
  trackingStartedAt: string;
  baseline: BaselineCount[];
  counts: CurrentCount[];
  components: ComponentCount[];
  deactivationReasons: ReasonCount[];
  daily: DailyCount[];
  total: number;
  eligible: number;
  coverage: "partial";
  unsupportedDimensions: ["audience", "language"];
  definitions: Record<string, string>;
}
