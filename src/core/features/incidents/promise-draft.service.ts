import type { BriefService } from "../brief/service";
import { preparePromiseDraft } from "./promise-draft";
import type { createPromiseDraftRepository, PromiseDraftCommitment } from "./promise-draft.repository";

export function createPromiseDraftPreparer(repository: ReturnType<typeof createPromiseDraftRepository>, briefs: BriefService) {
  return async (commitment: PromiseDraftCommitment, now: string): Promise<string | null> => {
    const brief = await briefs.get(commitment.incidentId, new Date(now));
    if (!brief || brief.whatWeKnow.updates.at(-1)?.nextUpdateAt !== commitment.nextUpdateAt) return null;
    const prepared = preparePromiseDraft(brief, now, await repository.owner(commitment.incidentId));
    if (!prepared) return null;
    return await repository.save(commitment, prepared.draft, prepared.preparation) ?? repository.preparedDraft(commitment.incidentId);
  };
}
