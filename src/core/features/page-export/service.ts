import { createUlid, nowIso } from "../../shared/ids";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import type { BlobStore } from "../../platform/blobs/store";
import { AUTHOR_COLUMNS, OWNER_RECORD_TABLES, PAGE_DATA_CONTENTS, PAGE_DATA_FORMAT, PAGE_DATA_TABLES, PAGE_DATA_VERSION, SUBSCRIBER_CONSENT_COLUMN, pageDataFileSchema, type PageDataFile, type PageDataRow, type PageDataTable } from "./format";
import type { PageExportRepository } from "./repository";

export interface PageDataCheck {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
  exportedAt: string | null;
  pageName: string | null;
}

const COUNTED: { label: string; table: PageDataTable }[] = [
  { label: "componentGroups", table: "component_groups" },
  { label: "components", table: "components" },
  { label: "incidents", table: "incidents" },
  { label: "incidentUpdates", table: "incident_updates" },
  { label: "maintenance", table: "maintenance" },
  { label: "subscribers", table: "subscribers" },
];

function base64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let index = 0; index < view.length; index += 0x8000) binary += String.fromCharCode(...view.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export function createPageExportService(repository: PageExportRepository, blobs: BlobStore, onPublicDataChanged: () => Promise<void>) {
  async function exportFile(): Promise<PageDataFile> {
    const settings = await repository.readSettings();
    if (!settings) throw new Error("Page settings are not configured.");
    const tables = await repository.readTables();
    const operatorIds = new Set<string>();
    for (const rows of Object.values(tables)) for (const row of rows) for (const column of Object.keys(AUTHOR_COLUMNS)) {
      if (typeof row[column] === "string") operatorIds.add(row[column] as string);
    }
    const people = await repository.operatorsById([...operatorIds]);
    const records = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => {
      const emailColumn = AUTHOR_COLUMNS[column];
      if (!emailColumn) return [column, value];
      if (value === null) return [emailColumn, null];
      const person = people.get(String(value));
      if (!person) throw new Error(`A ${table} record names an operator this page no longer holds.`);
      return [emailColumn, person.email];
    })))])) as PageDataFile["records"];
    const logo = settings.logo_key ? await blobs.getBytes(settings.logo_key) : null;
    return {
      format: PAGE_DATA_FORMAT,
      version: PAGE_DATA_VERSION,
      exportedAt: nowIso(),
      contents: PAGE_DATA_CONTENTS,
      page: {
        pageName: settings.page_name,
        tagline: settings.tagline,
        accentColor: settings.accent_color,
        timezone: settings.timezone,
        footerCreditEnabled: settings.footer_credit_enabled === 1,
        widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widget_allowed_origins),
        aiToneInstructions: settings.ai_tone_instructions,
        feedId: settings.feed_id,
        logo: logo && settings.logo_content_type ? { contentType: settings.logo_content_type as "image/png" | "image/jpeg" | "image/webp", base64: base64(logo.bytes) } : null,
      },
      people: [...new Map([...people.values()].map((person) => [person.email, person])).values()].sort((left, right) => left.email.localeCompare(right.email)),
      records,
    };
  }

  async function check(input: unknown): Promise<PageDataCheck & { file?: PageDataFile }> {
    const parsed = pageDataFileSchema.safeParse(input);
    if (!parsed.success) {
      const format = typeof input === "object" && input && "format" in input ? (input as { format: unknown }).format : undefined;
      return { ok: false, problems: [format === PAGE_DATA_FORMAT ? `This page data file does not match version ${PAGE_DATA_VERSION}: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}.` : "This is not a Lamp page data file. Download one from Settings → Export page data on the Lamp page you are leaving."], counts: {}, exportedAt: null, pageName: null };
    }
    const file = parsed.data;
    const problems: string[] = [];
    const existing = await repository.ownerRecordCounts();
    const held = OWNER_RECORD_TABLES.filter((table) => existing[table] > 0);
    if (held.length) problems.push(`This page already holds ${held.map((table) => table.replaceAll("_", " ")).join(", ")}. Restore into a new Lamp installation, before you add anything to it.`);
    const people = new Set(file.people.map((person) => person.email.toLowerCase()));
    for (const { table } of PAGE_DATA_TABLES) {
      const rows = file.records[table];
      if (!rows.length) continue;
      const columns = await repository.columns(table);
      const accepted = new Set([...columns, ...Object.entries(AUTHOR_COLUMNS).filter(([column]) => columns.has(column)).map(([, email]) => email), ...(table === "subscribers" ? [SUBSCRIBER_CONSENT_COLUMN] : [])]);
      const unknown = [...new Set(rows.flatMap((row) => Object.keys(row).filter((column) => !accepted.has(column))))];
      if (unknown.length) problems.push(`${table} has fields this Lamp version does not know: ${unknown.join(", ")}. Update this installation to the release that made the file, then restore.`);
      const authors = rows.flatMap((row) => Object.values(AUTHOR_COLUMNS).map((column) => row[column]).filter((value): value is string => typeof value === "string" && !people.has(value.toLowerCase())));
      if (authors.length) problems.push(`${table} names authors missing from the people list: ${[...new Set(authors)].slice(0, 3).join(", ")}.`);
    }
    return {
      ok: problems.length === 0,
      problems,
      counts: Object.fromEntries(COUNTED.map(({ label, table }) => [label, file.records[table].length])),
      exportedAt: file.exportedAt,
      pageName: file.page.pageName,
      file,
    };
  }

  return {
    exportFile,
    async check(input: unknown): Promise<PageDataCheck> {
      const { file: _file, ...result } = await check(input);
      return result;
    },
    async restore(input: unknown): Promise<PageDataCheck> {
      const { file, ...result } = await check(input);
      if (!result.ok || !file) return result;
      const now = nowIso();
      const existingPeople = await repository.operatorIdsByEmail(file.people.map((person) => person.email));
      const newPeople = file.people.filter((person) => !existingPeople.has(person.email.toLowerCase()));
      let logoKey: string | null = null;
      if (file.page.logo) {
        logoKey = `branding/logos/${createUlid()}`;
        await blobs.putBytes(logoKey, fromBase64(file.page.logo.base64), file.page.logo.contentType);
      }
      const confirmations: { subscriberId: string; confirmedAt: string; subscribedAt: string }[] = [];
      const tables = PAGE_DATA_TABLES.map(({ table }) => ({
        table,
        rows: file.records[table].map((row): PageDataRow => {
          if (table !== "subscribers") return row;
          const { [SUBSCRIBER_CONSENT_COLUMN]: confirmedAt, ...stored } = row;
          if (typeof confirmedAt === "string") confirmations.push({ subscriberId: String(stored.id), confirmedAt, subscribedAt: String(stored.created_at) });
          // The legacy per-subscriber hash is never exported; each restored row gets a fresh one.
          return { ...stored, token_hash: `restored-${createUlid()}` };
        }),
      }));
      try {
        await repository.restore({
          existingPeople,
          newPeople,
          tables,
          confirmations,
          now,
          settings: {
            pageName: file.page.pageName,
            tagline: file.page.tagline,
            accentColor: file.page.accentColor,
            timezone: file.page.timezone,
            footerCreditEnabled: file.page.footerCreditEnabled,
            widgetAllowedOrigins: JSON.stringify(file.page.widgetAllowedOrigins),
            aiToneInstructions: file.page.aiToneInstructions,
            feedId: file.page.feedId,
            logoKey,
            logoContentType: file.page.logo?.contentType ?? null,
          },
        });
      } catch (cause) {
        return { ...result, ok: false, problems: [`Nothing was restored: the page refused a record (${cause instanceof Error ? cause.message : String(cause)}).`] };
      }
      await onPublicDataChanged();
      return result;
    },
  };
}

export type PageExportService = ReturnType<typeof createPageExportService>;
