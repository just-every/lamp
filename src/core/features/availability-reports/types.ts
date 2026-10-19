import type { PublicSnapshotSource } from "../public-snapshot/repository";
import type { ComponentState } from "../../shared/domain";

export interface ReportPeriod { period: string; startsAt: string; endsAt: string }
export interface AffectedRecord { id: string; reference: string; title: string; state: string; startsAt: string; endsAt: string | null }
export interface ClaimEvent { id: string; causeType: string; causeId: string | null; state: ComponentState | null; changedAt: string; createdAt: string }
export interface AvailabilityFacts extends Pick<PublicSnapshotSource, "history" | "corrections"> {
  pageTimezone: string;
  component: { id: string; name: string; uptimeStartDate: string | null } | null;
  events: ClaimEvent[];
  incidents: Array<AffectedRecord & { attachedAt: string | null }>;
  maintenance: AffectedRecord[];
}
export interface AvailabilityReport extends ReportPeriod {
  component: { id: string; name: string };
  timezone: "UTC";
  generatedAt: string;
  observedUntil: string;
  basis: "claimed";
  uptime: string | null;
  downtimeMinutes: string | null;
  trackingSince: string | null;
  coverageDays: number;
  method: string;
  incidents: AffectedRecord[];
  maintenance: AffectedRecord[];
}
