import { z } from 'zod';
import { canonicalJson, sha256, type ImportPlan } from '../../../../modules/import-kit/src/d1/index';
import type { ImportMapping, Json, ParsedRecord } from '../../../../modules/import-kit/src/types';
import { importSources, sourceAdapter } from './adapters';
import { importLimits } from './source';

/** One upload through the import door: the saved source responses of one
 * source product, as Move in collects them, with that source's own options. */
export const doorExport = z.object({
  source: z.enum(importSources),
  files: z.array(z.object({name:z.string().max(80),text:z.string()}).strict()).min(1).max(importLimits.files),
  pageId: z.string().max(64).optional(),
  publicAccessAcknowledged: z.boolean().optional(),
  publicUrl: z.string().url().max(2048).optional(),
  /** A keyless capture of a page's public feeds (setup's "Bring its incident history too"): the components the owner
   * kept, by the page's own IDs, with the names they gave them, in their order. */
  components: z.array(z.object({ id: z.string().min(1).max(128), name: z.string().max(120) }).strict()).max(200).optional(),
  /** Earlier Move in clients set this on a source imported and undone, to plan
   * it afresh. The door now plans the same bytes afresh after an undo; an upload
   * that still carries it is accepted and the value is unused. */
  attempt: z.number().int().min(1).max(100).optional(),
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
 * record, so a catch-up replaces it rather than reporting the old one gone. The
 * door reads these records from the upload and plans them with this mapping.
 * The metadata also carries the page fingerprint: Lamp's own plan of these
 * responses against the page as it stood, so an apply can tell the page changed.
 * A Business import holds its subscribers until the owner's cutover release;
 * the owner's own Move in keeps each source's subscriber policy. */
export function doorMapping(plan: ImportPlan, business: boolean): { records: ParsedRecord[]; mapping: ImportMapping; page: string; shape: string } {
  const effects = new Map(plan.entries.map(entry=>[`${entry.source.kind}:${entry.source.sourceId}`,entry]));
  const records = plan.source.records.map((record): ParsedRecord => {
    if (record.kind!=='metadata') return {kind:record.kind,sourceId:record.sourceId,payload:record.payload};
    const value = record.payload as {raw:Record<string,never>};
    return {kind:record.kind,sourceId:plan.namespace,payload:{...value,raw:{...value.raw,importSource:plan.namespace,...(business ? {subscribersAfterCutover:true} : {}),bundle:record.sourceId,page:plan.fingerprint}}};
  });
  const mapping: ImportMapping = {version:'1',map(record) {
    if (record.kind==='metadata') {
      const raw = (record.payload as {raw:{asOf:string;bundle:string}}).raw;
      const id = `business-door:${plan.namespace}`;
      return {effects:[{targetKind:'source',targetId:id,value:{tables:{statuspage_import_sources:[{id,namespace:plan.namespace,bundle:raw.bundle,as_of:raw.asOf}]}}}]};
    }
    const entry = effects.get(`${record.kind}:${record.sourceId}`);
    if (!entry) throw new Error('Unknown move-in record.');
    return {effects:entry.effects.map(effect=> {
      if (!business || effect.targetKind!=='subscriber') return effect;
      const value = effect.value as {tables:Record<string,Array<Record<string,string|number|null>>>};
      return {...effect,value:{...value,tables:{...value.tables,subscribers:value.tables.subscribers.map(row=>({...row,state:'deactivated',deactivation_reason:'held for Business cutover'}))}}};
    }),unmapped:entry.unmapped,...(entry.rejection ? {rejection:entry.rejection} : {})};
  }};
  return {records,mapping,page:plan.fingerprint,shape:timeless(plan)};
}

/** What a preparation imports apart from its review instant: two dry runs of the
 * same bytes have the same shape only when the clock between them changed nothing
 * they import (a maintenance window that ended, say), not just the instant itself. */
function timeless(plan: ImportPlan) {
  const asOf = (plan.entries.find(entry=>entry.source.kind==='metadata')?.source.payload as {raw?:{asOf?:string}} | undefined)?.raw?.asOf;
  const entries = plan.entries.map(entry=>({kind:entry.source.kind,sourceId:entry.source.sourceId,payload:entry.source.payload,effects:entry.effects,unmapped:entry.unmapped,rejection:entry.rejection ?? null}));
  const text = canonicalJson(JSON.parse(JSON.stringify(entries)) as Json);
  return sha256(asOf ? text.split(asOf).join('') : text);
}

/** The review instant and page fingerprint a saved door plan was prepared with. */
export function reviewedPage(plan: ImportPlan): { asOf?: string; page?: string } {
  const raw = (plan.entries.find(entry=>entry.source.kind==='metadata')?.source.payload as {raw?:{asOf?:string;page?:string}} | undefined)?.raw;
  return {asOf:raw?.asOf,page:raw?.page};
}

export async function readDoorExport(bytes: Uint8Array) {
  // The readers hold the saved responses themselves to 8 MiB.
  if (bytes.byteLength > importLimits.maxBytes * 2) throw new Error('The saved responses exceed 8 MiB.');
  const input = doorExport.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  const read = await sourceAdapter(input.source).read(input.files,input);
  return {input,read};
}
