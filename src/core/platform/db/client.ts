import { drizzle } from "drizzle-orm/d1";

export function createDatabase(binding: D1Database) {
  return drizzle(binding);
}
