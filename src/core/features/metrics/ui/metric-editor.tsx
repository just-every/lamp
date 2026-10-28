import { useState } from "react";
import { appApi } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import { SaveNote } from "../../intake/ui/tool-parts";
import { useSourceAutosave } from "../../intake/ui/use-source-autosave";
import type { MetricDefinition } from "../types";
import { MetricFieldsForm, type MetricFields } from "./metric-fields";
export function MetricEditor({metric,onSaved,onClose}:{metric:MetricDefinition;onSaved:()=>void;onClose:()=>void}) {
  const [fields,setFields]=useState<MetricFields>({name:metric.name,unit:metric.unit,query:metric.query,endpoint:metric.endpoint,accountId:metric.accountId,region:metric.region});
  const [key,setKey]=useState(""),[applicationKey,setApplicationKey]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const autosave=useSourceAutosave(metric.id,onSaved,"/api/app/metrics");
  async function saveKey() {
    if(!await mayLeave())return;
    setBusy(true);setError(null);
    try {
      await appApi(`/api/app/metrics/${metric.id}`,{method:"PUT",body:JSON.stringify({credentials:{key,...(metric.provider==="datadog"?{applicationKey}:{})}})});
      setKey("");setApplicationKey("");onSaved();
    } catch(cause){setError(cause instanceof Error?cause.message:"The read-only key could not be saved.");}
    finally{setBusy(false);}
  }
  return <section className="tool-fields" aria-label={`Edit metric ${metric.name}`}>
    <div className="tool-form-heading"><h3>{metric.name}</h3><Button type="button" variant="secondary" onClick={async()=>{if(await mayLeave())onClose();}}>Close metric</Button></div>
    <SaveNote phase={autosave.phase} error={autosave.error} retry={autosave.retry} held={autosave.held} />
    <MetricFieldsForm value={fields} provider={metric.provider} onChange={next=>{setFields(next);autosave.save(next);}} />
    {metric.provider==="uptime"?<p className="tool-note">Uses response times from this paired Uptime monitor’s verified events. Events without timings leave a gap.</p>:metric.provider==="push"?<><label className="form-label">Metric push address<input readOnly value={`/api/app/metrics/${metric.id}/points`} /></label><p className="tool-note">Send a points array of UTC minute starts in epoch milliseconds and average values, using your operator session. Management tokens are not available yet.</p></>:<>
      <p className="tool-note">{metric.connected?"Read-only key connected.":"Connect a read-only key to show this metric."} Values are read once a minute.</p>
      <label className="form-label">{metric.provider==="datadog"?"Datadog API key":"Read-only API key"}<input type="password" autoComplete="new-password" value={key} onChange={event=>setKey(event.target.value)} /></label>
      {metric.provider==="datadog"&&<label className="form-label">Read-only application key<input type="password" autoComplete="new-password" value={applicationKey} onChange={event=>setApplicationKey(event.target.value)} /></label>}
      <div className="form-actions"><Button type="button" disabled={busy||!key||(metric.provider==="datadog"&&!applicationKey)} onClick={()=>void saveKey()}>{busy?"Saving key…":"Save read-only key"}</Button></div>
      {metric.error&&<p role="status" className="tool-note">{metric.error}</p>}
    </>}
    {error&&<FormError>{error}</FormError>}
  </section>;
}
