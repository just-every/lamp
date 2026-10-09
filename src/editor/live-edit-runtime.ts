import { validLiveEditSnapshot, validCompiledLiveEditSnapshot, type CompiledLiveEdit, type CompiledLiveEditSnapshot, type LiveEditTarget, type LiveEditResult, type LiveEditSnapshot } from './live-edit-contracts';
import { applyLiveEdit } from './live-edit-dom';
type Handle = ReturnType<typeof applyLiveEdit> & { edit: CompiledLiveEdit };
/** Ordered replay preserves text chains; reverse undo touches only owned values. */
export function createLiveEditRuntime(doc: Document, location: () => {origin:string;pathname:string}, report: (result: LiveEditResult) => void) {
  let compiled: CompiledLiveEditSnapshot = {revision:0,edits:[]};
  const overlays = new Map<string,LiveEditSnapshot>(), navigation = new Map<string,LiveEditSnapshot>(), observed = new Map<string,Element>(), captured = new Map<string,Element>();
  const targetKey = (edit:Pick<CompiledLiveEdit,'path'|'target'>) => JSON.stringify([edit.target.navigation ? 'navigation' : edit.path,edit.target.tag,edit.target.role,edit.target.navigation?.href || edit.target.selector]);
  const results = new Map<string,string>(), pendingUndo = new Set<string>();
  let handles: Handle[] = [], scheduled = false, disposed = false, ready = true;
  const key = () => `${location().origin}${location().pathname}`;
  const publish = (result: LiveEditResult) => { const signature = JSON.stringify(result); if (results.get(result.id) !== signature) { results.set(result.id,signature); report(result); } };
  const observer = new MutationObserver(() => {
    if (scheduled || disposed) return;
    scheduled = true; queueMicrotask(() => { scheduled = false; if (!disposed) reconcile(); });
  });
  const observe = () => observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','hidden','aria-hidden','role','href']});
  function desiredEdits(): CompiledLiveEdit[] {
    const {origin,pathname} = location(), overlay = overlays.get(key()), nav = navigation.get(origin);
    const removed = new Set([...(overlay?.removedIds || []),...(nav?.removedIds || [])]);
    // A newer navigation snapshot can restore an ID suppressed by an old route snapshot.
    for (const edit of nav?.edits || []) if (edit.target.navigation) removed.delete(edit.id);
    for (const id of pendingUndo) removed.add(id);
    const effective = new Map<string,CompiledLiveEdit>();
    const put = (edit:CompiledLiveEdit) => { if (!removed.has(edit.id)) effective.set(targetKey(edit),edit); };
    for (const edit of compiled.edits) if (edit.target.navigation || edit.path === pathname) put(edit);
    for (const edit of overlay?.edits || []) if (!edit.target.navigation) put(edit);
    for (const edit of nav?.edits || []) if (edit.target.navigation) put(edit);
    return [...effective.values()];
  }
  function reconcile() {
    if (!ready) return;
    observer.disconnect();
    const desired = desiredEdits(), nextIds = new Set(desired.map(e => e.id));
    for (const handle of [...handles].reverse()) handle.undo();
    for (const handle of handles) if (!nextIds.has(handle.edit.id)) publish({id:handle.edit.id,revision:handle.edit.revision,status:'undone',message:'The saved visual edit was removed from this page.'});
    handles = [];
    for (const edit of desired) {
      try {
        const matches = edit.target.navigation
          ? Array.from(doc.querySelectorAll('nav a[href]')).filter(el => {
              try { const href = new URL(el.getAttribute('href') || '',location().origin); return href.origin === location().origin && !href.search && !href.hash && href.pathname === edit.target.navigation!.href; } catch { return false; }
            })
          : Array.from(doc.querySelectorAll(edit.target.selector));
        const previous = observed.get(targetKey(edit)), selection = captured.get(targetKey(edit));
        if (matches.length !== 1 || !(matches[0] instanceof HTMLElement)) throw new Error('The observed element is missing or no longer unique.');
        const element = matches[0];
        if (previous?.isConnected && previous !== element || !previous && selection && selection !== element) throw new Error('The original element moved. Refresh page context before editing it again.');
        const handle = applyLiveEdit(element,edit);
        observed.set(targetKey(edit),element); handles.push({...handle,edit});
        publish({id:edit.id,revision:edit.revision,status:'applied',message:'Saved visual edit applied.'});
      } catch(error) { publish({id:edit.id,revision:edit.revision,status:'conflict',message:error instanceof Error ? error.message : 'The edit could not be applied.'}); }
    }
    const nextTargets = new Set(desired.map(targetKey));
    for (const target of observed.keys()) if (!nextTargets.has(target)) observed.delete(target);
    if (!disposed) observe();
  }
  observe();
  return {
    hydrate(snapshot: LiveEditSnapshot) {
      if (!validLiveEditSnapshot(snapshot)) throw new Error('Invalid live edit snapshot.');
      const scope = location();
      if (snapshot.edits.some(e => e.parentOrigin !== scope.origin || !e.target.navigation && e.path !== scope.pathname)) throw new Error('The live edit snapshot does not belong to this page.');
      const previous = overlays.get(key()), latest = navigation.get(scope.origin);
      if (latest && snapshot.revision < latest.revision || previous && snapshot.revision === previous.revision && JSON.stringify(snapshot) !== JSON.stringify(previous)) throw new Error('Stale or conflicting live edit snapshot.');
      const copy = structuredClone(snapshot); overlays.set(key(),copy); navigation.set(scope.origin,copy); pendingUndo.clear(); reconcile();
    },
    compiled(snapshot: CompiledLiveEditSnapshot) { if (!validCompiledLiveEditSnapshot(snapshot)) throw new Error('Invalid compiled visual edits.'); compiled = structuredClone(snapshot); reconcile(); },
    undo(id:string,revision:number) { const edit = desiredEdits().find(e => e.id === id && e.revision === revision); if (!edit) throw new Error('This edit is no longer current.'); pendingUndo.add(id); reconcile(); },
    reconcile,
    setReady(value:boolean) { ready = value; if (ready) reconcile(); },
    remember(path:string,target:LiveEditTarget,element:Element) { captured.set(targetKey({path,target}),element); },
    clearCapture() { captured.clear(); },
    clearOverlays() { overlays.clear(); navigation.clear(); pendingUndo.clear(); captured.clear(); reconcile(); },
    dispose() { disposed = true; observer.disconnect(); for (const handle of [...handles].reverse()) handle.undo(); handles = []; },
  };
}
const runtimes = new WeakMap<Document,{runtime:ReturnType<typeof createLiveEditRuntime>;listeners:Set<(result:LiveEditResult)=>void>;results:Map<string,LiveEditResult>}>();
function pageRuntime() {
  let entry = runtimes.get(document);
  if (!entry) {
    const listeners = new Set<(result:LiveEditResult)=>void>(), results = new Map<string,LiveEditResult>();
    const runtime = createLiveEditRuntime(document,() => window.location,result => { results.set(result.id,result); for (const listener of listeners) listener(result); });
    entry = {runtime,listeners,results}; runtimes.set(document,entry);
  }
  return entry;
}
/** Call from the edition root layout before owner/editor authorization gates. */
export function installCompiledLiveEdits(snapshot: CompiledLiveEditSnapshot) { pageRuntime().runtime.compiled(snapshot); }
/** Closing the editor removes only this subscription; page edits stay active. */
export function connectLiveEdits(report: (result: LiveEditResult) => void) {
  const entry = pageRuntime(); entry.listeners.add(report);
  return {hydrate(snapshot:LiveEditSnapshot){entry.runtime.hydrate(snapshot); for (const result of entry.results.values()) report(result);},undo(id:string,revision:number){entry.runtime.undo(id,revision);},reconcile(){entry.runtime.reconcile();},remember(path:string,target:LiveEditTarget,element:Element){entry.runtime.remember(path,target,element);},clearCapture(){entry.runtime.clearCapture();},disconnect(){entry.listeners.delete(report); if (!entry.listeners.size) entry.runtime.clearOverlays();}};
}

/** Edition router lifecycle pauses mutation until the destination has rendered. */
export function setLiveEditsReady(ready: boolean) { pageRuntime().runtime.setReady(ready); }
