import type { IncidentDraftInput } from "../../shared/schemas";

export interface UpdateReviewPolicy {
  requiresReview(input: { authorOperatorId: string; draft: IncidentDraftInput }): boolean;
}

export const defaultUpdateReviewPolicy: UpdateReviewPolicy = {
  requiresReview: () => false,
};
