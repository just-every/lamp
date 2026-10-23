import queueOutage from "../queue-outage.worker";
import { runQueue } from "../../../src/core/app/worker-lifecycle";
export { SnapshotCache } from "../../../src/core/platform/blobs/snapshot-cache";

// Keep the existing Queue-edge proxy. All business requests run the real app;
// the consumer below is the actual Worker Queue entry point.
export default {
  fetch: queueOutage.fetch,
  queue: runQueue,
};
