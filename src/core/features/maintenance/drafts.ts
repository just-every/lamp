import { z } from "zod";
import { maintenanceUpdateSchema } from "./wording";
export const maintenanceDraftSchema = maintenanceUpdateSchema.extend({ affectedAudience: z.string().max(250), customerImpact: z.string().max(250), whatStillWorks: z.string().max(250).default(""), details: z.string().max(500).default(""), title: z.string().max(250).default(""), startsAt: z.string().default(""), endsAt: z.string().default(""), componentIds: z.array(z.string()).max(100).default([]) });
export type MaintenanceDraftPayload = z.infer<typeof maintenanceDraftSchema>;
export interface MaintenanceDraft { id: string; version: number; payload: MaintenanceDraftPayload; updatedAt: string }
export interface DraftReference { draftId?: string; draftVersion?: number }
export function createMaintenanceDraftRepository(binding: D1Database) {
  return {
    async read(id: string): Promise<MaintenanceDraft | null> {
      const row = await binding.prepare("SELECT id,version,payload_json AS payloadJson,updated_at AS updatedAt FROM maintenance_drafts WHERE id=?").bind(id).first<{id:string;version:number;payloadJson:string;updatedAt:string}>();
      return row ? { id:row.id, version:row.version, updatedAt:row.updatedAt, payload:JSON.parse(row.payloadJson) } : null;
    },
    async save(id: string, version: number, payload: MaintenanceDraftPayload, operatorId: string) {
      const at = new Date().toISOString();
      const result = version === 0
        ? await binding.prepare("INSERT OR IGNORE INTO maintenance_drafts (id,version,payload_json,author_operator_id,updated_at) VALUES (?,1,?,?,?)").bind(id,JSON.stringify(payload),operatorId,at).run()
        : await binding.prepare("UPDATE maintenance_drafts SET version=version+1,payload_json=?,author_operator_id=?,updated_at=? WHERE id=? AND version=?").bind(JSON.stringify(payload),operatorId,at,id,version).run();
      if (result.meta.changes !== 1) throw new Error("This draft changed in another tab. Reload its acknowledged version before saving.");
      return {id,version:version+1,payload,updatedAt:at};
    },
  };
}
