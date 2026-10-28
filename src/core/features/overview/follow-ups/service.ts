import type { AgentAction } from "../../incidents/agent-action";
import type { JobDispatcher } from "../../../platform/jobs";
import type { FollowUpsRepository } from "./repository";
import type { FollowUpRetryRepository } from "./retry.repository";
import type { FollowUp, FollowUpRow } from "./types";

function project(row: FollowUpRow): FollowUp {
  return {
    id:row.id,kind:row.kind,title:row.title,
    owner:row.owner_id && row.owner_name ? {id:row.owner_id,displayName:row.owner_name} : null,
    dueAt:row.due_at,stopCondition:row.stop_condition,
    failure:row.failure_message && row.failure_at ? {state:"failed",message:row.failure_message,occurredAt:row.failure_at} : null,
    link:row.link,occurrence:row.occurrence,
  };
}

/** Queue messages are retained privately after removing capability URLs and
 * obvious credentials. The list itself exposes only a fixed safe summary. */
function queueError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Queue rejected notification dispatch.";
  return message.replace(/https?:\/\/[^\s]+/gi,"[URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[address]")
    .replace(/\b(bearer|token|secret|authorization|api[_-]?key)\s*[:= ]\s*[^\s,;]+/gi,"$1 [redacted]")
    .slice(0,1000);
}

export function createFollowUpsService(repository: FollowUpsRepository, retries: FollowUpRetryRepository) {
  return {
    async list(): Promise<FollowUp[]> { return (await repository.list(new Date().toISOString())).map(project); },
    async dismiss(input: {id:string;occurrence:string;reason:string}, operatorId: string): Promise<boolean> {
      const reason=input.reason.trim();
      if (!reason || reason.length>1000) return false;
      return repository.dismiss(input.id,input.occurrence,reason,operatorId,new Date().toISOString());
    },
    async retry(input: {id:string;occurrence:string}, operatorId: string, jobs: JobDispatcher, action?: AgentAction): Promise<"stale" | "queued" | "queue-failed"> {
      const claim=await retries.claim(input.id,input.occurrence,operatorId,new Date().toISOString(),action);
      if (!claim) return "stale";
      try { await jobs.enqueue({type:"delivery-dispatch",eventId:claim.eventId}); }
      catch (cause) {
        await retries.recordQueueFailure(claim,queueError(cause),new Date().toISOString());
        return "queue-failed";
      }
      // Submission is not completion. Existing consumers own delivery claims,
      // provider idempotency and outbox completion; the lease bounds recovery.
      return "queued";
    },
  };
}
