import { createUlid } from "../../shared/ids";
import { storedTemplate, type PageTemplate } from "../../shared/page-template";
import { AUTHOR_COLUMNS, HELD_RESTORE_REASON, OMITTED_COLUMNS, OWNER_RECORD_TABLES, PAGE_DATA_TABLES, SUBSCRIBER_CONSENT_COLUMN, type PageDataRow, type PageDataTable } from "./format";

/** The restore found owner records written since its check; it wrote nothing. */
export class PageNotEmptyError extends Error {
  constructor(readonly tables: PageDataTable[]) {
    super("The page is no longer empty.");
    this.name = "PageNotEmptyError";
  }
}

export interface StoredPageSettingsRow {
  page_name: string;
  tagline: string;
  accent_color: string;
  timezone: string;
  footer_credit_enabled: number;
  template: "default" | "calm" | "uptime" | "regions";
  house_style: number;
  widget_allowed_origins: string;
  ai_tone_instructions: string;
  email_branding: string;
  feed_id: string;
  logo_key: string | null;
  logo_content_type: string | null;
}

export interface PageSettingsWrite {
  pageName: string;
  tagline: string;
  accentColor: string;
  timezone: string;
  footerCreditEnabled: boolean;
  template: PageTemplate;
  widgetAllowedOrigins: string;
  aiToneInstructions: string;
  emailBranding: string;
  feedId: string;
  logoKey: string | null;
  logoContentType: string | null;
}

export interface PageExportRepository {
  readSettings(): Promise<StoredPageSettingsRow | null>;
  /** Every page data table, read in one transaction, with operator IDs as stored. */
  readTables(): Promise<Record<PageDataTable, PageDataRow[]>>;
  operatorsById(ids: string[]): Promise<Map<string, { email: string; displayName: string }>>;
  operatorIdsByEmail(emails: string[]): Promise<Map<string, string>>;
  columns(table: PageDataTable): Promise<Set<string>>;
  ownerRecordCounts(): Promise<Record<string, number>>;
  restore(input: {
    existingPeople: Map<string, string>;
    newPeople: { email: string; displayName: string }[];
    tables: { table: PageDataTable; rows: PageDataRow[] }[];
    confirmations: { subscriberId: string; confirmedAt: string; subscribedAt: string }[];
    settings: PageSettingsWrite;
    now: string;
  }): Promise<void>;
  heldSubscriberIds(limit: number): Promise<{ id: string; heldAt: string }[]>;
  /** Moves one held email subscriber to pending, its 72-hour window starting now; false when it is no longer held. */
  releaseHeld(subscriberId: string, now: string): Promise<boolean>;
  holdAgain(subscriberId: string, heldAt: string, releasedAt: string): Promise<void>;
  heldSummary(): Promise<{ held: number; earliest: string | null }>;
  deleteHeldBefore(cutoff: string): Promise<void>;
}

const MAX_STATEMENT_BYTES = 90_000;
const MAX_ROWS_PER_STATEMENT = 400;

function identifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}

// Values travel as SQL literals so a page's whole restore fits in a few
// statements of one D1 batch (one transaction) whatever its row count.
function literal(value: string | number | null) {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("A number in the file is not finite.");
    return String(value);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function insertStatements(table: string, rows: PageDataRow[], verb = "INSERT INTO") {
  const statements: string[] = [];
  let index = 0;
  while (index < rows.length) {
    const columns = Object.keys(rows[index]);
    const head = `${verb} ${identifier(table)} (${columns.map(identifier).join(", ")}) VALUES `;
    const values: string[] = [];
    let bytes = head.length;
    while (index < rows.length && values.length < MAX_ROWS_PER_STATEMENT) {
      const keys = Object.keys(rows[index]);
      if (keys.length !== columns.length || keys.some((key, position) => key !== columns[position])) break;
      const tuple = `(${columns.map((column) => literal(rows[index][column])).join(", ")})`;
      if (values.length && bytes + tuple.length + 2 > MAX_STATEMENT_BYTES) break;
      values.push(tuple);
      bytes += tuple.length + 2;
      index += 1;
    }
    statements.push(head + values.join(", "));
  }
  return statements;
}

function erasedOperatorId(email: string) {
  // An erased operator keeps an anonymous address that embeds its ID; the
  // former-operator list hides that pair, so it is restored with the same ID.
  const match = /^deleted-([0-9a-hjkmnp-tv-z]{26})@operator\.invalid$/.exec(email);
  return match ? match[1].toUpperCase() : null;
}

export function createPageExportRepository(binding: D1Database): PageExportRepository {
  const repository: PageExportRepository = {
    async readSettings() {
      return binding.prepare("SELECT page_name, tagline, accent_color, timezone, footer_credit_enabled, template, house_style, widget_allowed_origins, ai_tone_instructions, email_branding, feed_id, logo_key, logo_content_type FROM page_settings WHERE id = 'default'").first<StoredPageSettingsRow>();
    },
    async readTables() {
      const statements = PAGE_DATA_TABLES.map(({ table, order }) => table === "subscribers"
        ? binding.prepare(`SELECT s.*, (SELECT MAX(t.revoked_at) FROM subscriber_tokens AS t WHERE t.subscriber_id = s.id AND t.scope = 'confirm' AND t.revoked_at IS NOT NULL AND (s.deactivated_at IS NULL OR t.revoked_at < s.deactivated_at)) AS ${SUBSCRIBER_CONSENT_COLUMN} FROM subscribers AS s ORDER BY s.id`)
        : binding.prepare(`SELECT * FROM ${identifier(table)} ORDER BY ${order.map(identifier).join(", ")}`));
      const results = await binding.batch<PageDataRow>(statements);
      return Object.fromEntries(PAGE_DATA_TABLES.map(({ table }, position) => {
        const omitted = OMITTED_COLUMNS[table] ?? [];
        return [table, results[position].results.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !omitted.includes(column))))];
      })) as Record<PageDataTable, PageDataRow[]>;
    },
    async operatorsById(ids) {
      const people = new Map<string, { email: string; displayName: string }>();
      if (!ids.length) return people;
      const rows = await binding.prepare(`SELECT id, email, display_name FROM operators WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(ids)).all<{ id: string; email: string; display_name: string }>();
      for (const row of rows.results) people.set(row.id, { email: row.email, displayName: row.display_name });
      return people;
    },
    async operatorIdsByEmail(emails) {
      const ids = new Map<string, string>();
      if (!emails.length) return ids;
      const rows = await binding.prepare(`SELECT id, lower(email) AS email FROM operators WHERE lower(email) IN (SELECT lower(value) FROM json_each(?))`).bind(JSON.stringify(emails)).all<{ id: string; email: string }>();
      for (const row of rows.results) ids.set(row.email, row.id);
      return ids;
    },
    async columns(table) {
      const rows = await binding.prepare(`SELECT name FROM pragma_table_info(?)`).bind(table).all<{ name: string }>();
      return new Set(rows.results.map((row) => row.name));
    },
    async ownerRecordCounts() {
      const results = await binding.batch<{ count: number }>(OWNER_RECORD_TABLES.map((table) => binding.prepare(`SELECT COUNT(*) AS count FROM ${identifier(table)}`)));
      return Object.fromEntries(OWNER_RECORD_TABLES.map((table, position) => [table, Number(results[position].results[0]?.count ?? 0)]));
    },
    async restore({ existingPeople, newPeople, tables, confirmations, settings, now }) {
      const ids = new Map(existingPeople);
      const sql: string[] = [];
      // Authors who are not operators here become former operators: their
      // records keep their name, and they cannot sign in unless invited.
      for (const person of newPeople) {
        const email = person.email.toLowerCase();
        const id = erasedOperatorId(email) ?? createUlid();
        ids.set(email, id);
        sql.push(`INSERT INTO oa_operators (id, email, display_name, role, status, version, created_at) VALUES (${literal(id)}, ${literal(email)}, ${literal(person.displayName)}, 'owner', 'inactive', 1, ${Date.parse(now)})`);
      }
      const withOperatorIds = (row: PageDataRow) => Object.fromEntries(Object.entries(row).map(([column, value]) => {
        const operatorColumn = Object.keys(AUTHOR_COLUMNS).find((name) => AUTHOR_COLUMNS[name] === column);
        if (!operatorColumn) return [column, value];
        if (value === null) return [operatorColumn, null];
        const id = typeof value === "string" ? ids.get(value.toLowerCase()) : undefined;
        if (!id) throw new Error(`The file names an author that is not in its people list: ${String(value)}.`);
        return [operatorColumn, id];
      }));
      for (const { table, rows } of tables) {
        if (!rows.length) continue;
        const verb = table === "reference_allocations" ? "INSERT OR IGNORE INTO" : "INSERT INTO";
        // A new page may already count references; keep the higher number.
        const conflict = table === "reference_counters" ? " ON CONFLICT(namespace) DO UPDATE SET last_number = MAX(last_number, excluded.last_number)" : "";
        for (const statement of insertStatements(table, rows.map(withOperatorIds), verb)) sql.push(statement + conflict);
      }
      // A used confirmation link is the subscriber's recorded consent.
      const consent = confirmations.map((entry) => ({ id: createUlid(), subscriber_id: entry.subscriberId, scope: "confirm", token_hash: `restored-consent-${createUlid()}`, expires_at: entry.confirmedAt, revoked_at: entry.confirmedAt, created_at: entry.subscribedAt, updated_at: entry.confirmedAt }));
      sql.push(...insertStatements("subscriber_tokens", consent));
      const template = storedTemplate(settings.template);
      sql.push(`UPDATE page_settings SET page_name = ${literal(settings.pageName)}, tagline = ${literal(settings.tagline)}, accent_color = ${literal(settings.accentColor)}, timezone = ${literal(settings.timezone)}, footer_credit_enabled = ${settings.footerCreditEnabled ? 1 : 0}, template = ${literal(template.template)}, house_style = ${template.houseStyle ? 1 : 0}, widget_allowed_origins = ${literal(settings.widgetAllowedOrigins)}, ai_tone_instructions = ${literal(settings.aiToneInstructions)}, email_branding = ${literal(settings.emailBranding)}, feed_id = ${literal(settings.feedId)}, logo_key = ${literal(settings.logoKey)}, logo_content_type = ${literal(settings.logoContentType)}, updated_at = ${literal(now)} WHERE id = 'default'`);
      // One batch is one transaction: a refused row leaves the page unchanged.
      // The guard fails (json() refuses the text) when the page holds
      // owner records, so a write that lands after the check stops the restore.
      // Workerd limits compound SELECTs to five terms. Independent existence
      // checks also cover the sixth owner table without a compound query.
      const holdsRecords = OWNER_RECORD_TABLES.map((table) => `EXISTS (SELECT 1 FROM ${identifier(table)})`).join(" OR ");
      const emptyPage = `SELECT json(CASE WHEN ${holdsRecords} THEN 'page holds owner records' ELSE '0' END)`;
      try {
        await binding.batch([binding.prepare("PRAGMA defer_foreign_keys = ON"), binding.prepare(emptyPage), ...sql.map((statement) => binding.prepare(statement))]);
      } catch (cause) {
        const counts = await repository.ownerRecordCounts();
        const held = OWNER_RECORD_TABLES.filter((table) => counts[table] > 0);
        if (held.length) throw new PageNotEmptyError(held);
        throw cause;
      }
    },
    async heldSubscriberIds(limit) {
      const rows = await binding.prepare("SELECT id, deactivated_at AS heldAt FROM subscribers WHERE state = 'deactivated' AND deactivation_reason = ? AND channel = 'email' ORDER BY id LIMIT ?").bind(HELD_RESTORE_REASON, limit).all<{ id: string; heldAt: string }>();
      return rows.results;
    },
    async releaseHeld(subscriberId, now) {
      const result = await binding.prepare("UPDATE subscribers SET state = 'pending', deactivation_reason = NULL, deactivated_at = NULL, created_at = ?, updated_at = ? WHERE id = ? AND state = 'deactivated' AND deactivation_reason = ? AND channel = 'email' RETURNING id").bind(now, now, subscriberId, HELD_RESTORE_REASON).first<{ id: string }>();
      return result?.id === subscriberId;
    },
    async holdAgain(subscriberId, heldAt, releasedAt) {
      await binding.prepare("UPDATE subscribers SET state = 'deactivated', deactivation_reason = ?, deactivated_at = ?, updated_at = ? WHERE id = ? AND state = 'pending' AND created_at = ?").bind(HELD_RESTORE_REASON, heldAt, heldAt, subscriberId, releasedAt).run();
    },
    async heldSummary() {
      const row = await binding.prepare("SELECT COUNT(*) AS held, MIN(deactivated_at) AS earliest FROM subscribers WHERE state = 'deactivated' AND deactivation_reason = ? AND channel = 'email'").bind(HELD_RESTORE_REASON).first<{ held: number; earliest: string | null }>();
      return { held: Number(row?.held ?? 0), earliest: row?.earliest ?? null };
    },
    async deleteHeldBefore(cutoff) {
      await binding.prepare("DELETE FROM subscribers WHERE state = 'deactivated' AND deactivation_reason = ? AND deactivated_at < ?").bind(HELD_RESTORE_REASON, cutoff).run();
    },
  };
  return repository;
}
