import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { operators } from "../../shared/schema";

export const operatorMagicLinks = sqliteTable("operator_magic_links", {
  id: text().primaryKey(),
  operatorId: text("operator_id").references(() => operators.id),
  email: text().notNull(),
  displayName: text("display_name").notNull(),
  kind: text({ enum: ["signin", "invite"] }).$type<"signin" | "invite">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  revokedAt: text("revoked_at"),
  invitedByOperatorId: text("invited_by_operator_id").references(() => operators.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("operator_magic_links_active_idx").on(table.tokenHash, table.expiresAt, table.consumedAt, table.revokedAt)]);
