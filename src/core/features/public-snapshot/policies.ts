import { mostSevereState, type ComponentState } from "../../shared/domain";

/** Stable policy seam for `page.status-rollup.v1`. */
export type PageStatusRollupPolicy = (states: readonly ComponentState[]) => ComponentState;

/** Stable policy seam for `uptime.downtime-states.v1`. */
export type UptimeDowntimeWeightPolicy = (state: ComponentState) => number;

export interface PublicSnapshotPolicies {
  pageStatusRollup: PageStatusRollupPolicy;
  uptimeDowntimeWeight: UptimeDowntimeWeightPolicy;
}

export const defaultPageStatusRollup: PageStatusRollupPolicy = (states) => mostSevereState(states);

export const defaultUptimeDowntimeWeight: UptimeDowntimeWeightPolicy = (state) => {
  if (state === "Major outage" || state === "Partially unavailable") return 1;
  if (state === "Degraded performance") return 0.5;
  return 0;
};

export const defaultPublicSnapshotPolicies: PublicSnapshotPolicies = {
  pageStatusRollup: defaultPageStatusRollup,
  uptimeDowntimeWeight: defaultUptimeDowntimeWeight,
};
