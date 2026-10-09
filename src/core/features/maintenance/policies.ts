import type { MaintenanceState } from "../../shared/domain";

export interface MaintenanceRemindersPolicy {
  shouldNotify(event: { kind: "scheduled" | "rescheduled" | "started" | "completed" | "cancelled"; state: MaintenanceState; startsAt: string; now: string }): boolean;
}

export const defaultMaintenanceRemindersPolicy: MaintenanceRemindersPolicy = {
  shouldNotify: ({ kind, startsAt, now }) => kind !== "rescheduled" || new Date(startsAt).getTime() > new Date(now).getTime(),
};
