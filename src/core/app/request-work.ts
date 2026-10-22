import { createOverviewRepository } from "../features/overview/repository";
import type { createApp } from "./server";
import { notificationOrigin } from "./mail";
import type { AppBindings } from "./types";

// A new Worker can serve traffic for many minutes before Cloudflare starts its
// Cron. Lamp does not wait for it. An operator write sends the mail it just
// committed, as incident publication does. While Cron has recorded no run for
// three minutes, ordinary requests also run due maintenance transitions, pending
// mail and a house style whose queued job never started. Every step keeps the
// claims Cron uses (guarded transitions, one notice per kind, outbox and delivery
// claims, the house style's lease), so requests and a later Cron never send a
// notice twice or make a picture twice.
const READ_INTERVAL_MS = 20_000;
const CRON_QUIET_MS = 3 * 60_000;
export const CRON_EVIDENCE_STEP = "scheduler";
let lastReadRunAt = 0;

async function dispatchMail(services: ReturnType<typeof createApp>["services"], bindings: AppBindings) {
  await services.deliveries.dispatchDue(await notificationOrigin(bindings));
}

export async function runDueWorkWhileCronQuiet(services: ReturnType<typeof createApp>["services"], bindings: AppBindings, now = Date.now()) {
  const cronRanAt = await createOverviewRepository(bindings.DB).checkedAt(CRON_EVIDENCE_STEP);
  if (cronRanAt && now - Date.parse(cronRanAt) < CRON_QUIET_MS) return;
  try {
    await services.maintenance.runDue();
  } finally {
    // A failed transition or snapshot rebuild must not strand committed mail, nor a house style waiting for its job.
    const results = await Promise.allSettled([dispatchMail(services, bindings), services.houseStyle.ensureCurrent()]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}

export function queueDueWork(runtime: ReturnType<typeof createApp>, bindings: AppBindings, context: ExecutionContext, request: Request, response: Response) {
  if (bindings.EFFECTS_PAUSED === "1" || response.status >= 500) return;
  const after = (work: Promise<void>) => context.waitUntil(work.catch((cause) => console.error("Lamp could not run due work after a request; Cron retries it.", cause)));
  if (request.method !== "GET" && request.method !== "HEAD" && response.ok && new URL(request.url).pathname.startsWith("/api/app/")) {
    after(dispatchMail(runtime.services, bindings));
    return;
  }
  const now = Date.now();
  if (now - lastReadRunAt < READ_INTERVAL_MS) return;
  lastReadRunAt = now;
  after(runDueWorkWhileCronQuiet(runtime.services, bindings, now));
}
