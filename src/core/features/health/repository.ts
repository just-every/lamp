import { sql } from "drizzle-orm";

import { createDatabase } from "../../platform/db/client";

export interface HealthRepository {
  checkDatabase(): Promise<void>;
}

export function createHealthRepository(binding: D1Database): HealthRepository {
  const database = createDatabase(binding);

  return {
    async checkDatabase() {
      await database.run(sql`select 1`);
    },
  };
}
