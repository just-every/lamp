export type LampJob =
  | { type: "health-probe"; requestedAt: string }
  | { type: "delivery-dispatch"; eventId: string }
  | { type: "house-style"; leaseId: string };

export interface JobDispatcher {
  enqueue(job: LampJob): Promise<void>;
}

export function createQueueDispatcher(queue: Queue<LampJob>): JobDispatcher {
  return {
    async enqueue(job) {
      await queue.send(job);
    },
  };
}
