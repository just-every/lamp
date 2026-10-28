import type { D1Database, D1Sql, D1TargetAdapter, D1UndoDependency, D1UndoEffect, TargetRow } from "../../../../modules/import-kit/src/d1/index.ts";
import { insertJsonRows } from "../../../../modules/import-kit/src/d1/sets.ts";
import { entityTables, type EntityKind, type NativeValue, type Row } from "./rows";
import { allMarkers, markerTable, markerWhere, sealedDefaults, tablesOf } from "./native-tables";
import { createUlid, nowIso } from "../../shared/ids";
import { matchesAll } from "./target-digest";

const kinds = Object.keys(entityTables) as EntityKind[];
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
    sql: `(SELECT count(*) FROM ${table} WHERE ${column}=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM ${table} actual WHERE ${conjunction(columns.map((key) => {
      const wanted = `json_extract(wanted.value,'$.${key}')`;
      // One incident can mix sealed pre-migration updates with a later native
      // publication. Missing new fields mean their database default, not NULL.
      const value = table === "incident_updates" && ["component_changes_json", "component_snapshot_json"].includes(key) ? `COALESCE(${wanted},'[]')` : wanted;
      return `actual.${key} IS ${value}`;
    }))}))`,
    params: [id, rows.length, JSON.stringify(rows)],
  };
}

/** No subscriber row beyond the anonymised record an operator's deletion keeps
 * (destination `deleted:<id>`) for its delivery history; no import owns it. */
const anonymisedOnly = (id: string): D1Sql => ({ sql: "NOT EXISTS(SELECT 1 FROM subscribers WHERE id=? AND destination<>'deleted:'||id)", params: [id] });

// Archive restore changes rowids. New imported history has a stable order
// shared with its planned value, including updates at the same instant.
const orderOf = (table: string) => table === "import_maintenance_updates" ? "x.published_at,x.id" : table === "incident_template_components" ? "x.id" : "x.rowid";

/** One owner's rows of one table, as its revision value holds them. */
function settle(tables: NativeValue["tables"], table: string, rows: Row[]) {
  // Defaults added after old import journals were sealed do not constitute
  // an owner edit. Non-default values remain visible to custody and undo.
  for (const [column, value] of Object.entries(sealedDefaults[table] ?? {})) for (const row of rows) if (row[column] === value) delete row[column];
  // Legacy journals have no history key: empty additions must not change their revision value.
  if (!["import_maintenance_updates", "component_standing_claims", "incident_reports", "incident_subscriptions"].includes(table) || rows.length) tables[table] = rows;
}

/** Imported targets (every one, or those wanted) with their owned tables, in
 * one query for the markers and one per owned table, whatever their number:
 * each table joined to its kind's markers, then grouped by owner. */
async function readTargets(db: D1Database, destination: string, wanted?: ReadonlyArray<{ targetKind: string; targetId: string }>): Promise<TargetRow[]> {
  const only = wanted ? JSON.stringify(wanted.map((target) => [target.targetKind, target.targetId])) : undefined;
  const markers = (await (only
    ? db.prepare(`SELECT a.kind,a.id,a.revision FROM (${allMarkers}) a WHERE a.id IN (SELECT json_extract(value,'$[1]') FROM json_each(?1)) AND EXISTS(SELECT 1 FROM json_each(?1) w WHERE json_extract(w.value,'$[0]')=a.kind AND json_extract(w.value,'$[1]')=a.id) ORDER BY a.kind,a.id`).bind(only)
    : db.prepare(`${allMarkers} ORDER BY kind,id`)).all<{ kind: string; id: string; revision: string }>()).results;
  const owned = new Map<string, Row[]>();
  const of = (key: string) => { let rows = owned.get(key); if (!rows) owned.set(key, rows = []); return rows; };
  for (const kind of new Set(markers.map((marker) => marker.kind))) {
    const shared = markerWhere(kind).params.length > 0;
    const where = [...shared ? ["m.kind=?"] : [], ...only ? ["m.id IN (SELECT value FROM json_each(?))"] : []];
    const params = [...shared ? [kind] : [], ...only ? [JSON.stringify(markers.filter((marker) => marker.kind === kind).map((marker) => marker.id))] : []];
    for (const [table, column] of Object.entries(tablesOf(kind))) {
      const rows = (await db.prepare(`SELECT x.* FROM ${markerTable(kind)} m JOIN ${table} x ON x.${column}=m.id${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${orderOf(table)}`).bind(...params).all<Row>()).results;
      for (const row of rows) of(`${kind}:${table}:${row[column]}`).push(row);
    }
  }
  return markers.map((marker) => {
    const tables: NativeValue["tables"] = {};
    for (const table of Object.keys(tablesOf(marker.kind))) settle(tables, table, owned.get(`${marker.kind}:${table}:${marker.id}`) ?? []);
    return { destination, targetKind: marker.kind, targetId: marker.id, revision: marker.revision, value: { tables } as never };
  });
}

/** Native records that cite a component, group or incident, by cited id, in one query per citing table. */
const citingTables = (kind: string) => kind === "group" ? [["components", "group_id"]] : kind === "component" ? [["incident_components", "component_id"], ["maintenance_components", "component_id"], ["subscriber_components", "component_id"], ["component_standing_claims", "component_id"], ["incident_template_components", "component_id"]] : kind === "incident" ? [["incident_subscriptions", "incident_id"]] : [];
const citerIdentity = (table: string) => table === "incident_subscriptions" ? "subscriber_id" : "id";
async function readCiting(db: D1Database, effects: D1UndoEffect[]) {
  const cited = new Map<string, string[]>();
  const of = (key: string) => { let ids = cited.get(key); if (!ids) cited.set(key, ids = []); return ids; };
  for (const kind of ["group", "component", "incident"]) {
    const ids = effects.filter((effect) => effect.expected.targetKind === kind).map((effect) => effect.expected.targetId);
    if (!ids.length) continue;
    for (const [table, column] of citingTables(kind)) {
      const rows = (await db.prepare(`SELECT ${column} AS cited,${citerIdentity(table)} AS id FROM ${table} WHERE ${column} IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(JSON.stringify(ids)).all<{ cited: string; id: string }>()).results;
      for (const row of rows) of(`${table}:${row.cited}`).push(row.id);
    }
  }
  return (table: string, id: string) => cited.get(`${table}:${id}`) ?? [];
}

/** Native writes for a Statuspage move-in. Every effect is one whole entity
 * (an incident with its updates, a component with its derived history), so
 * apply and undo commit or refuse it atomically with the kit's journal. */
export const statuspageTargets: D1TargetAdapter = {
  async read(db, destination, kind, id) {
    return (await readTargets(db, destination, [{ targetKind: kind, targetId: id }]))[0];
  },
  matches(row, destination, kind, id) {
    const parts = this.matchesParts!(row, destination, kind, id);
    return { sql: conjunction(parts.map((part) => part.sql)), params: parts.flatMap((part) => part.params ?? []) };
  },
  matchesParts(row, _destination, kind, id) {
    const where = markerWhere(kind);
    const parts: D1Sql[] = [{
      sql: row ? `EXISTS(SELECT 1 FROM ${markerTable(kind)} WHERE ${where.sql} AND revision=?)` : `NOT EXISTS(SELECT 1 FROM ${markerTable(kind)} WHERE ${where.sql})`,
      params: row ? [...where.params, id, row.revision] : [...where.params, id],
    }];
    for (const [table, column] of Object.entries(tablesOf(kind))) parts.push(!row && kind === "subscriber" && table === "subscribers" ? anonymisedOnly(id) : exactRows(table, column, id, row ? valueOf(row).tables[table] ?? [] : []));
    return parts;
  },
  write(row) {
    const statements: D1Sql[] = [];
    const entries = Object.entries(tablesOf(row.targetKind));
    const [owner] = entries[0];
    // The kit fences this whole value and its expectedRevision in the same
    // transaction. Replace owned children, but keep the owner row so incoming
    // references (including native records outside the import) do not cascade.
    for (const [table, column] of entries.slice(1).reverse()) statements.push({ sql: `DELETE FROM ${table} WHERE ${column}=?`, params: [row.targetId] });
    for (const [table] of entries) {
      const records = valueOf(row).tables[table] ?? [];
      if (!records.length) continue;
      const columns = Object.keys(records[0]);
      if (columns.some((key) => !/^\w+$/u.test(key)) || records.some((record) => Object.keys(record).length !== columns.length || columns.some((key) => !(key in record)))) throw new Error("Invalid native columns.");
      const inserts = insertJsonRows(table, columns, records);
      if (table === owner) for (const statement of inserts) {
        const suffix = ` WHERE true ON CONFLICT(id) DO UPDATE SET ${columns.filter((column) => column !== "id").map((column) => `${column}=excluded.${column}`).join(",")}`;
        statement.sql += suffix;
        // Retained-value transport rebuilds SQL from these same parts.
        if (statement.retainedValues) statement.retainedValues.parts[statement.retainedValues.parts.length - 1] += suffix;
      }
      statements.push(...inserts);
    }
    const marker = markerTable(row.targetKind);
    statements.push(marker !== "statuspage_import_targets" ? { sql: `INSERT INTO ${marker}(id,revision) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision`, params: [row.targetId, row.revision] } : { sql: "INSERT INTO statuspage_import_targets(kind,id,revision) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision", params: [row.targetKind, row.targetId, row.revision] });
    return statements;
  },
  remove(_destination, kind, id) {
    // Child rows cascade from the owning row; history and claims cascade from a component.
    const [owner] = Object.keys(tablesOf(kind));
    const where = markerWhere(kind);
    return [{ sql: `DELETE FROM ${owner} WHERE id=?`, params: [id] }, { sql: `DELETE FROM ${markerTable(kind)} WHERE ${where.sql}`, params: [...where.params, id] }];
  },
  async list(db, destination) {
    return readTargets(db, destination);
  },
  matchesMany(rows) {
    return matchesAll(rows);
  },
  async preparePreservedUndo(db: D1Database, destination: string, effects: D1UndoEffect[]) {
    const observations = [], dependencies: D1UndoDependency[] = [], guards: D1Sql[] = [];
    const rows = new Map((await readTargets(db, destination, effects.map((effect) => effect.expected))).map((row) => [`${row.targetKind}:${row.targetId}`, row]));
    const citing = await readCiting(db, effects);
    for (const effect of effects) {
      const { targetKind: kind, targetId: id } = effect.expected;
      const current = rows.get(`${kind}:${id}`);
      observations.push({ effectId: effect.provenance.id, current: current ?? null, entity: { table: Object.keys(tablesOf(kind))[0], recordId: id } });
      guards.push(...this.matchesParts!(current ?? null, destination, kind, id));
      // A component, group or incident stays while a native record still cites it.
      for (const [table, column] of citingTables(kind)) {
        const citers = citing(table, id);
        guards.push({ sql: `(SELECT json_group_array(id) FROM (SELECT ${citerIdentity(table)} AS id FROM ${table} WHERE ${column}=? ORDER BY id))=?`, params: [id, JSON.stringify(citers)] });
        for (const cited of citers) {
          // An imported citer reverses first; a native citer keeps this record.
          const related = effects.find((candidate) => ownsRow(candidate, table, cited));
          // Owned child rows reverse with this effect; they cannot depend on
          // their own reversal. Their query and equality guards still apply.
          if (related === effect) continue;
          dependencies.push({ requiredEffectId: effect.provenance.id, ...(related ? { dependentEffectId: related.provenance.id } : {}), cause: { table, recordId: cited }, evidence: { reason: `Cited by ${table}.` } as never });
        }
      }
    }
    return { observations, dependencies, guards: guards.length ? guards : [{ sql: "(SELECT count(*) FROM statuspage_import_targets)>=0" }] };
  },
};

function ownsRow(effect: D1UndoEffect, table: string, rowId: string) {
  const value = effect.expected.value as unknown as NativeValue | undefined;
  return Boolean(value?.tables?.[table]?.some((row) => (table === "incident_subscriptions" ? row.subscriber_id : row.id) === rowId));
}

export const importedKinds = kinds;

/** Bind native import replacement/removal facts to the operator performing the
 * action, rather than the principal who originally created its retained job. */
export function attributedStatuspageTargets(operatorId: string): D1TargetAdapter {
  function audit(kind: string, id: string, action: "replaced" | "deleted"): D1Sql {
    const [owner] = Object.keys(tablesOf(kind));
    const at = nowIso();
    return {
      sql: `INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,?,?,?,?,'{}',?,? FROM ${owner} WHERE id=?`,
      params: [createUlid(), kind, id, action, operatorId, at, at, id],
    };
  }
  return {
    ...statuspageTargets,
    write(row) { return [audit(row.targetKind, row.targetId, "replaced"), ...statuspageTargets.write(row)]; },
    remove(destination, kind, id) { return [audit(kind, id, "deleted"), ...statuspageTargets.remove(destination, kind, id)]; },
  };
}
