import { z } from "zod";
import { emailBrandingSchema } from "../../shared/email-branding";
import { widgetAppearanceSchema } from "../../shared/widget-appearance";
import { pageThemeSchema, themeAssetPathSchema } from "../../shared/page-theme";

/**
 * The owner's page data file, `lamp-page-data` version 1 (docs/backups-and-recovery.md).
 * Records keep their table rows as stored, so a restore into a new installation
 * re-exports the same file. Operator IDs are installation-specific; records name
 * their authors by email instead, and `people` lists those authors.
 */
export const PAGE_DATA_FORMAT = "lamp-page-data";
export const PAGE_DATA_VERSION = 1;

/** Tables in restore order, each with the columns that order its rows. */
export const PAGE_DATA_TABLES = [
  { table: "component_groups", order: ["id"] },
  { table: "components", order: ["id"] },
  { table: "component_standing_claims", order: ["id"] },
  { table: "component_claim_events", order: ["id"] },
  { table: "component_state_history", order: ["id"] },
  { table: "component_state_corrections", order: ["id"] },
  { table: "incidents", order: ["id"] },
  { table: "incident_components", order: ["id"] },
  { table: "incident_updates", order: ["id"] },
  { table: "incident_drafts", order: ["id"] },
  { table: "incident_internal_notes", order: ["id"] },
  { table: "incident_reports", order: ["id"] },
  { table: "incident_impact_changes", order: ["id"] },
  { table: "incident_templates", order: ["id"] },
  { table: "incident_template_components", order: ["id"] },
  { table: "maintenance", order: ["id"] },
  { table: "maintenance_components", order: ["id"] },
  { table: "maintenance_notices", order: ["id"] },
  { table: "import_maintenance_updates", order: ["id"] },
  { table: "subscribers", order: ["id"] },
  { table: "subscriber_components", order: ["id"] },
  { table: "reference_allocations", order: ["namespace", "reference"] },
  { table: "reference_counters", order: ["namespace"] },
] as const;

export type PageDataTable = typeof PAGE_DATA_TABLES[number]["table"];

/** A restore needs a page with none of these yet. */
export const OWNER_RECORD_TABLES: PageDataTable[] = ["component_groups", "components", "incidents", "maintenance", "subscribers", "incident_templates"];

/** Operator ID columns and the email column that replaces each in the file. */
export const AUTHOR_COLUMNS: Record<string, string> = {
  operator_id: "operator_email",
  created_by_operator_id: "created_by_email",
  author_operator_id: "author_email",
  reviewed_by_operator_id: "reviewed_by_email",
};

/** Kept out of the file: a subscriber's legacy token hash is an installation credential. */
export const OMITTED_COLUMNS: Partial<Record<PageDataTable, string[]>> = { subscribers: ["token_hash"] };

/** Derived per subscriber: when they confirmed, from their used confirmation link. */
export const SUBSCRIBER_CONSENT_COLUMN = "confirmed_at";

/** Email subscribers from a file Lamp cannot vouch for wait in this state until
 * the owner sends their confirmations, and are deleted after HELD_RESTORE_DAYS. */
export const HELD_RESTORE_REASON = "held for page data confirmation";
export const HELD_RESTORE_DAYS = 30;

const cell = z.union([z.string().refine((value) => !value.includes("\u0000"), "Text cannot contain a NUL character."), z.number(), z.null()]);
const row = z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), cell);

export const pageDataFileSchema = z.object({
  format: z.literal(PAGE_DATA_FORMAT),
  version: z.literal(PAGE_DATA_VERSION),
  exportedAt: z.string(),
  contents: z.string(),
  page: z.object({
    pageName: z.string().min(1).max(120),
    tagline: z.string().max(280),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    timezone: z.string().min(1).max(100),
    footerCreditEnabled: z.boolean(),
    // Keep absent in parsed older files so their signed content stays unchanged.
    template: z.enum(["default", "calm", "uptime", "regions"]).optional(),
    widgetAllowedOrigins: z.array(z.string()).max(50),
    // Preserve older signed files as-is; restore supplies the original embed defaults.
    widgetAppearance: widgetAppearanceSchema.optional(),
    aiToneInstructions: z.string(),
    emailBranding: emailBrandingSchema.optional(),
    // Optional fields preserve the signed representation of files from older releases.
    theme: pageThemeSchema.nullable().optional(),
    themeAssets: z.array(z.object({
      path: themeAssetPathSchema,
      kind: z.enum(["font", "image"]),
      contentType: z.enum(["font/woff2", "image/png", "image/jpeg", "image/webp"]),
      base64: z.string().max(3_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    }).strict()).optional(),
    feedId: z.string(),
    logo: z.object({ contentType: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().max(3_000_000) }).nullable(),
  }).strict(),
  people: z.array(z.object({ email: z.string().min(3).max(320), displayName: z.string().min(1).max(120) }).strict()),
  records: z.object(Object.fromEntries(PAGE_DATA_TABLES.map(({ table }) => [table, z.array(row)])) as Record<PageDataTable, z.ZodArray<typeof row>>).partial({ incident_impact_changes: true, incident_templates: true, incident_template_components: true }).strict(),
  // Files from earlier Lamp releases have none; see integrity.ts.
  integrity: z.object({ algorithm: z.literal("HMAC-SHA256"), value: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().optional(),
}).strict();

export type PageDataFile = z.infer<typeof pageDataFileSchema>;
export type PageDataRow = Record<string, string | number | null>;

export const PAGE_DATA_CONTENTS = "Page settings, theme and uploaded brand assets; component groups and components with their status history; incidents with every update, draft, internal note, impact choice and post-incident report; reusable incident templates; maintenance with its notices; subscribers with their channel, chosen components and consent state; incident and maintenance reference numbers. Authors are named by email.";
