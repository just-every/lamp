import { z } from "zod";
import { COMPONENT_STATES } from "../../shared/domain";
import { createUlid } from "../../shared/ids";
import { checkedUrl, dohResolver, guardedFetch } from "../../platform/site-reader/fetch";
import { isIpLiteral, isPublicAddress } from "../../platform/site-reader/address";
import type { ComponentsService } from "../components/service";
import type { IncidentsService } from "../incidents/service";
import { createIncidentTemplateRepository } from "../incidents/template-repository";
import { vendorCatalog, statuspageMapping, feedMapping, parseVendorStatus, type VendorFormat, type ParseVendorOptions } from "./formats/index";
import { createDependencyRepository, type Dependency } from "./repository";

const jsonOptions = z.object({statePath:z.string().min(1).max(200),incidentPath:z.string().max(200).optional(),summaryPath:z.string().max(200).optional(),mapping:z.record(z.string().min(1),z.enum(COMPONENT_STATES))}).strict();
export const followSchema = z.object({
  catalogId:z.string().max(100).optional(), name:z.string().trim().min(1).max(120),
  sourceUrl:z.string().max(2048).optional(),statusPageUrl:z.string().max(2048).optional(),
  format:z.enum(["statuspage","rss","atom","json"]).optional(),
  options:z.object({componentId:z.string().max(200).optional(),json:jsonOptions.optional()}).strict().default({}),
  internal:z.boolean().default(false),
}).strict();
export const behaviorSchema=z.object({mode:z.enum(["show","draft","rollup"]),dependentComponentIds:z.array(z.string().length(26)).max(100).default([]),templateId:z.string().length(26).nullable().default(null)}).strict();
function publicUrl(input: string) {
  const url=checkedUrl(input),host=url.hostname.replace(/^\[|\]$/g,"");
  if(url.protocol!=="https:" || url.hash || (isIpLiteral(host)&&!isPublicAddress(host)))throw new Error("Use a public HTTPS status address without credentials or a fragment.");
  return url.href;
}
export function createDependenciesService(db:D1Database, components:ComponentsService, incidents:IncidentsService, rebuild:()=>Promise<void>, paused=false) {
  const repository=createDependencyRepository(db),templates=createIncidentTemplateRepository(db);
  async function mayManage(actor:string) {if(!await repository.isManager(actor))throw new Error("An active owner or administrator must configure vendor status.");}
  async function draft(row:Dependency, value:ReturnType<typeof parseVendorStatus>) {
    if(row.mode!=="draft" || value.state==="Operational" || !row.templateId || !row.createdByOperatorId || !await repository.isManager(row.createdByOperatorId))return;
    // Continuing provider trouble belongs to the same private incident.
    // Recovery never resolves that buyer incident.
    if(row.incidentId && row.state!=="Operational")return;
    const template=await templates.findTemplate(row.templateId);
    if(!template || template.lifecycle==="Resolved")return;
    const selected=await Promise.all(row.dependentComponentIds.map(id=>components.get(id)));
    if(!selected.length || selected.some(component=>!component))return;
    const incident=await incidents.create({title:template.title || `${row.name}: upstream provider issue`,components:selected.map(component=>({componentId:component!.id,state:template.components.find(saved=>saved.componentId===component!.id)?.state??value.state,relationship:"Dependent"})),update:{lifecycle:template.lifecycle,affectedAudience:template.affectedAudience,customerImpact:template.customerImpact,whatStillWorks:template.whatStillWorks,details:template.details,nextUpdateAt:template.nextUpdateOffsetMinutes===null?null:new Date(Date.now()+template.nextUpdateOffsetMinutes*60_000).toISOString()}},row.createdByOperatorId);
    await repository.attachIncident(row,incident.id);
  }
  return {
    async list() {return (await repository.list()).map(row=>({...row,mapping:vendorCatalog.find(entry=>entry.id===row.catalogId)?.mapping ?? (row.options.json as ParseVendorOptions["json"])?.mapping ?? (row.format==="statuspage"?statuspageMapping:feedMapping)}));},
    async follow(input:z.infer<typeof followSchema>,actor:string) {
      await mayManage(actor);
      const catalog=input.catalogId?vendorCatalog.find(entry=>entry.id===input.catalogId):undefined;
      if(input.catalogId&&!catalog)throw new Error("Choose a vendor from the catalog.");
      if(!catalog&&(!input.sourceUrl||!input.format))throw new Error("Choose a public source and its format.");
      const sourceUrl=publicUrl(catalog?new URL(catalog.path,catalog.origin).href:input.sourceUrl!);
      const format=catalog?.format??input.format!;
      if(format==="json"&&!input.options.json)throw new Error("Configure the JSON state path and mapping.");
      const statusPageUrl=publicUrl(catalog?.statusPageUrl??input.statusPageUrl??new URL(sourceUrl).origin);
      const component=await components.create({name:input.name,description:"Followed upstream status",groupId:null,internal:input.internal,displayOrder:0,note:"",onlyShowIfDegraded:false,uptimeStartDate:null,region:null},actor);
      const row:Dependency={id:createUlid(),componentId:component.id,catalogId:catalog?.id??null,name:input.name,vendorName:catalog?.name??new URL(sourceUrl).hostname,sourceUrl,statusPageUrl,format,options:input.options,mode:"show",dependentComponentIds:[],templateId:null,createdByOperatorId:actor,state:null,sourceState:null,summary:null,incidentKey:null,incidentId:null,failures:0,unavailableAt:null,lastReadAt:null,version:1};
      await repository.create(row,actor);
      await rebuild();return (await repository.get(row.id))!;
    },
    async configure(id:string,input:z.infer<typeof behaviorSchema>,actor:string) {
      await mayManage(actor);const row=await repository.get(id);if(!row)return null;
      const all=await repository.list();
      if(new Set(input.dependentComponentIds).size!==input.dependentComponentIds.length || input.dependentComponentIds.some(id=>all.some(v=>v.componentId===id)))throw new Error("Choose each buyer component once.");
      for(const componentId of input.dependentComponentIds)if(!await components.get(componentId))throw new Error("A dependent component no longer exists.");
      if(input.mode==="draft") {
        const template=input.templateId?await templates.findTemplate(input.templateId):null;
        if(!input.dependentComponentIds.length||!template||template.lifecycle==="Resolved")throw new Error("Draft mode needs dependent components and a saved upstream-provider template.");
      }
      await repository.configure(id,input,actor);await rebuild();return repository.get(id);
    },
    async remove(id:string,actor:string) {
      await mayManage(actor);const row=await repository.get(id);if(!row)return false;
      // Retain history while removing this vendor from public surfaces.
      await components.update(row.componentId,{name:row.name,description:"Unfollowed upstream provider",groupId:null,internal:true,displayOrder:0,note:"",onlyShowIfDegraded:false,uptimeStartDate:null,region:null});
      await repository.remove(id,actor);await rebuild();return true;
    },
    async runDue(now=Date.now()) {
      if(paused)return;
      const rows=await repository.list(),urls=[...new Set(rows.map(row=>row.sourceUrl))];
      for(let offset=0;offset<urls.length;offset+=4)await Promise.all(urls.slice(offset,offset+4).map(async url=>{
        if(!await repository.claimSource(url,now))return;
        const group=rows.filter(row=>row.sourceUrl===url);
        let text:string, supplementalBody:string|undefined;
        try {
          const read=await guardedFetch(new URL(url),"application/json, application/rss+xml, application/atom+xml, text/html",1_048_576,false,{fetch:(url,init)=>fetch(url,init),resolve:dohResolver(),signal:AbortSignal.timeout(8000),maxRedirects:0});
          text=new TextDecoder("utf-8",{fatal:true}).decode(read.bytes);
          const catalog=vendorCatalog.find(entry=>new URL(entry.path,entry.origin).href===url);
          if(catalog?.supplementalPath) {
            const supplement=await guardedFetch(new URL(catalog.supplementalPath,catalog.origin),"application/json",131_072,false,{fetch:(url,init)=>fetch(url,init),resolve:dohResolver(),signal:AbortSignal.timeout(8000),maxRedirects:0});
            supplementalBody=new TextDecoder("utf-8",{fatal:true}).decode(supplement.bytes);
          }
        }catch{for(const row of group)await repository.failed(row,now);return;}
        for(const row of group) {
          let value:ReturnType<typeof parseVendorStatus>;
          try{value=parseVendorStatus(row.format as VendorFormat,text,{...row.options,...(supplementalBody?{supplementalBody}:{})} as ParseVendorOptions);}
          catch{await repository.failed(row,now);continue;}
          if(await repository.observed(row,value,now))await draft(row,value);
        }
      }));
      if(urls.length)await rebuild();
    },
  };
}
export type DependenciesService=ReturnType<typeof createDependenciesService>;
