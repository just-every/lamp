import { createUlid, nowIso } from "../../shared/ids";
import type { ComponentState } from "../../shared/domain";

export interface Dependency {
  id: string; componentId: string; catalogId: string | null; name: string;
  sourceUrl: string; statusPageUrl: string; format: string; options: Record<string, unknown>;
  mode: "show" | "draft" | "rollup"; dependentComponentIds: string[]; templateId: string | null;
  createdByOperatorId: string | null; state: ComponentState | null; sourceState: string | null;
  incidentKey: string | null; incidentId: string | null; failures: number; unavailableAt: string | null;
  lastReadAt: number | null; version: number;
}
const columns = `id,component_id AS componentId,catalog_id AS catalogId,name,source_url AS sourceUrl,status_page_url AS statusPageUrl,format,options_json AS options,mode,dependent_components_json AS dependentComponentIds,template_id AS templateId,created_by_operator_id AS createdByOperatorId,state,source_state AS sourceState,incident_key AS incidentKey,incident_id AS incidentId,failures,unavailable_at AS unavailableAt,last_read_at AS lastReadAt,version`;
type Row = Omit<Dependency, "options" | "dependentComponentIds"> & { options: string; dependentComponentIds: string };
const decode = (row: Row): Dependency => ({ ...row, options: JSON.parse(row.options), dependentComponentIds: JSON.parse(row.dependentComponentIds) });

export function createDependencyRepository(db: D1Database) {
  const audit = (id: string, actor: string, action: string) => db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) VALUES(?,'vendor-dependency',?,?,?,'{}',?,?)`).bind(createUlid(),id,action,actor,nowIso(),nowIso());
  return {
    async list() { return (await db.prepare(`SELECT ${columns} FROM vendor_dependencies ORDER BY created_at,id`).all<Row>()).results.map(decode); },
    async get(id: string) { const row = await db.prepare(`SELECT ${columns} FROM vendor_dependencies WHERE id=?`).bind(id).first<Row>(); return row ? decode(row) : null; },
    async isManager(actor: string | null) { return actor !== null && Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND role IN ('owner','admin') AND status='active'").bind(actor).first()); },
    async create(row: Dependency, actor: string) {
      const at = nowIso();
      await db.batch([
        db.prepare(`INSERT INTO vendor_dependencies(id,component_id,catalog_id,name,source_url,status_page_url,format,options_json,created_by_operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(row.id,row.componentId,row.catalogId,row.name,row.sourceUrl,row.statusPageUrl,row.format,JSON.stringify(row.options),actor,at,at),
        db.prepare("INSERT INTO vendor_source_reads(source_url) VALUES(?) ON CONFLICT DO NOTHING").bind(row.sourceUrl),
        audit(row.id,actor,"followed"),
      ]);
    },
    async configure(id: string, input: Pick<Dependency,"mode"|"dependentComponentIds"|"templateId">, actor: string) {
      const result = await db.batch([
        db.prepare("UPDATE vendor_dependencies SET mode=?,dependent_components_json=?,template_id=?,created_by_operator_id=?,version=version+1,updated_at=? WHERE id=?").bind(input.mode,JSON.stringify(input.dependentComponentIds),input.templateId,actor,nowIso(),id), audit(id,actor,"configured"),
      ]);
      return Boolean(result[0].meta.changes);
    },
    async remove(id: string, actor: string) {
      const result = await db.batch([audit(id,actor,"unfollowed"),db.prepare("DELETE FROM vendor_dependencies WHERE id=?").bind(id)]);
      return Boolean(result[1].meta.changes);
    },
    async claimSource(url: string, now: number) {
      const result = await db.prepare("UPDATE vendor_source_reads SET read_after=? WHERE source_url=? AND read_after<=?").bind(now+120_000,url,now).run();
      return Boolean(result.meta.changes);
    },
    async failed(row: Dependency, now: number) {
      await db.prepare("UPDATE vendor_dependencies SET failures=failures+1,unavailable_at=CASE WHEN failures>=2 THEN COALESCE(unavailable_at,?) ELSE unavailable_at END,last_read_at=?,updated_at=? WHERE id=? AND version=?").bind(new Date(now).toISOString(),now,nowIso(),row.id,row.version).run();
    },
    async observed(row: Dependency, value: { state: ComponentState; sourceState: string; incidentKey: string | null; summary: string }, now: number) {
      const at = new Date(now).toISOString(), id = createUlid();
      const changed = row.state !== value.state || row.sourceState !== value.sourceState || row.incidentKey !== value.incidentKey;
      const result = await db.batch([
        db.prepare("UPDATE vendor_dependencies SET incident_id=CASE WHEN state='Operational' AND ?<>'Operational' THEN NULL ELSE incident_id END,state=?,source_state=?,incident_key=?,failures=0,unavailable_at=NULL,last_read_at=?,updated_at=? WHERE id=? AND version=?").bind(value.state,value.state,value.sourceState,value.incidentKey,now,nowIso(),row.id,row.version),
        ...(changed ? [
          db.prepare(`INSERT INTO vendor_evidence(id,dependency_id,component_id,incident_id,source,source_url,state,source_state,summary,observed_at) SELECT ?,id,component_id,incident_id,name,status_page_url,?,?,?,? FROM vendor_dependencies WHERE id=? AND version=?`).bind(id,value.state,value.sourceState,value.summary.slice(0,1000),at,row.id,row.version),
          db.prepare(`INSERT INTO component_claim_events(id,component_id,cause_type,cause_id,state,changed_at,created_at,updated_at) SELECT ?,component_id,'standing-claim',id,?,?,?,? FROM vendor_dependencies WHERE id=? AND version=?`).bind(createUlid(),value.state,at,at,at,row.id,row.version),
          db.prepare(`INSERT INTO component_state_history(id,component_id,previous_state,new_state,cause_type,cause_id,changed_at,created_at,updated_at,source_name,source_url) SELECT ?,component_id,?,?,'standing-claim',id,?,?,?,?,status_page_url FROM vendor_dependencies WHERE id=? AND version=?`).bind(createUlid(),row.state ?? "Operational",value.state,at,at,at,row.name,row.id,row.version),
        ] : []),
      ]);
      return Boolean(result[0].meta.changes);
    },
    async attachIncident(row: Dependency, incidentId: string) {
      await db.batch([
        db.prepare("UPDATE vendor_dependencies SET incident_id=? WHERE id=? AND version=?").bind(incidentId,row.id,row.version),
        db.prepare("UPDATE vendor_evidence SET incident_id=? WHERE dependency_id=? AND incident_id IS NULL").bind(incidentId,row.id),
      ]);
    },
    async publicRows() {
      return (await db.prepare(`SELECT v.component_id AS componentId,v.name,v.status_page_url AS statusPageUrl,v.mode,v.state,v.unavailable_at AS unavailableAt,v.last_read_at AS lastReadAt FROM vendor_dependencies v JOIN components c ON c.id=v.component_id WHERE c.internal=0 ORDER BY v.created_at,v.id`).all<Pick<Dependency,"componentId"|"name"|"statusPageUrl"|"mode"|"state"|"unavailableAt"|"lastReadAt">>()).results;
    },
  };
}
export type DependencyRepository = ReturnType<typeof createDependencyRepository>;
