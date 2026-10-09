/** Shared, data-only contract for authenticated live edits. No executable payloads. */
export type LiveEditTarget = { selector: string; tag: string; role: string; beforeText: string; navigation?: { href: string } };
export type LiveEditChange = { text?: string; styles?: Record<string,string> };
export type LiveEdit = { id: string; revision: number; parentOrigin: string; path: string; target: LiveEditTarget; change: LiveEditChange };
export type LiveEditSnapshot = { revision: number; edits: LiveEdit[]; removedIds?: string[] };
export type CompiledLiveEdit = Omit<LiveEdit,'parentOrigin'>;
export type CompiledLiveEditSnapshot = {revision:number;edits:CompiledLiveEdit[]};
export type LiveEditResult = { id: string; revision: number; status: 'applied' | 'conflict' | 'undone'; message: string };
const properties = new Set(['color','background-color','font-size','font-weight','line-height','letter-spacing','text-align','border-color','border-width','border-radius','padding','padding-top','padding-bottom','padding-left','padding-right','margin','gap','max-width','width']);
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string,unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');
export function validLiveEditOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return u.origin === value && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)); } catch { return false; }
}
export function normalizeLiveText(text: string) { return text.replace(/\s+/g,' ').trim(); }
export function validLiveEditTarget(v: unknown): v is LiveEditTarget {
  return object(v) && exact(v,v.navigation === undefined ? ['selector','tag','role','beforeText'] : ['selector','tag','role','beforeText','navigation']) && typeof v.selector === 'string' && v.selector.length <= 500
    && /^[a-z][a-z0-9-]*:nth-child\([1-9][0-9]*\)( > [a-z][a-z0-9-]*:nth-child\([1-9][0-9]*\))*$/.test(v.selector)
    && typeof v.tag === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(v.tag) && typeof v.role === 'string' && /^(?:[a-z-]{1,40})?$/.test(v.role)
    && (v.navigation === undefined || object(v.navigation) && exact(v.navigation,['href']) && validLiveEditPath(v.navigation.href))
    && typeof v.beforeText === 'string' && v.beforeText.length <= 240 && v.beforeText === normalizeLiveText(v.beforeText);
}
export function validLiveEditChange(v: unknown): v is LiveEditChange {
  if (!object(v) || Object.keys(v).some(k => !['text','styles'].includes(k))) return false;
  if (v.text !== undefined && (typeof v.text !== 'string' || v.text.length > 500)) return false;
  if (v.styles !== undefined && (!object(v.styles) || Object.keys(v.styles).length > 16 || Object.entries(v.styles).some(([name,value]) => !properties.has(name) || typeof value !== 'string' || value.length > 80 || !/^[#a-zA-Z0-9.,%() -]+$/.test(value) || /url|var|expression|attr|image|inherit|revert/i.test(value)))) return false;
  return v.text !== undefined || object(v.styles) && Object.keys(v.styles).length > 0;
}
export function validLiveEditPath(value: unknown): value is string { return typeof value === 'string' && /^\/(?!\/)[^?#\u0000-\u001f]*$/.test(value) && value.length <= 300; }
export function validLiveEdit(v: unknown): v is LiveEdit {
  return object(v) && exact(v,['id','revision','parentOrigin','path','target','change']) && typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v.id)
    && Number.isSafeInteger(v.revision) && (v.revision as number) > 0 && validLiveEditOrigin(v.parentOrigin)
    && validLiveEditPath(v.path)
    && validLiveEditTarget(v.target) && validLiveEditChange(v.change);
}
export function validLiveEditSnapshot(v: unknown): v is LiveEditSnapshot {
  return object(v) && exact(v,v.removedIds === undefined ? ['revision','edits'] : ['revision','edits','removedIds']) && (v.removedIds === undefined || Array.isArray(v.removedIds) && v.removedIds.length <= 1000 && v.removedIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id))) && Number.isSafeInteger(v.revision) && (v.revision as number) >= 0
    && Array.isArray(v.edits) && v.edits.length <= 100 && v.edits.every(validLiveEdit) && new Set(v.edits.map(e => e.id)).size === v.edits.length;
}

export function validCompiledLiveEditSnapshot(v: unknown): v is CompiledLiveEditSnapshot {
  return object(v) && exact(v,['revision','edits']) && Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 && Array.isArray(v.edits) && v.edits.length <= 100 && v.edits.every(edit => object(edit) && !('parentOrigin' in edit) && validLiveEdit({...edit,parentOrigin:'https://compiled.invalid'})) && new Set(v.edits.map(e => e.id)).size === v.edits.length;
}
