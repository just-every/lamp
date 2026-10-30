import worker from "./automation-clock-worker";
import { lampServerExtensions } from "../../../src/ext/index.server";
export { SnapshotCache } from "./automation-clock-worker";

// Install the owner's supported review policy; routes, scheduling, storage,
// notification dispatch and the mail serializer remain the native application.
Object.assign(lampServerExtensions.policies, {
  "update.review.v1": { requiresReview: () => true },
});
export default worker;
