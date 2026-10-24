import { useState, type FormEvent } from "react";
import { appApi,useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { FormError } from "../../../app/client/ui/states";
import { mayLeave } from "../../../app/client/ui/leave-guard";
import { presetLabels } from "../../intake/presets";
import type { Source } from "../../intake/ui/tools";
import type { MetricDefinition } from "../types";
import { MetricFieldsForm,type MetricFields } from "./metric-fields";
import { MetricEditor } from "./metric-editor";
const empty:MetricFields={name:"",unit:"ms",query:"",endpoint:null,accountId:null,region:null};
type Feed={value:string;label:string;provider:MetricDefinition["provider"];sourceId:string|null;query:string};
function sourceFeeds(sources:Source[],componentId:string):Feed[] {
  return sources.flatMap(source=>{
    if(source.preset==="uptime")return (source.monitorMappings??[]).filter(mapping=>mapping.componentId===componentId).map(mapping=>({value:`${source.id}/${mapping.monitorId}`,label:`Uptime · ${source.monitors?.find(row=>row.monitorId===mapping.monitorId)?.monitorName??mapping.monitorId}`,provider:"uptime" as const,sourceId:source.id,query:mapping.monitorId}));
    return source.componentId===componentId&&["datadog","newrelic","pingdom"].includes(source.preset??"")?[{value:source.id,label:`${presetLabels[source.preset!]} · ${source.name}`,provider:source.preset as "datadog"|"newrelic"|"pingdom",sourceId:source.id,query:""}]:[];
  });
}
export function MetricsPanel({componentId}:{componentId:string}) {
  const data=useAppData<{metrics:MetricDefinition[]}>(`/api/app/metrics?componentId=${componentId}`);
  const sources=useAppData<{sources:Source[]}>("/api/app/intake/sources");
  const choices:Feed[]=[{value:"push",label:"Management API push",provider:"push",sourceId:null,query:""},{value:"prometheus",label:"Prometheus query",provider:"prometheus",sourceId:null,query:""},...sourceFeeds(sources.data?.sources??[],componentId)];
  const [adding,setAdding]=useState(false),[fields,setFields]=useState(empty),[feed,setFeed]=useState("push"),[editing,setEditing]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[removing,setRemoving]=useState<string|null>(null);
  const rows=data.data?.metrics??[],selected=choices.find(choice=>choice.value===feed);
  async function create(event:FormEvent) {
    event.preventDefault();if(!await mayLeave()||!selected)return;setBusy(true);setError(null);
    try {
      const result=await appApi<{metric:MetricDefinition}>("/api/app/metrics",{method:"POST",body:JSON.stringify({...fields,componentId,sourceId:selected.sourceId,provider:selected.provider})});
      data.refresh();setAdding(false);setEditing(result.metric.id);setFields(empty);setFeed("push");
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
    {(data.error||sources.error)&&<FormError>{data.error??sources.error}</FormError>}
    {rows.map(metric=><div key={metric.id}>
      <div className="tool-row"><div className="tool-row-name"><strong>{metric.name}</strong><small>{metric.unit} · {metric.provider} · {metric.connected?"Connected":"Read-only key needed"}</small></div><div className="tool-row-actions"><Button type="button" variant="secondary" onClick={async()=>{if(await mayLeave()){setAdding(false);setEditing(metric.id);}}}>Edit metric</Button><Button type="button" variant="secondary" onClick={()=>void remove(metric.id)}>{removing===metric.id?"Confirm remove":"Remove"}</Button></div></div>
      {editing===metric.id&&<MetricEditor key={metric.id} metric={metric} onSaved={data.refresh} onClose={()=>setEditing(null)} />}
    </div>)}
    {adding?<form className="tool-fields" aria-label="Add public metric" onSubmit={event=>void create(event)}>
      <label className="form-label">Metric feed<select value={feed} onChange={event=>{setFeed(event.target.value);const choice=choices.find(row=>row.value===event.target.value);if(choice)setFields({...empty,name:fields.name,unit:["pingdom","uptime"].includes(choice.provider)?"ms":fields.unit,query:choice.query});}}>{choices.map(choice=><option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
      {selected&&<MetricFieldsForm value={fields} provider={selected.provider} onChange={setFields} />}
      <div className="form-actions"><Button disabled={busy||!selected}>{busy?"Adding…":"Add metric"}</Button><Button type="button" variant="secondary" onClick={()=>setAdding(false)}>Cancel metric</Button></div>
    </form>:<div className="form-actions"><Button type="button" variant="secondary" onClick={async()=>{if(await mayLeave()){setEditing(null);setAdding(true);}}}>Add metric</Button></div>}
    {error&&<FormError>{error}</FormError>}
  </section>;
}
