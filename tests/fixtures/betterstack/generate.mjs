// Synthetic-only contract fixtures, never provider exports. No network requests.
import { mkdirSync, writeFileSync } from 'node:fs';
const root = new URL('./', import.meta.url);
const resource = (type, id, attributes) => ({ id: String(id), type, attributes });
const iso = (day, hour = 10) => `2025-01-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`;
for (const [family, pageId, groups, componentCount, incidentCount, maintenanceCount, subscriberCount] of [['small','31001',2,4,2,1,4],['large','32001',4,12,36,3,160]]) {
  const dir = new URL(`${family}/`, root); mkdirSync(dir,{recursive:true});
  const write = (name, value) => writeFileSync(new URL(name,dir),`${JSON.stringify(value,null,2)}\n`);
  const base = `https://incidents.betterstack.com/api/v2/status-pages/${pageId}`;
  function pages(stem, path, data, size = 50) {
    const total = Math.max(1,Math.ceil(data.length/size));
    for(let n=1;n<=total;n++) write(`${stem}${n===1?'':`-${n}`}.json`,{data:data.slice((n-1)*size,n*size),pagination:{first:`${base}/${path}?page=1`,last:`${base}/${path}?page=${total}`,prev:n>1?`${base}/${path}?page=${n-1}`:null,next:n<total?`${base}/${path}?page=${n+1}`:null}});
  }
  write('status-page.json',{data:resource('status_page',pageId,{company_name:`Synthetic ${family} Better Stack`,created_at:'2024-01-01T00:00:00Z',subdomain:`synthetic-${family}`,custom_domain:`${family}.status.example`,published:true,password_enabled:false,ip_allowlist:[],hide_from_search_engines:false,synthetic_note:'Documentation-shaped test data only'})});
  const ids=Array.from({length:componentCount},(_,n)=>`${pageId}${100+n}`);
  pages('sections','sections',Array.from({length:groups},(_,n)=>resource('status_page_section',`${pageId}${10+n}`,{name:`Synthetic group ${n+1}`,position:n,status_page_id:Number(pageId)})));
  pages('resources','resources',ids.map((id,n)=>resource('status_page_resource',id,{public_name:`${family} service ${n+1}`,explanation:'Synthetic service',position:n,status_page_section_id:Number(`${pageId}${10+n%groups}`),resource_id:900000+n,resource_type:'Monitor',status:'operational',widget_type:'history',availability:0.99,status_history:[]})));
  const reports=[];
  for(let n=0;n<incidentCount+maintenanceCount;n++) {
    const maintenance=n>=incidentCount;
    const id=`${pageId}${500+n}`;
    const day=n%28+1;
    const affected=[{status_page_resource_id:ids[n%ids.length],status:maintenance?'maintenance':'downtime'}];
    const updateCount=maintenance?3:2;
    const updates=Array.from({length:updateCount},(_,u)=>resource('status_update',`${id}${u}`,{message:`${family} report ${n+1} original update ${u+1}`,published_at:iso(day,9+u),status_report_id:Number(id),affected_resources:affected.map(a=>({...a,status:maintenance?'maintenance':u===updateCount-1?'resolved':'downtime'})),notify_subscribers:true,published_at_timezone:'UTC'}));
    const report=resource('status_report',id,{title:`${family} ${maintenance?'maintenance':'incident'} ${n+1}`,report_type:maintenance?'maintenance':n%2?'automatic':'manual',starts_at:iso(day,9),ends_at:iso(day,12),status_page_id:Number(pageId),affected_resources:affected,aggregate_state:maintenance?'maintenance':'operational'});
    report.relationships={status_updates:{data:updates.map(({id,type})=>({id,type}))}};reports.push(report);
    pages(`status-updates-${id}`,`status-reports/${id}/status-updates`,updates,maintenance?2:50);
    if(n===0||maintenance) write(`webhook-${id}.json`,{event_type:maintenance?'maintenance':'incident',page:{id:Number(pageId),status_indicator:maintenance?'maintenance':'downtime',status_description:'Synthetic'},[maintenance?'maintenance':'incident']:{id:Number(id),organization_id:Number(pageId),name:report.attributes.title,shortlink:`https://${family}.status.example/legacy-${id}/incidents`,[maintenance?'maintenance_updates':'incident_updates']:updates.map(u=>({id:Number(u.id),status_report_id:Number(id),body:u.attributes.message,created_at:u.attributes.published_at,updated_at:u.attributes.published_at}))}});
  }
  pages('status-reports','status-reports',reports,family==='large'?15:50);
  pages('subscribers','subscribers',Array.from({length:subscriberCount},(_,n)=>resource('status_page_subscriber',`${pageId}${800+n}`,{status_page_id:Number(pageId),email:`${family}-${n}@subscribers.example`,status_page_resource_ids:n%2?[ids[n%ids.length]]:[],confirmed_at:n===subscriberCount-1?null:'2024-05-01T00:00:00Z',created_at:'2024-05-01T00:00:00Z'})),family==='small'?2:50);
}
