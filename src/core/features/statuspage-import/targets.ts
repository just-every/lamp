import type { D1Database, D1Sql, D1TargetAdapter, D1UndoDependency, D1UndoEffect, TargetRow } from "../../../../modules/import-kit/src/d1/index.ts";
import { insertJsonRows } from "../../../../modules/import-kit/src/d1/sets.ts";
import { entityTables, type EntityKind, type NativeValue, type Row } from "./rows";

const kinds = Object.keys(entityTables) as EntityKind[];
const tablesOf = (kind: string) => {
  const tables = entityTables[kind as EntityKind];
  if (!tables) throw new Error("Unsupported import native kind.");
  return kind === "component" ? { ...tables, component_standing_claims: "component_id" } : kind === "maintenance" ? { ...tables, import_maintenance_updates: "maintenance_id" } : tables;
};
const valueOf = (row: TargetRow) => row.value as unknown as NativeValue;

/** Balanced AND keeps nested snapshot predicates inside D1's expression depth. */
function conjunction(parts: readonly string[]): string {
  const join = (start: number, end: number): string => end - start === 1 ? `(${parts[start]})` : `(${join(start, start + Math.floor((end - start) / 2))} AND ${join(start + Math.floor((end - start) / 2), end)})`;
  return parts.length ? join(0, parts.length) : "1";
}

/** Exactly these rows, and no others, under the entity's owning column. */
function exactRows(table: string, column: string, id: string, rows: Row[]): D1Sql {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (columns.some((key) => !/^\w+$/u.test(key))) throw new Error("Invalid native column.");
  return {
    sql: `(SELECT count(*) FROM ${table} WHERE ${column}=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM ${table} actual WHERE ${conjunction(columns.map((key) => `actual.${key} IS json_extract(wanted.value,'$.${key}')`))}))`,
    params: [id, rows.length, JSON.stringify(rows)],
  };
}

async function readTables(db: D1Database, kind: string, id: string) {
  const tables: NativeValue["tables"] = {};
  for (const [table, column] of Object.entries(tablesOf(kind))) {
    // Archive restore changes rowids. New imported history has a stable order
    // shared with its planned value, including updates at the same instant.
    const order = table === "import_maintenance_updates" ? "published_at,id" : "rowid";
    const rows = (await db.prepare(`SELECT * FROM ${table} WHERE ${column}=? ORDER BY ${order}`).bind(id).all<Row>()).results;
    // Legacy journals have no history key: empty additions must not change their revision value.
    if (!["import_maintenance_updates", "component_standing_claims"].includes(table) || rows.length) tables[table] = rows;
  }
  return tables;
}

/** Native writes for a Statuspage move-in. Every effect is one whole entity
 * (an incident with its updates, a component with its derived history), so
 * apply and undo commit or refuse it atomically with the kit's journal. */
export const statuspageTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    const marker = await db.prepare("SELECT revision FROM statuspage_import_targets WHERE kind=? AND id=?").bind(kind, id).first<{ revision: string }>();
    if (!marker) return undefined;
    return { destination, targetKind: kind, targetId: id, value: { tables: await readTables(db, kind, id) } as never, revision: marker.revision };
  },
  matches(row, destination, kind, id) {
    const parts = this.matchesParts!(row, destination, kind, id);
    return { sql: conjunction(parts.map((part) => part.sql)), params: parts.flatMap((part) => part.params ?? []) };
  },
  matchesParts(row, _destination, kind, id) {
    const parts: D1Sql[] = [{
      sql: row ? "EXISTS(SELECT 1 FROM statuspage_import_targets WHERE kind=? AND id=? AND revision=?)" : "NOT EXISTS(SELECT 1 FROM statuspage_import_targets WHERE kind=? AND id=?)",
      params: row ? [kind, id, row.revision] : [kind, id],
    }];
    for (const [table, column] of Object.entries(tablesOf(kind))) parts.push(exactRows(table, column, id, row ? valueOf(row).tables[table] ?? [] : []));
    return parts;
  },
  write(row) {
    const statements: D1Sql[] = [];
    for (const table of Object.keys(tablesOf(row.targetKind))) {
      const records = valueOf(row).tables[table] ?? [];
      if (!records.length) continue;
      const columns = Object.keys(records[0]);
      if (columns.some((key) => !/^\w+$/u.test(key)) || records.some((record) => Object.keys(record).length !== columns.length || columns.some((key) => !(key in record)))) throw new Error("Invalid native columns.");
      statements.push(...insertJsonRows(table, columns, records));
    }
    statements.push({ sql: "INSERT INTO statuspage_import_targets(kind,id,revision) VALUES(?,?,?)", params: [row.targetKind, row.targetId, row.revision] });
    return statements;
  },
  remove(_destination, kind, id) {
    // Child rows cascade from the owning row; history and claims cascade from a component.
    const [owner] = Object.keys(tablesOf(kind));
    return [{ sql: `DELETE FROM ${owner} WHERE id=?`, params: [id] }, { sql: "DELETE FROM statuspage_import_targets WHERE kind=? AND id=?", params: [kind, id] }];
  },
  async list(db, destination) {
    const markers = (await db.prepare("SELECT kind,id,revision FROM statuspage_import_targets ORDER BY kind,id").all<{ kind: string; id: string; revision: string }>()).results;
    const rows: TargetRow[] = [];
    for (const marker of markers) rows.push({ destination, targetKind: marker.kind, targetId: marker.id, revision: marker.revision, value: { tables: await readTables(db, marker.kind, marker.id) } as never });
    return rows;
  },
  matchesCount(count) {
    return { sql: "(SELECT count(*) FROM statuspage_import_targets)=?", params: [count] };
  },
  async preparePreservedUndo(db: D1Database, destination: string, effects: D1UndoEffect[]) {
    const observations = [], dependencies: D1UndoDependency[] = [], guards: D1Sql[] = [];
    for (const effect of effects) {
      const { targetKind: kind, targetId: id } = effect.expected;
      const current = await this.read(db, destination, kind, id);
      observations.push({ effectId: effect.provenance.id, current: current ?? null, entity: { table: Object.keys(tablesOf(kind))[0], recordId: id } });
      guards.push(...this.matchesParts!(current ?? null, destination, kind, id));
      // A component or group stays while anything native still cites it.
      const citing = kind === "group" ? [["components", "group_id"]] : kind === "component" ? [["incident_components", "component_id"], ["maintenance_components", "component_id"], ["subscriber_components", "component_id"], ["component_standing_claims", "component_id"]] : [];
      for (const [table, column] of citing) {
        const rows = (await db.prepare(`SELECT id FROM ${table} WHERE ${column}=? ORDER BY id`).bind(id).all<{ id: string }>()).results;
        guards.push({ sql: `(SELECT json_group_array(id) FROM (SELECT id FROM ${table} WHERE ${column}=? ORDER BY id))=?`, params: [id, JSON.stringify(rows.map((row) => row.id))] });
        for (const cited of rows) {
          // An imported citer reverses first; a native citer keeps this record.
          const related = effects.find((candidate) => ownsRow(candidate, table, cited.id));
          // Owned child rows reverse with this effect; they cannot depend on
          // their own reversal. Their query and equality guards still apply.
          if (related === effect) continue;
          dependencies.push({ requiredEffectId: effect.provenance.id, ...(related ? { dependentEffectId: related.provenance.id } : {}), cause: { table, recordId: cited.id }, evidence: { reason: `Cited by ${table}.` } as never });
        }
      }
    }
    return { observations, dependencies, guards: guards.length ? guards : [{ sql: "(SELECT count(*) FROM statuspage_import_targets)>=0" }] };
  },
};

function ownsRow(effect: D1UndoEffect, table: string, rowId: string) {
  const value = effect.expected.value as unknown as NativeValue | undefined;
  return Boolean(value?.tables?.[table]?.some((row) => row.id === rowId));
}

export const importedKinds = kinds;
