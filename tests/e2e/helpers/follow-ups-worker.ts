import queueOutage, { queueBindings } from "../queue-outage.worker";
import { runQueue, runScheduled } from "../../../src/core/app/worker-lifecycle";
export { SnapshotCache } from "../../../src/core/platform/blobs/snapshot-cache";

// Keep the existing Queue-edge proxy. All business requests run the real app;
// the consumer below is the actual Worker Queue entry point.
export default {
  fetch: queueOutage.fetch,
  queue: runQueue,
  scheduled(controller:ScheduledController,env:Parameters<typeof runScheduled>[0],context:ExecutionContext) {return runScheduled(queueBindings(env),context,controller.scheduledTime);},
};
