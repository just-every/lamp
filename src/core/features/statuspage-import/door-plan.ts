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

export function doorMapping(plan: ImportPlan, context: D1ImportContext) {
  const effects = new Map(plan.entries.map(entry=>[`${entry.source.kind}:${entry.source.sourceId}`,entry]));
  const source = {...plan.source, records:plan.source.records.map(record=> {
    let payload = record.payload;
    if (record.kind==='metadata') {
      const value = payload as {raw:Record<string,never>};
      payload = {...value,raw:{...value.raw,importSource:plan.namespace,subscribersAfterCutover:true}};
    }
    return {...record,namespace:context.namespace,payload,payloadHash:sha256(canonicalJson(payload))};
  })};
  const mapping: ImportMapping = {version:'1',map(record) {
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
