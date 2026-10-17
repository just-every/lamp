import type { HealthRepository } from "./repository";
import type { DependencyProber } from "../../platform/health";

export type HealthStatus =
  | { status: "ok"; checkedAt: string }
  | { status: "unavailable"; dependency: "database" | "storage" | "queue" | "snapshot" };

export interface HealthService {
  /** Answers from the last good check, refreshing it through `defer` once it is older than HEALTH_REFRESH_MS. */
  check(defer: (work: Promise<unknown>) => void): Promise<HealthStatus>;
  /** Checks every dependency now and records the result for check(). */
  live(): Promise<HealthStatus>;
}

/** Publishes a configured page's first snapshot; true once a current snapshot exists. */
export type InitialPublication = () => Promise<boolean>;

// A good result answers health probes for this long before a request refreshes it in the background.
export const HEALTH_REFRESH_MS = 30_000;
// Older than this, a good result is not trusted: the request checks every dependency itself.
const HEALTH_TRUST_MS = 10 * 60_000;

// Per isolate and database: the last good check, and whether a snapshot is published.
// A warm probe of a published installation makes no storage call.
const remembered = new WeakMap<object, number>();
const published = new WeakSet<object>();
const refreshing = new WeakMap<object, Promise<HealthStatus>>();

export function createHealthService(repository: HealthRepository, prober: DependencyProber, publishInitialSnapshot: InitialPublication = async () => true): HealthService {
  async function probe(): Promise<HealthStatus> {
    try {
      await repository.checkDatabase();
    } catch {
      return { status: "unavailable", dependency: "database" };
    }
    try {
      await prober.checkStorage();
    } catch {
      return { status: "unavailable", dependency: "storage" };
    }
    try {
      await prober.checkQueue();
    } catch {
      return { status: "unavailable", dependency: "queue" };
    }
    return { status: "ok", checkedAt: new Date().toISOString() };
  }

  // Concurrent requests share one running check.
  function refresh(): Promise<HealthStatus> {
    const running = refreshing.get(repository.key);
    if (running) return running;
    const next = record().finally(() => refreshing.delete(repository.key));
    refreshing.set(repository.key, next);
    return next;
  }

  // Failures are never remembered: until a check succeeds, every request checks again.
  async function record(): Promise<HealthStatus> {
    const result = await probe();
    if (result.status === "ok") {
      remembered.set(repository.key, Date.parse(result.checkedAt));
      await repository.recordGood(result.checkedAt).catch((cause) => console.error("Lamp could not record its health check.", cause));
    } else {
      remembered.delete(repository.key);
      await repository.forgetGood().catch(() => undefined);
    }
    return result;
  }

  // Every hosted deployment publishes its initial state before traffic
  // arrives, even before Cloudflare starts Cron. This runs no mail work.
  async function publication(): Promise<boolean> {
    if (published.has(repository.key)) return true;
    try {
      if (await publishInitialSnapshot()) published.add(repository.key);
      return true;
    } catch {
      return false;
    }
  }

  // A failed read leaves no good result, so the request checks every dependency.
  async function lastGood(): Promise<number | undefined> {
    const known = remembered.get(repository.key);
    if (known !== undefined) return known;
    const recorded = await repository.lastGood().catch(() => null);
    return recorded ? Date.parse(recorded) : undefined;
  }

  return {
    live: refresh,
    async check(defer) {
      const [publishable, checkedAt] = await Promise.all([publication(), lastGood()]);
      const age = checkedAt === undefined ? Infinity : Date.now() - checkedAt;
      let result: HealthStatus;
      if (checkedAt !== undefined && age < HEALTH_TRUST_MS) {
        remembered.set(repository.key, checkedAt);
        if (age >= HEALTH_REFRESH_MS) defer(refresh());
        result = { status: "ok", checkedAt: new Date(checkedAt).toISOString() };
      } else {
        result = await refresh();
      }
      return result.status === "ok" && !publishable ? { status: "unavailable", dependency: "snapshot" } : result;
    },
  };
}
