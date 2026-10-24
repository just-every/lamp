import { pingExternalHeartbeat } from './external-heartbeat';
import { createApp } from "./server";
import { notificationOrigin, prepareAppMailBindings } from "./mail";
import type { AppBindings } from "./types";
import type { LampJob } from "../platform/jobs";
import { createOverviewRepository } from "../features/overview/repository";
import { CRON_EVIDENCE_STEP } from "./request-work";
import { expireHeldSorrySubscribers } from "../features/statuspage-import/sorry-release.repository";

let localSnapshotBootstrapFinished = false;

function isLampJob(value: unknown): value is LampJob {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { type?: unknown; eventId?: unknown };
  return candidate.type === "health-probe" || (candidate.type === "delivery-dispatch" && typeof candidate.eventId === "string");
}

export async function ensureDevelopmentSnapshot(runtime: ReturnType<typeof createApp>) {
  if (!import.meta.env.DEV || localSnapshotBootstrapFinished) return;
  if (!(await runtime.services.publicSnapshots.hasCurrentSnapshot())) {
    if (!(await runtime.services.operators.listOperators()).length || !(await runtime.services.pageSettings.get())) return;
    await runtime.services.publicSnapshots.rebuild();
  }
  localSnapshotBootstrapFinished = true;
}

export async function runScheduled(bindings: AppBindings, executionContext: ExecutionContext, scheduledAt = Date.now()) {
  const runtime = createApp(await prepareAppMailBindings(bindings, "background"), "background");
  executionContext.waitUntil((async () => {
    // Requests leave due work to Cron once it has recorded a recent run.
    // A failed marker only lets requests keep helping; it must not stop this run.
    await createOverviewRepository(bindings.DB).record(CRON_EVIDENCE_STEP, "cron").catch((cause) => console.error("Lamp could not record its Cron run.", cause));
    // State changes and operator reminders first, at the trigger's own time,
    // so the mail they queue goes out in this same run.
    const changes = await Promise.allSettled([
      runtime.services.metrics.runDue(scheduledAt),
      runtime.services.subscribers.expirePending(),
      expireHeldSorrySubscribers(bindings.DB, scheduledAt),
      runtime.services.pageExport.expireHeld(scheduledAt),
      runtime.services.incidents.publishDue(),
      runtime.services.maintenance.runDue(),
      runtime.services.updateReminders.remindDue(new Date(scheduledAt).toISOString()),
      runtime.services.reports.remindDue(new Date(scheduledAt).toISOString()),
    ]);
    const deliveries = await Promise.allSettled([
      notificationOrigin(bindings).then((origin) => runtime.services.deliveries.dispatchDue(origin)),
      runtime.services.publicSnapshots.retryPendingBuild(),
      runtime.services.channels.dispatchPending(),
      // Lamp checks its own public page, subscribe form and sender; Overview shows the result.
      runtime.services.overview.live.runChecks(),
      runtime.services.overview.live.checkSenderIfDue(),
    ]);
    // Every failed step is reported, not only the first.
    const failures = [...changes, ...deliveries].filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, `Lamp's scheduled run had ${failures.length} failed steps.`);
    await pingExternalHeartbeat(bindings, runtime, scheduledAt);
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
    if (bindings.EFFECTS_PAUSED === "1") {
      message.retry({ delaySeconds: 60 });
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
