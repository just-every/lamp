import { createSnapshotRepository } from "../public-snapshot/repository";

/** Use the existing authoritative public-source read, including claim filters
 * and retained imported IDs; this never builds or publishes a snapshot. */
export function createStatuspageWebhookRepository(db:D1Database) {
  return {load:(origin:string)=>createSnapshotRepository(db,origin).load()};
}
