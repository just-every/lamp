import { emailBrandingSchema } from "../../shared/email-branding";
import { createUlid, nowIso } from "../../shared/ids";
import { parseWidgetAllowedOrigins } from "../../shared/widget-origins";
import type { BlobStore } from "../../platform/blobs/store";
import { isMailPreparationError } from "../../platform/mail/sender";
import { AUTHOR_COLUMNS, HELD_RESTORE_DAYS, HELD_RESTORE_REASON, OWNER_RECORD_TABLES, PAGE_DATA_CONTENTS, PAGE_DATA_FORMAT, PAGE_DATA_TABLES, PAGE_DATA_VERSION, SUBSCRIBER_CONSENT_COLUMN, pageDataFileSchema, type PageDataFile, type PageDataRow, type PageDataTable } from "./format";
import { pageDataProvenance, signPageData, type PageDataProvenance } from "./integrity";
import { PageNotEmptyError, type PageExportRepository } from "./repository";

export interface SubscriberConsent {
  /** Whether restored email subscribers keep the state the file gives them. */
  kept: boolean;
  provenance: PageDataProvenance;
  /** Email subscribers the file shows subscribed or pending. Kept, or held until the owner sends confirmations. */
  emailSubscribers: number;
}

export interface PageDataCheck {
  ok: boolean;
  problems: string[];
  counts: Record<string, number>;
  exportedAt: string | null;
  pageName: string | null;
  consent?: SubscriberConsent;
}

export interface HeldConfirmations {
  held: number;
  /** When the earliest held subscriber is deleted unless their confirmation was sent. */
  deleteAfter: string | null;
}

const COUNTED: { label: string; table: PageDataTable }[] = [
  { label: "componentGroups", table: "component_groups" },
  { label: "components", table: "components" },
  { label: "incidents", table: "incidents" },
  { label: "incidentUpdates", table: "incident_updates" },
  { label: "maintenance", table: "maintenance" },
  { label: "subscribers", table: "subscribers" },
];

const CONFIRMATIONS_PER_REQUEST = 50;
const HELD_MS = HELD_RESTORE_DAYS * 24 * 60 * 60 * 1000;

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

const awaitingConsent = (row: PageDataRow) => row.channel === "email" && (row.state === "active" || row.state === "pending");

const ownerRecordsProblem = (tables: PageDataTable[]) => `This page already holds ${tables.map((table) => table.replaceAll("_", " ")).join(", ")}. Restore into a new Lamp installation, before you add anything to it.`;

export interface PageExportOptions {
  /** The installation's SUBSCRIBER_TOKEN_SECRET; it keys the file's integrity value. */
  integritySecret?: string;
  mailIdentityEditable?: boolean;
  onPublicDataChanged: () => Promise<void>;
  /** Sends a held subscriber, already moved to pending, their one confirmation email. */
  sendConfirmation: (subscriberId: string) => Promise<boolean>;
}

export function createPageExportService(repository: PageExportRepository, blobs: BlobStore, options: PageExportOptions) {
  function integritySecret() {
    if (!options.integritySecret) throw new Error("Page data needs SUBSCRIBER_TOKEN_SECRET to sign and check its files.");
    return options.integritySecret;
  }

  async function exportFile(): Promise<PageDataFile> {
    const secret = integritySecret();
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
    return signPageData(secret, {
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
        template: settings.template,
        widgetAllowedOrigins: parseWidgetAllowedOrigins(settings.widget_allowed_origins),
        aiToneInstructions: settings.ai_tone_instructions,
        emailBranding: emailBrandingSchema.parse(JSON.parse(settings.email_branding)),
        feedId: settings.feed_id,
        logo: logo && settings.logo_content_type ? { contentType: settings.logo_content_type as "image/png" | "image/jpeg" | "image/webp", base64: base64(logo.bytes) } : null,
      },
      people: [...new Map([...people.values()].map((person) => [person.email, person])).values()].sort((left, right) => left.email.localeCompare(right.email)),
      records,
    });
  }

  async function check(input: unknown): Promise<PageDataCheck & { file?: PageDataFile }> {
    const parsed = pageDataFileSchema.safeParse(input);
    if (!parsed.success) {
      const format = typeof input === "object" && input && "format" in input ? (input as { format: unknown }).format : undefined;
      return { ok: false, problems: [format === PAGE_DATA_FORMAT ? `This page data file does not match version ${PAGE_DATA_VERSION}: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "file"}: ${issue.message}`).join("; ")}.` : "This is not a Lamp page data file. Download one from Settings → Export page data on the Lamp page you are leaving."], counts: {}, exportedAt: null, pageName: null };
    }
    const file = parsed.data;
    const problems: string[] = [];
    if (options.mailIdentityEditable === false && (file.page.emailBranding?.displayName || file.page.emailBranding?.replyTo)) problems.push("Managed mail controls From and Reply-To. Clear those branding fields in the source before restoring.");
    const existing = await repository.ownerRecordCounts();
    const held = OWNER_RECORD_TABLES.filter((table) => existing[table] > 0);
    if (held.length) problems.push(ownerRecordsProblem(held));
    const people = new Set(file.people.map((person) => person.email.toLowerCase()));
    for (const { table } of PAGE_DATA_TABLES) {
      const rows = file.records[table] ?? [];
      if (!rows.length) continue;
      const columns = await repository.columns(table);
      const accepted = new Set([...columns, ...Object.entries(AUTHOR_COLUMNS).filter(([column]) => columns.has(column)).map(([, email]) => email), ...(table === "subscribers" ? [SUBSCRIBER_CONSENT_COLUMN] : [])]);
      const unknown = [...new Set(rows.flatMap((row) => Object.keys(row).filter((column) => !accepted.has(column))))];
      if (unknown.length) problems.push(`${table} has fields this Lamp version does not know: ${unknown.join(", ")}. Update this installation to the release that made the file, then restore.`);
      const authors = rows.flatMap((row) => Object.values(AUTHOR_COLUMNS).map((column) => row[column]).filter((value): value is string => typeof value === "string" && !people.has(value.toLowerCase())));
      if (authors.length) problems.push(`${table} names authors missing from the people list: ${[...new Set(authors)].slice(0, 3).join(", ")}.`);
    }
    const provenance = await pageDataProvenance(integritySecret(), file);
    return {
      ok: problems.length === 0,
      problems,
      counts: {
        ...Object.fromEntries(COUNTED.map(({ label, table }) => [label, (file.records[table] ?? []).length])),
        // These carry on here as scheduled; any already due run on the next minute.
        scheduledUpdates: file.records.incident_drafts.filter((row) => typeof row.scheduled_publish_at === "string").length,
        openMaintenance: file.records.maintenance.filter((row) => row.state === "Scheduled" || row.state === "In progress").length,
      },
      exportedAt: file.exportedAt,
      pageName: file.page.pageName,
      consent: { kept: provenance === "verified", provenance, emailSubscribers: file.records.subscribers.filter(awaitingConsent).length },
      file,
    };
  }

  /** Moves held subscribers to pending, one at a time, and sends each one confirmation. */
  async function sendConfirmations(): Promise<{ sent: number } & HeldConfirmations> {
    let sent = 0;
    for (const { id, heldAt } of await repository.heldSubscriberIds(CONFIRMATIONS_PER_REQUEST)) {
      // Moving the row to pending is the claim: a concurrent request finds it gone.
      const claimedAt = nowIso();
      if (!await repository.releaseHeld(id, claimedAt)) continue;
      try {
        if (await options.sendConfirmation(id)) sent += 1;
      } catch (error) {
        // Only an adapter's proof that nothing was submitted puts the row back.
        if (isMailPreparationError(error)) await repository.holdAgain(id, heldAt, claimedAt);
        throw error;
      }
    }
    return { sent, ...await heldConfirmations() };
  }

  async function heldConfirmations(): Promise<HeldConfirmations> {
    const { held, earliest } = await repository.heldSummary();
    return { held, deleteAfter: earliest ? new Date(Date.parse(earliest) + HELD_MS).toISOString() : null };
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
      const consentKept = result.consent?.kept === true;
      const existingPeople = await repository.operatorIdsByEmail(file.people.map((person) => person.email));
      const newPeople = file.people.filter((person) => !existingPeople.has(person.email.toLowerCase()));
      const confirmations: { subscriberId: string; confirmedAt: string; subscribedAt: string }[] = [];
      const tables = PAGE_DATA_TABLES.map(({ table }) => ({
        table,
        rows: (file.records[table] ?? []).map((row): PageDataRow => {
          if (table !== "subscribers") return row;
          const { [SUBSCRIBER_CONSENT_COLUMN]: confirmedAt, ...stored } = row;
          // The legacy per-subscriber hash is never exported; each restored row gets a fresh one.
          const restored = { ...stored, token_hash: `restored-${createUlid()}` };
          // Without a file this installation can vouch for, an email address has
          // shown no consent here: it waits, as a move-in import's does, until the
          // owner sends its one confirmation (NOTIFY-008, MOVE-002).
          if (!consentKept && awaitingConsent(row)) return { ...restored, state: "deactivated", deactivation_reason: HELD_RESTORE_REASON, deactivated_at: now, updated_at: now };
          if (typeof confirmedAt === "string" && consentKept) confirmations.push({ subscriberId: String(stored.id), confirmedAt, subscribedAt: String(stored.created_at) });
          return restored;
        }),
      }));
      let logoKey: string | null = null;
      if (file.page.logo) {
        logoKey = `branding/logos/${createUlid()}`;
        await blobs.putBytes(logoKey, fromBase64(file.page.logo.base64), file.page.logo.contentType);
      }
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
            template: file.page.template ?? "default",
            widgetAllowedOrigins: JSON.stringify(file.page.widgetAllowedOrigins),
            aiToneInstructions: file.page.aiToneInstructions,
            emailBranding: JSON.stringify(file.page.emailBranding ?? {}),
            feedId: file.page.feedId,
            logoKey,
            logoContentType: file.page.logo?.contentType ?? null,
          },
        });
      } catch (cause) {
        // The logo is stored before the transaction; a refused restore removes it.
        if (logoKey) await blobs.delete(logoKey);
        if (cause instanceof PageNotEmptyError) return { ...result, ok: false, problems: [ownerRecordsProblem(cause.tables)] };
        return { ...result, ok: false, problems: [`Nothing was restored: the page refused a record (${cause instanceof Error ? cause.message : String(cause)}).`] };
      }
      await options.onPublicDataChanged();
      return result;
    },
    heldConfirmations,
    sendConfirmations,
    /** Held subscribers the owner never sent confirmations to are deleted, addresses and all. */
    async expireHeld(now = Date.now()) {
      await repository.deleteHeldBefore(new Date(now - HELD_MS).toISOString());
    },
  };
}

export type PageExportService = ReturnType<typeof createPageExportService>;
