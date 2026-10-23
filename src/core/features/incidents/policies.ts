import type { IncidentDraftInput } from "../../shared/schemas";

export interface UpdateReviewPolicy {
  requiresReview(input: { authorOperatorId: string; draft: IncidentDraftInput }): boolean;
}

export const defaultUpdateReviewPolicy: UpdateReviewPolicy = {
  requiresReview: () => false,
};

/** incident.update-due.v1: how long before a committed next-update time the
 * operator app shows the update as due and the due-soon email is sent. */
export interface UpdateDuePolicy {
  leadMinutes(): number;
}

export const defaultUpdateDuePolicy: UpdateDuePolicy = {
  leadMinutes: () => 10,
};

/** incident.escalation.v1: communicator escalation after the original commitment. */
export interface IncidentEscalationPolicy { overdueMinutes(): number }
export const defaultIncidentEscalationPolicy: IncidentEscalationPolicy = { overdueMinutes: () => 10 };
