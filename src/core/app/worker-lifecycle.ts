import { initialPageSettings } from "./config";
import { createApp } from "./server";
import { notificationOrigin, prepareAppMailBindings } from "./mail";
import type { AppBindings } from "./types";
import type { LampJob } from "../platform/jobs";

let localSnapshotBootstrapFinished = false;

function isLampJob(value: unknown): value is LampJob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; eventId?: unknown };
  return candidate.type === "health-probe" || (candidate.type === "delivery-dispatch" && typeof candidate.eventId === "string");
}

export async function ensureDevelopmentSnapshot(runtime: ReturnType<typeof createApp>) {
  if (!import.meta.env.DEV || localSnapshotBootstrapFinished) return;
  if (!(await runtime.services.publicSnapshots.hasCurrentSnapshot())) {
    await runtime.services.pageSettings.ensureInitial(initialPageSettings);
    await runtime.services.publicSnapshots.rebuild();
  }
  localSnapshotBootstrapFinished = true;
}

export async function runScheduled(bindings: AppBindings, executionContext: ExecutionContext) {
  const runtime = createApp(await prepareAppMailBindings(bindings, "background"), "background");
  executionContext.waitUntil((async () => {
    const results = await Promise.allSettled([
      runtime.services.subscribers.expirePending(),
      runtime.services.incidents.publishDue(),
      runtime.services.maintenance.runDue(),
      notificationOrigin(bindings).then((origin) => runtime.services.deliveries.dispatchDue(origin)),
      runtime.services.publicSnapshots.retryPendingBuild(),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  })());
}

export async function runQueue(batch: MessageBatch<unknown>, bindings: AppBindings) {
  const runtime = createApp(await prepareAppMailBindings(bindings, "background"), "background");
  for (const message of batch.messages) {
    if (!isLampJob(message.body)) {
      message.retry();
      throw new Error("Lamp received an unknown queue command.");
    }
    if (message.body.type === "health-probe") {
      message.ack();
      continue;
    }
    try {
      await runtime.services.deliveries.dispatchEvent(message.body.eventId, await notificationOrigin(bindings));
      message.ack();
    } catch (cause) {
      message.retry();
      throw cause;
    }
  }
}
