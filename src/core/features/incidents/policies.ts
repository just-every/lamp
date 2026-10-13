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
