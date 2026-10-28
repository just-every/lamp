import { TokenAuthorityError, type TokenAuthority } from "../management-api/repository";
import { readUptimeTiming } from "./uptime-timings";
import { createUlid } from "../../shared/ids";
import { openUrl, sealUrl, sealingSecrets } from "../channels/sealing";
import { createMetricsRepository, type StoredMetric } from "./repository";
import { queryMetric } from "./pull";
import { pointsSchema, type MetricInput, type MetricPatch } from "./schema";
import type { AggregatePoint, MetricDefinition, MetricProvider } from "./types";
import type { CallResult } from '../../../../modules/agent-door/types.ts';
const DAY=86400_000;
function view(row: StoredMetric): MetricDefinition {
  return {id:row.id,componentId:row.componentId,sourceId:row.sourceId,name:row.name,unit:row.unit,provider:row.provider,query:row.query,endpoint:row.endpoint,accountId:row.accountId,region:row.region,connected:["push","uptime"].includes(row.provider) || Boolean(row.sealedCredentials),lastReportedAt:row.lastReportedAt,error:row.error};
}
function validate(row: MetricInput | StoredMetric) {
  if (["uptime","pingdom"].includes(row.provider) && row.unit!=="ms") throw Error("This timing feed reports milliseconds; use unit ms.");
  if (row.provider==="push") {
    if (row.sourceId || row.query || row.endpoint) throw Error("A pushed metric has no pull source or query.");
  } else {
    if (!row.query) throw Error("A metric query or check ID is required.");
    if (["datadog","newrelic","pingdom","uptime"].includes(row.provider) && !row.sourceId) throw Error("Connect this metric through its monitoring preset.");
    if (row.provider==="newrelic" && !row.accountId) throw Error("A New Relic account ID is required.");
    if (row.provider==="pingdom" && !/^\d+$/.test(row.query)) throw Error("Use the numeric Pingdom check ID.");
    if (row.provider==="prometheus") {
      if (!row.endpoint) throw Error("A Prometheus HTTPS query endpoint is required.");
      const url=new URL(row.endpoint);
      if(url.protocol!=="https:" || url.username || url.password || url.search || url.hash) throw Error("Use an HTTPS endpoint without credentials, a query string or a fragment.");
    } else if (row.endpoint) throw Error("This provider uses its fixed API endpoint.");
  }
}
export function createMetricsService(db: D1Database, changed:()=>Promise<void>, options:{webhookSecret?:string;effectsPaused:boolean}) {
  const repository=createMetricsRepository(db);
  let admitAgentSchedule: ((kind:string,id:string,cycle:string)=>Promise<CallResult|null>) | undefined;
  const seal=async (id:string,credentials:NonNullable<MetricInput["credentials"]>)=>sealUrl(JSON.stringify(credentials),id,sealingSecrets(options.webhookSecret));
  const checkedPoints=(points:AggregatePoint[],now:number)=>{
    const checked=pointsSchema.parse({points}).points;
    const cutoff=Math.floor((now-DAY)/60_000)*60_000, end=Math.floor(now/60_000)*60_000;
    if (checked.some(point=>point.at<cutoff || point.at>end)) throw Error("Push minute aggregates only for the last day, never the future.");
    if(new Set(checked.map(point=>point.at)).size!==checked.length) throw Error("Supply each minute once.");
    return checked;
  };
  const pullRow = async (row:StoredMetric,now:number,actor?:string) => {
    if(options.effectsPaused) throw Error('Metric provider work is paused.');
    if(!await repository.validTarget(row.componentId,row.sourceId,row.provider,row.query)) throw Error('The metric source no longer belongs to its public component.');
    if(!await repository.claim(row,now,actor)) return null;
    let error:string|null=null,pointCount=0;
    try {
      const credentials=JSON.parse(await openUrl(row.sealedCredentials!,row.id,sealingSecrets(options.webhookSecret)));
      const to=Math.floor(now/60_000)*60_000;
      const points=await queryMetric({...row,provider:row.provider as MetricProvider},credentials,{from:to-3600_000,to});
      if(points.length) { await repository.write(row.id,checkedPoints(points,now),now,row.version);pointCount=points.length; }
    } catch { error='Metric data could not be read. Check the read-only key and query.'; }
    await repository.finish(row,error);
    return {metric:view((await repository.get(row.id))!),providerOutcome:error?'failed' as const:pointCount?'updated' as const:'no-data' as const,pointCount};
  };
  return {
    setAgentScheduledAdmission(admit:(kind:string,id:string,cycle:string)=>Promise<CallResult|null>) {admitAgentSchedule=admit;},
    authorize:repository.isManager,
    async list(componentId?:string,sourceId?:string) { return (await repository.list()).filter(row=>(!componentId || row.componentId===componentId)&&(!sourceId || row.sourceId===sourceId)).map(view); },
    async create(input:MetricInput,actor:string) {
      validate(input);
      if (!await repository.validTarget(input.componentId,input.sourceId,input.provider,input.query)) throw Error("Choose a public component and its matching monitoring source.");
      if (["push","uptime"].includes(input.provider) && input.credentials) throw Error("A pushed metric needs no provider key.");
      if (input.provider==="datadog" && input.credentials && !input.credentials.applicationKey) throw Error("Datadog needs a read-only application key and API key.");
      const id=createUlid();
      const {credentials,...fields}=input;
      const row:StoredMetric={...fields,id,connected:false,sealedCredentials:credentials?await seal(id,credentials):null,lastReportedAt:null,error:null,version:1};
      // Credentials are never carried into returned DTOs or audit payloads.
      await repository.create(row,actor); await changed();
      return view(row);
    },
    async update(id:string,input:MetricPatch,actor:string) {
      const current=await repository.get(id); if(!current) return null;
      const {credentials,...fields}=input;
      const row={...current,...fields}; validate(row);
      if(!await repository.validTarget(row.componentId,row.sourceId,row.provider,row.query)) throw Error("Choose the monitoring source mapped to this component.");
      const reset=["query","endpoint","accountId","region"].some(key=>row[key as keyof StoredMetric]!==current[key as keyof StoredMetric]);
      if(row.endpoint!==current.endpoint || row.region!==current.region) row.sealedCredentials=null;
      if(credentials!==undefined) {
        if(["push","uptime"].includes(row.provider) && credentials) throw Error("A pushed metric needs no provider key.");
        if(row.provider==="datadog" && credentials && !credentials.applicationKey) throw Error("Datadog needs a read-only application key and API key.");
        row.sealedCredentials=credentials?await seal(id,credentials):null;
      }
      if(!await repository.update(row,actor,reset)) throw Error("The metric changed. Reload it before editing.");
      await changed(); return view((await repository.get(id))!);
    },
    async remove(id:string,actor:string) { const removed=await repository.remove(id,actor); if(removed) await changed(); return removed; },
    async push(id:string,points:AggregatePoint[],authority?:TokenAuthority) {
      const row=await repository.get(id); if(!row) return false;
      if(row.provider!=="push") throw Error("This metric accepts points only from its connected read-only provider.");
      const now=Date.now();
      if(!await repository.write(id,checkedPoints(points,now),now,row.version,authority))throw new TokenAuthorityError("Management token authority changed.");
      await repository.maintain(now);await changed();return true;
    },
    async acceptUptime(sourceId:string,rawBody:string) {
      const timing=readUptimeTiming(JSON.parse(rawBody));
      if(!timing)return;
      const now=Date.now();
      if(timing.point.at<now-DAY || timing.point.at>now)return;
      let written=false;
      for(const row of await repository.list()) {
        if(row.provider!=="uptime" || row.sourceId!==sourceId || row.query!==timing.monitorId)continue;
        if(!await repository.validTarget(row.componentId,row.sourceId,row.provider,row.query))continue;
        await repository.write(row.id,[timing.point],now,row.version);written=true;
      }
      if(written)await changed();
    },
    async pull(id:string,actor:string,now=Date.now()) {
      if(!await repository.isManager(actor)) throw Error('Current operator authority is required to refresh a public metric.');
      const row=await repository.get(id);if(!row)return null;
      if(['push','uptime'].includes(row.provider)||!row.sealedCredentials) throw Error('This metric has no configured read-only pull provider.');
      const result=await pullRow(row,now,actor);
      if(!result) throw Error('The metric provider refresh is not due or is already claimed.');
      await changed();
      return result;
    },
    async runDue(now=Date.now()) {
      await repository.maintain(now);
      if(options.effectsPaused) return;
      // A page has at most ten series; keep provider work serial and bounded.
      for(const row of await repository.due(now)) {
        if(admitAgentSchedule) {
          const admitted=await admitAgentSchedule('metric-pull',row.id,`${row.version}:${Math.floor(now/60_000)}`);
          if(admitted)continue;
        }
        await pullRow(row,now);
      }
    },
  };
}
export type MetricsService=ReturnType<typeof createMetricsService>;
