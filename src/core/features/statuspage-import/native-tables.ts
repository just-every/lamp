import { entityTables, type Row } from "./rows";

/** A Business door move-in also records which source bundle its namespace was
 * read from, so a catch-up replaces that record instead of losing it. */
const sourceTables = { statuspage_import_sources: "id" };

/** Every native table an import target owns, keyed by its owning column. */
export const tablesOf = (kind: string): Record<string, string> => {
  if (kind === "source") return sourceTables;
  const tables = entityTables[kind as keyof typeof entityTables];
  if (!tables) throw new Error("Unsupported import native kind.");
  return kind === "component" ? { ...tables, component_standing_claims: "component_id" } : kind === "maintenance" ? { ...tables, import_maintenance_updates: "maintenance_id" } : tables;
};
export const nativeKinds = [...Object.keys(entityTables), "source"];
/** Kinds newer than the shared marker table's kind check keep their own. */
const ownMarkers: Record<string, string> = { template: "statuspage_import_template_targets", source: "statuspage_import_source_targets" };
export const markerTable = (kind: string) => ownMarkers[kind] ?? "statuspage_import_targets";
export const markerWhere = (kind: string) => kind in ownMarkers ? { sql: "id=?", params: [] as string[] } : { sql: "kind=? AND id=?", params: [kind] };
/** Every import marker as (kind, id, revision). */
export const allMarkers = ["SELECT kind,id,revision FROM statuspage_import_targets", ...Object.entries(ownMarkers).map(([kind, table]) => `SELECT '${kind}' AS kind,id,revision FROM ${table}`)].join(" UNION ALL ");

/** Defaults added after old import journals were sealed do not constitute an
 * owner edit: a native value equal to its default reads as absent. */
export const sealedDefaults: Record<string, Row> = {
  components: { only_show_if_degraded: 0, uptime_start_date: null, region: null },
  // Additive subscriber intake, format and preference defaults leave sealed imports unchanged.
  // A real attribution, non-default format, preference choice or SMS marker remains an edit.
  subscribers: { created_by_operator_id: null, webhook_format: "lamp", event_kinds_json: '["incidents","maintenance","components"]', minimum_impact: null, chat_kind: null, preferences_set: 0, sms_kind: 0 },
  // Existing import journals predate per-update component snapshots. Empty
  // migration defaults are not an operator edit; real published changes are.
  incident_updates: { component_changes_json: "[]", component_snapshot_json: "[]" },
  incidents: { impact_override: null },
  incident_components: { detached_internal: 0 },
  maintenance: { affected_audience: null, customer_impact: null },
  maintenance_components: { detached_internal: 0 },
};
