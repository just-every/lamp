import { z } from 'zod';
import { canonicalJson, sha256, type D1ImportContext, type ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import type { ImportMapping } from '../../../../modules/import-kit/src/types';
import { sourceAdapter } from './adapters';
import { importLimits } from './source';

export const doorExport = z.object({
  source: z.enum(['statuspage', 'sorry']),
  files: z.array(z.object({name:z.string().max(80),text:z.string()}).strict()).min(1).max(importLimits.files),
  pageId: z.string().max(64).optional(),
  publicAccessAcknowledged: z.boolean().optional(),
  publicUrl: z.string().url().max(2048).optional(),
}).strict();

/** Payloads retain their source product even though the door isolates each
 * snapshot in its own kit namespace. Existing history/aliases use this view. */
export function moveInPlan(plan: ImportPlan): ImportPlan {
  const metadata = plan.entries.find(entry=>entry.source.kind==='metadata')?.source.payload as {raw?:{importSource?:string}} | undefined;
  const namespace = metadata?.raw?.importSource;
  return namespace ? {...plan,namespace,entries:plan.entries.map(entry=>({...entry,source:{...entry.source,namespace}}))} : plan;
}

/** Each door namespace keeps one metadata record under a stable source id. It
 * names the bundle and review instant and maps to the namespace's native source
 * record, so a catch-up replaces it rather than reporting the old one gone. */
export function doorMapping(plan: ImportPlan, context: D1ImportContext) {
  const effects = new Map(plan.entries.map(entry=>[`${entry.source.kind}:${entry.source.sourceId}`,entry]));
  const source = {...plan.source, records:plan.source.records.map(record=> {
    let payload = record.payload, sourceId = record.sourceId;
    if (record.kind==='metadata') {
      const value = payload as {raw:Record<string,never>};
      payload = {...value,raw:{...value.raw,importSource:plan.namespace,subscribersAfterCutover:true,bundle:record.sourceId}};
      sourceId = plan.namespace;
    }
    return {...record,namespace:context.namespace,sourceId,payload,payloadHash:sha256(canonicalJson(payload))};
  })};
  const mapping: ImportMapping = {version:'1',map(record) {
    if (record.kind==='metadata') {
      const raw = (record.payload as {raw:{asOf:string;bundle:string}}).raw;
      const id = `business-door:${plan.namespace}`;
      return {effects:[{targetKind:'source',targetId:id,value:{tables:{statuspage_import_sources:[{id,namespace:plan.namespace,bundle:raw.bundle,as_of:raw.asOf}]}}}]};
    }
    const entry = effects.get(`${record.kind}:${record.sourceId}`);
    if (!entry) throw new Error('Unknown move-in record.');
    return {effects:entry.effects.map(effect=> {
      if (effect.targetKind!=='subscriber') return effect;
      const value = effect.value as {tables:Record<string,Array<Record<string,string|number|null>>>};
      return {...effect,value:{...value,tables:{...value.tables,subscribers:value.tables.subscribers.map(row=>({...row,state:'deactivated',deactivation_reason:'held for Business cutover'}))}}};
    }),unmapped:entry.unmapped,...(entry.rejection ? {rejection:entry.rejection} : {})};
  }};
  return {source,mapping};
}

export async function readDoorExport(bytes: Uint8Array) {
  if (bytes.byteLength > importLimits.maxBytes) throw new Error('The saved responses exceed 8 MiB.');
  const input = doorExport.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  const read = await sourceAdapter(input.source).read(input.files,input);
  return {input,read};
}
