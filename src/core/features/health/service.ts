import type { HealthRepository } from "./repository";
import type { DependencyProber } from "../../platform/health";

export type HealthStatus =
  | { status: "ok" }
  | { status: "unavailable"; dependency: "database" | "storage" | "queue" };

export interface HealthService {
  check(): Promise<HealthStatus>;
}

export function createHealthService(repository: HealthRepository, prober: DependencyProber): HealthService {
  return {
    async check() {
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
      return { status: "ok" };
    },
  };
}
