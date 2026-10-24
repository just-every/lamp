import { useState, type FormEvent } from "react";
import { appApi,useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import type { MetricDefinition,MetricProvider } from "../types";
import { MetricFieldsForm,type MetricFields } from "./metric-fields";
import { MetricEditor } from "./metric-editor";
const empty:MetricFields={name:"",unit:"ms",query:"",endpoint:null,accountId:null,region:null};
export function MetricsPanel({componentId,sourceId,provider,monitorId}:{componentId:string;sourceId?:string;provider?:MetricProvider|"uptime";monitorId?:string}) {
  const data=useAppData<{metrics:MetricDefinition[]}>(`/api/app/metrics?componentId=${componentId}${sourceId?`&sourceId=${sourceId}`:""}`);
  const [adding,setAdding]=useState(false),[fields,setFields]=useState({...empty,query:monitorId??""}),[feed,setFeed]=useState<MetricDefinition["provider"]>(provider??"push"),[editing,setEditing]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[removing,setRemoving]=useState<string|null>(null);
  if(!componentId)return null;
  const rows=(data.data?.metrics??[]).filter(metric=>!monitorId||metric.query===monitorId);
  async function create(event:FormEvent) {
    event.preventDefault();if(!await mayLeave())return;setBusy(true);setError(null);
    try {
      const result=await appApi<{metric:MetricDefinition}>("/api/app/metrics",{method:"POST",body:JSON.stringify({...fields,componentId,sourceId:sourceId??null,provider:feed})});
      data.refresh();setAdding(false);setEditing(result.metric.id);setFields({...empty,query:monitorId??""});
    }catch(cause){setError(cause instanceof Error?cause.message:"The metric could not be added.");}finally{setBusy(false);}
  }
  async function remove(id:string) {
    if(removing!==id){setRemoving(id);return;}
    if(!await mayLeave())return;
    try{await appApi(`/api/app/metrics/${id}`,{method:"DELETE"});setRemoving(null);if(editing===id)setEditing(null);data.refresh();}
    catch(cause){setError(cause instanceof Error?cause.message:"The metric could not be removed.");}
  }
  return <section className="tool-fields" aria-label="Public performance metrics">
    <div className="tool-form-heading"><h3>Public performance metrics</h3><p className="tool-note">Show up to ten charts on your page, each with its component. Only aggregate values are kept.</p></div>
    {data.error&&<FormError>{data.error}</FormError>}
    {rows.map(metric=><div key={metric.id}>
      <div className="tool-row"><div className="tool-row-name"><strong>{metric.name}</strong><small>{metric.unit} · {metric.provider} · {metric.connected?"Connected":"Read-only key needed"}</small></div><div className="tool-row-actions"><Button type="button" variant="secondary" onClick={async()=>{if(await mayLeave()){setAdding(false);setEditing(metric.id);}}}>Edit metric</Button><Button type="button" variant="secondary" onClick={()=>void remove(metric.id)}>{removing===metric.id?"Confirm remove":"Remove"}</Button></div></div>
      {editing===metric.id&&<MetricEditor key={metric.id} metric={metric} onSaved={data.refresh} onClose={()=>setEditing(null)} />}
    </div>)}
    {adding?<form className="tool-fields" aria-label="Add public metric" onSubmit={event=>void create(event)}>
      {!provider&&<label className="form-label">Metric feed<select value={feed} onChange={event=>{setFeed(event.target.value as typeof feed);setFields({...empty,name:fields.name,unit:fields.unit});}}><option value="push">Management API push</option><option value="prometheus">Prometheus query</option></select></label>}
      <MetricFieldsForm value={fields} provider={feed} onChange={setFields} />
      <div className="form-actions"><Button disabled={busy}>{busy?"Adding…":"Add metric"}</Button><Button type="button" variant="secondary" onClick={()=>setAdding(false)}>Cancel metric</Button></div>
    </form>:<div className="form-actions"><Button type="button" variant="secondary" onClick={async()=>{if(await mayLeave()){setEditing(null);setAdding(true);}}}>Add metric</Button></div>}
    {error&&<FormError>{error}</FormError>}
  </section>;
}
