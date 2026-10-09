import type { ComponentState } from "../../shared/domain";

export interface PostmortemDuePolicy {
  isDue(input: { resolvedAt: string | null; impact: ComponentState | null; hasPublishedReport: boolean; now: string }): boolean;
}

export const defaultPostmortemDuePolicy: PostmortemDuePolicy = {
  isDue: ({ resolvedAt, impact, hasPublishedReport, now }) => {
    if (hasPublishedReport || !resolvedAt || (impact !== "Partially unavailable" && impact !== "Major outage")) return false;
    return new Date(resolvedAt).getTime() + 7 * 24 * 60 * 60 * 1000 <= new Date(now).getTime();
  },
};
