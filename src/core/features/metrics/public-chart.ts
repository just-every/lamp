import { escapeHtml, timestamp } from "../public-snapshot/format";
import type { AggregatePoint, PublicMetric } from "./types";
const DAY=86400_000;
/** Gaps split paths before display sampling. No path ever bridges a missing minute. */
function segments(points:AggregatePoint[]) {
  const result:AggregatePoint[][]=[];
  for(const point of points) {
    const current=result.at(-1);
    if(!current || point.at-current.at(-1)!.at>60_000) result.push([point]);
    else current.push(point);
  }
  return result;
}
function number(value:number) { return new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(value); }
function chart(metric:PublicMetric,component:string,generatedAt:string,zone:string) {
  const now=Date.parse(generatedAt), start=now-DAY;
  const points=metric.points.filter(point=>point.at>=start&&point.at<=now);
  const chunks=segments(points), latest=points.at(-1);
  const title=`${component} · ${metric.name}`;
  const source={push:"the management API",uptime:"Uptime event timings",datadog:"Datadog",newrelic:"New Relic",pingdom:"Pingdom",prometheus:"Prometheus"}[metric.source];
  const summary=latest?`${number(latest.value)} ${metric.unit}. Last 24 hours: ${number(Math.min(...points.map(p=>p.value)))} to ${number(Math.max(...points.map(p=>p.value)))} ${metric.unit}. Minute averages from ${source}.`:`No data in the last 24 hours. Source: ${source}.`;
  const gaps:string[]=[];
  for(let i=Math.max(1,chunks.length-3);i<chunks.length;i++) {
    const stopped=chunks[i-1].at(-1)!.at, resumed=chunks[i][0].at;
    const minutes=Math.round((resumed-stopped)/60_000)-1;
    gaps.push(`No data for ${minutes} minute${minutes===1?"":"s"}. Data stopped at ${timestamp(new Date(stopped).toISOString(),zone)}; resumed at ${timestamp(new Date(resumed).toISOString(),zone)}.`);
  }
  if(metric.lastReportedAt!==null && now-metric.lastReportedAt>120_000) {
    gaps.push(`No data since the source stopped reporting at ${timestamp(new Date(metric.lastReportedAt).toISOString(),zone)}.`);
  }
  if(chunks.length>4) gaps.unshift(`${chunks.length-1} reporting gaps in the last day; the latest three are listed.`);
  let svg="";
  if(points.length) {
    const low=Math.min(...points.map(p=>p.value)),high=Math.max(...points.map(p=>p.value));
    const x=(at:number)=>8+584*(at-start)/DAY, y=(value:number)=>high===low?70:128-116*(value-low)/(high-low);
    // At most 180 representatives per chart, with each contiguous run
    // still drawn separately. Stored minute aggregates remain available through the API.
    const stride=Math.max(1,Math.ceil(points.length/180));
    let position=0;
    const paths=chunks.map(chunk=>{
      const shown=chunk.filter(point=>position++%stride===0||point===latest);
      if(!shown.length)return "";
      if(shown.length===1)return `<circle cx="${x(shown[0].at).toFixed(1)}" cy="${y(shown[0].value).toFixed(1)}" r="3" fill="currentColor"/>`;
      return `<path d="${shown.map((point,index)=>`${index?"L":"M"}${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    }).join("");
    svg=`<svg data-metric-chart="${escapeHtml(metric.id)}" viewBox="0 0 600 140" width="100%" height="140" role="img" aria-labelledby="metric-${metric.id}-title metric-${metric.id}-summary"><title id="metric-${metric.id}-title">${escapeHtml(title)}</title><desc id="metric-${metric.id}-summary">${escapeHtml(summary)} Gaps are not connected.</desc>${paths}</svg>`;
  }
  return `<article class="component-group" data-metric="${escapeHtml(metric.id)}"><h3>${escapeHtml(title)}</h3><p class="component-note">${escapeHtml(summary)}</p>${svg}${gaps.map(gap=>`<p class="component-note" data-metric-gap>${gap}</p>`).join("")}</article>`;
}
export function publicMetricsSection(metrics:PublicMetric[],components:Array<{id:string;name:string}>,generatedAt:string,zone:string) {
  const visible=new Map(components.map(component=>[component.id,component.name]));
  const shown=metrics.filter(metric=>visible.has(metric.componentId));
  return shown.length?`<section class="component-health" aria-labelledby="metrics-title"><header class="section-heading"><h2 id="metrics-title">Performance</h2><p>Last 24 hours</p></header><div class="availability-charts">${shown.map(metric=>chart(metric,visible.get(metric.componentId)!,generatedAt,zone)).join("")}</div></section>`:"";
}
