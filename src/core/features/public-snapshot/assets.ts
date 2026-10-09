import { cartographicStyles } from "./cartographic-styles";

/** Browser-only behavior and CSS belong to generated snapshot artifacts. */
export const publicPageScript = `(()=>{const f=(iso)=>{const d=new Date(iso);if(Number.isNaN(d.getTime()))throw new Error('Public status timestamp is invalid.');return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(d)};const zone=document.querySelector('[data-timezone-label]');if(zone)zone.textContent='Times: your local timezone ('+Intl.DateTimeFormat().resolvedOptions().timeZone+')';document.querySelectorAll('time[data-local-time]').forEach((node)=>{node.textContent=f(node.dateTime)});setInterval(async()=>{try{const r=await fetch('/api/public/status',{headers:{Accept:'application/json'}});if(!r.ok)return;const d=await r.json(),overall=document.querySelector('[data-overall]'),generated=document.querySelector('[data-generated-at]'),latest=document.querySelector('[data-newest-update]');if(overall&&overall.textContent!==d.overall)overall.textContent=d.overall;if(latest)latest.textContent=d.incident?d.incident.summary:'No current incident update.';if(generated)generated.textContent='Snapshot generated '+f(d.generatedAt)+'.'}catch{}},30000)})();`;

export function publicPageStyles(accentColor: string) {
  return cartographicStyles(accentColor);
}
