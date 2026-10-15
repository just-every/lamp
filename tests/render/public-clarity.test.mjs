import { assertResolvedDuration, assertVisibleTime } from "../helpers/public-meaning.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';

const vite = await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,hmr:false,ws:false},cacheDir:process.env.LAMP_RENDER_CACHE ?? 'node_modules/.vite-public-render'});
let rendered;
let hiddenFooterPage;
let newbornPage;
let groupedPage;
let emptyPages;
try {
  const {renderPublicSnapshot} = await vite.ssrLoadModule('/src/core/features/public-snapshot/renderer.ts');
  const instant='2026-10-02T09:24:00.000Z';
  const source={
    settings:{pageName:'Atlas Cloud Status',tagline:'Current availability for Atlas Cloud.',accentColor:'#16794C',timezone:'America/Los_Angeles',hostname:'status.atlascloud.example',footerCreditEnabled:true,widgetAllowedOrigins:'[]',feedId:'render-feed'},
    components:[{id:'checkout',name:'Checkout API',description:'',note:'',groupName:null,groupOrder:null,displayOrder:1}],
    claims:[{componentId:'checkout',state:'Degraded performance'}],
    history:[{componentId:'checkout',causeType:'standing-claim',changedAt:'2026-10-02T07:24:00.000Z',createdAt:'2026-10-02T07:24:00.000Z',newState:'Operational'}],
    corrections:[],
    incidents:[
      {id:'active',reference:'INC-ACTIVE',title:'Checkout requests are delayed',lifecycle:'Investigating',openedAt:'2026-10-02T09:00:00.000Z',resolvedAt:null},
      {id:'resolved',reference:'INC-RESOLVED',title:'Earlier checkout delay',lifecycle:'Resolved',openedAt:'2026-10-02T04:00:00.000Z',resolvedAt:'2026-10-02T08:00:00.000Z'},
    ],
    incidentComponents:[
      {incidentId:'active',componentName:'Checkout API'},
      {incidentId:'resolved',componentName:'Checkout API'},
    ],
    updates:[
      {id:'update',incidentId:'active',lifecycle:'Investigating',affectedAudience:'Customers checking out.',customerImpact:'Checkout requests take longer than usual.',whatStillWorks:'Orders and account access remain available.',details:'',nextUpdateAt:'2026-10-02T10:00:00.000Z',publishedAt:instant},
      {id:'resolved-update',incidentId:'resolved',lifecycle:'Resolved',affectedAudience:'Customers checking out.',customerImpact:'Checkout requests returned to normal.',whatStillWorks:'Orders and account access remain available.',details:'',nextUpdateAt:null,publishedAt:'2026-10-02T08:00:00.000Z'},
    ],
    maintenance:[],maintenanceComponents:[],reports:[],maintenanceNotices:[],
  };
  rendered=renderPublicSnapshot(source,instant);
  groupedPage=renderPublicSnapshot({...source,components:source.components.map(component=>({...component,groupName:"Customer services",groupOrder:1}))},instant).artifacts.find(a=>a.key==='page.html').body;
  newbornPage=renderPublicSnapshot({...source,history:source.history.map(entry=>({...entry,changedAt:instant,createdAt:instant}))},instant).artifacts.find(a=>a.key==='page.html').body;
  const empty=renderPublicSnapshot({...source,components:[],claims:[],history:[],incidents:[],incidentComponents:[],updates:[]},instant);
  emptyPages={page:empty.artifacts.find(a=>a.key==='page.html').body,history:empty.artifacts.find(a=>a.key==='history.html').body};
  hiddenFooterPage=renderPublicSnapshot({...source,settings:{...source.settings,footerCreditEnabled:false}},instant).artifacts.find(a=>a.key==='page.html').body;
} finally { await vite.close(); }
const artifact=key => rendered.artifacts.find(a=>a.key===key).body;
const count=(value,expression)=>[...value.matchAll(expression)].length;

// Read complete divs from the real renderer output, including all nested divs.
function divMarkup(html, className) {
  const start = html.indexOf(`<div class="${className}">`);
  assert.ok(start >= 0, `rendered ${className} div exists`);
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let tag; (tag = tags.exec(html));) {
    depth += tag[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  assert.fail(`rendered ${className} div is complete`);
}

test("Initial status navigation, grouped components and disclosed availability method", async t => {
  t.diagnostic("public status has one scoped history destination and direct subscription/feed paths");
  await (()=>{
  const html=artifact('page.html');
  assert.match(html,/<title>Atlas Cloud Status<\/title>/);
  assert.equal(count(html,/href="\/history"/g),1);
  assert.match(html,/href="#subscribe"/); assert.match(html,/href="\/feed.atom"/);
  assert.match(html,/INC-ACTIVE/);
})(t);
  t.diagnostic("each component has one uptime card and ungrouped components have no invented heading");
  await (()=>{
  const html=artifact('page.html');
  assert.equal(count(html,/<article class="component">/g),1);
  const group=divMarkup(html, "component-group");
  assert.doesNotMatch(group, /<h[1-3]\b/);
  assert.match(groupedPage, /<section class="component-group"><h3>Customer services<\/h3>/);
  assert.doesNotMatch(html,/class="status-overview-service"/);
  for (const [page, trackingInstant] of [[html, "2026-10-02T07:24:00.000Z"], [newbornPage, "2026-10-02T09:24:00.000Z"]]) {
    const component = page.match(/<article class="component">([\s\S]*?)<\/article>/);
    assert.ok(component);
    assert.match(component[1], /<h4>Checkout API<\/h4>/);
    const uptime = divMarkup(component[1], "uptime");
    assert.ok(uptime.includes(`<time datetime="${trackingInstant}" data-local-time>`), "the component uptime region contains its tracking instant");
  }
})(t);
  t.diagnostic("availability method details use a native disclosure while remaining in initial HTML");
  await (()=>{
  const html=artifact('page.html');
  const match=html.match(/<details class="availability-method"><summary>([^<]+)<\/summary><p>([\s\S]*?)<\/p><\/details>/);
  assert.ok(match,'the method is inside a native details disclosure');
  assert.ok(match[1].trim());
  assert.ok(match[2].trim());
  assert.match(html,/<aside class="availability-legend" aria-label="[^"\s][^"]*">[\s\S]*?<\/aside>/);
})(t);
});





test("Resolved history, permalink duration and configurable footer", async t => {
  t.diagnostic("resolved permalink shows its resolved instant and duration once");
  await (()=>{
  const html=artifact('incidents/INC-RESOLVED.html');
  assert.equal(count(html,/datetime="2026-10-02T08:00:00\.000Z"/g),1);
  assert.match(html,/<time datetime="2026-10-02T08:00:00\.000Z" data-local-time>/);
  assertResolvedDuration(html, "2026-10-02T04:00:00.000Z", "2026-10-02T08:00:00.000Z");
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
  assert.ok(title.includes("INC-RESOLVED") && title.includes("Atlas Cloud Status"));
})(t);
  t.diagnostic("footer credit setting controls its content");
  await (()=>{
  const html=artifact('page.html');
  assert.match(html,/<footer>\S[\s\S]*?<\/footer>/);
  assert.doesNotMatch(html,/runeditrun\.com/);
  assert.match(hiddenFooterPage, /<footer>\s*<\/footer>/);
})(t);
  t.diagnostic("history contains resolved incidents and a current-status destination");
  await (()=>{
  const html=artifact('history.html');
  assert.match(html,/INC-RESOLVED/); assert.doesNotMatch(html,/INC-ACTIVE/); assert.match(html,/href="\/"/);
})(t);
});





// Owner requirement (DIVERGENCE.md, "Public pages show no empty sections"): nothing to show means no section.
test("Empty status pages and configured-zone initial timestamps", async t => {
  t.diagnostic("a page with nothing to show omits empty sections and keeps one neutral line only where the page is empty");
  await (()=>{
  const {page,history}=emptyPages;
  assert.doesNotMatch(page,/Components<\/h2>|Incidents and maintenance|Happening now|Recently resolved|empty-state|published yet/);
  assert.match(page,/id="overall-status"/); assert.match(page,/id="subscribe"/);
  assert.match(history,/No past incidents or maintenance in the last 12 months\./); assert.doesNotMatch(history,/published|yet/);
})(t);
  t.diagnostic("initial time labels and timestamps stay in the configured zone");
  await (async()=>{
  const html=artifact('page.html');
  assert.match(html,/data-timezone-label data-timezone="America\/Los_Angeles">[^<]+/);
  const generated = html.match(/<time datetime="2026-10-02T09:24:00\.000Z"[^>]*>([^<]+)<\/time>/);
  assert.ok(generated, "initial HTML exposes the generated instant");
  assertVisibleTime(generated[1], "2026-10-02T09:24:00.000Z", "America/Los_Angeles");
  assert.match(html,/<form method="post" action="\/subscribe">[\s\S]*?<input[^>]*name="email"[^>]*type="email"/);
  assert.match(html, /class="uptime-mark no-data" role="listitem"/);

})(t);
});



if(process.env.LAMP_RENDER_OUTPUT){
  for(const a of rendered.artifacts){const filename=path.join(process.env.LAMP_RENDER_OUTPUT,a.key);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,a.body);}
}
