import { useEffect, useState } from "react";

import { useAppData } from "../../../app/client/ui/api";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import { LoadingState } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { ConnectedTools } from "./connected-tools";
import { ReceiptsCard, type Receipt } from "./receipts-card";
import { ToolForm } from "./tool-form";
import { ToolPicker } from "./tool-picker";
import { toolOf, type ComponentOption, type Source, type ToolId } from "./tools";

type Open = { kind: "new"; tool: ToolId } | { kind: "edit"; sourceId: string; created?: Source };

/** Alerts: connected tools as compact rows, then the "Connect a tool" picker or the one open form, then what arrived. */
export function AlertsPage() {
  const sources = useAppData<{ sources: Source[] }>("/api/app/intake/sources");
  const receipts = useAppData<{ receipts: Receipt[] }>("/api/app/intake/receipts?limit=100");
  const components = useAppData<{ components: ComponentOption[] }>("/api/app/components");
  const [open, setOpen] = useState<Open | null>(null);
  const { refresh: refreshSources } = sources;
  const { refresh: refreshReceipts } = receipts;
  // Back from the tool's own settings, what arrived meanwhile shows in place: nothing closes or moves.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") { refreshSources(); refreshReceipts(); } };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [refreshSources, refreshReceipts]);

  if ((sources.loading && !sources.data) || (receipts.loading && !receipts.data)) return <LoadingState>Loading alerts…</LoadingState>;
  if (!sources.data || !receipts.data) return <ErrorState onRetry={() => window.location.reload()}>{sources.error ?? receipts.error ?? "Alerts could not be loaded."}</ErrorState>;

  const connected = sources.data.sources;
  const arrived = receipts.data.receipts;
  const componentList = components.data?.components ?? [];
  const editing = open?.kind === "edit" ? connected.find(source => source.id === open.sourceId) ?? open.created ?? null : null;
  const refresh = () => { refreshSources(); refreshReceipts(); };
  // The open form closes, or another opens, once its pending choices are saved; a refused save keeps it open with its reason and Retry.
  const switchTo = async (next: Open | null) => { if (await mayLeave()) setOpen(next); };

  return <div className="page-stack alerts-page">
    <section className="page-title-row"><div><h1>Alerts</h1><p>Alerts from your tools open private drafts. Nothing is public until you publish.</p></div></section>
    {connected.length > 0 && <ConnectedTools sources={connected} components={componentList} editing={editing?.id ?? null} onEdit={source => { if (editing?.id !== source.id) void switchTo({ kind: "edit", sourceId: source.id }); }} onRemoved={source => { if (editing?.id === source.id) setOpen(null); refresh(); }} />}
    {open?.kind === "new" ? <ToolForm key={`new:${open.tool}`} tool={open.tool} source={null} components={componentList} names={connected.map(source => source.name)} onConnected={created => { if (created) setOpen({ kind: "edit", sourceId: created.id, created }); refresh(); }} onSaved={refresh} onClose={() => void switchTo(null)} />
      : editing ? <ToolForm key={`edit:${editing.id}`} tool={toolOf(editing)} source={editing} components={componentList} names={connected.map(source => source.name)} onConnected={refresh} onSaved={refresh} onClose={() => void switchTo(null)} />
      : <ToolPicker onPick={tool => setOpen({ kind: "new", tool })} />}
    {arrived.length > 0 && <ReceiptsCard receipts={arrived} />}
  </div>;
}
