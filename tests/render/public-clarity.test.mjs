import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'vite';

const vite = await createServer({configFile:false,appType:'custom',server:{middlewareMode:true,hmr:false,ws:false},cacheDir:process.env.LAMP_RENDER_CACHE ?? 'node_modules/.vite-public-render'});
let rendered;
try {
  const {renderPublicSnapshot} = await vite.ssrLoadModule('/src/core/features/public-snapshot/renderer.ts');
  const instant='2026-10-02T09:24:00.000Z';
  const source={settings:{pageName:'Atlas Cloud Status',tagline:'Current availability for Atlas Cloud.',accentColor:'#16794C',timezone:'America/Los_Angeles',hostname:'status.atlascloud.example',footerCreditEnabled:true,widgetAllowedOrigins:'[]',feedId:'render-feed'},components:[{id:'checkout',name:'Checkout API',description:'',note:'',groupName:null,groupOrder:null,displayOrder:1}],claims:[{componentId:'checkout',state:'Degraded performance'}],history:[],corrections:[],incidents:[{id:'active',reference:'INC-ACTIVE',title:'Checkout requests are delayed',lifecycle:'Investigating',openedAt:instant,resolvedAt:null}],incidentComponents:[{incidentId:'active',componentName:'Checkout API'}],updates:[{id:'update',incidentId:'active',lifecycle:'Investigating',affectedAudience:'Customers checking out.',customerImpact:'Checkout requests take longer than usual.',whatStillWorks:'Orders and account access remain available.',details:'',nextUpdateAt:'2026-10-02T10:00:00.000Z',publishedAt:instant}],maintenance:[],maintenanceComponents:[],reports:[],maintenanceNotices:[]};
  rendered=renderPublicSnapshot(source,instant);
} finally { await vite.close(); }
const artifact=key => rendered.artifacts.find(a=>a.key===key).body;

test('public status has one scoped history destination and direct subscription/feed paths',()=>{
  const html=artifact('page.html');
  assert.equal((html.match(/href="\/history"/g)??[]).length,1);
  assert.match(html,/>Resolved history<\/a>/); assert.match(html,/href="#subscribe"/); assert.match(html,/href="\/feed.atom"/);
  assert.match(html,/Incidents and maintenance/); assert.match(html,/INC-ACTIVE/);
  assert.doesNotMatch(html,/View full history|Each component retains its own|Chronological incident/);
});
test('history truthfully names resolved/completed/cancelled scope and directs active readers back',()=>{
  const html=artifact('history.html');
  assert.match(html,/<h1>Resolved history<\/h1>/);
  assert.match(html,/Resolved incidents and completed or cancelled maintenance from the last 12 months/);
  assert.match(html,/For active incidents and upcoming maintenance, return to current status/);
  assert.doesNotMatch(html,/INC-ACTIVE/); assert.match(html,/href="\/"/);
});
test('no-script times identify the configured timezone while availability retains that calendar',()=>{
  const html=artifact('page.html');
  assert.match(html,/data-timezone-label>Times: America\/Los_Angeles/);
  assert.match(html,/Availability days use America\/Los_Angeles/);
  assert.match(html,/datetime="2026-10-02T09:24:00.000Z" data-local-time>Oct 2, 2026, 02:24 UTC-07:00/);
  assert.match(html,/Confirm your email address/); assert.match(html,/Weighted downtime/); assert.match(html,/No data/);
});
test('local-time script names viewer timezone without altering original instants',()=>{
  const times=[{dateTime:'2026-10-02T09:24:00.000Z',textContent:''}];
  const label={textContent:''};
  vm.runInNewContext(artifact('assets/status-page.js'),{Intl,Date,setInterval:()=>{},document:{querySelector:selector=>selector==='[data-timezone-label]'?label:null,querySelectorAll:()=>times}});
  assert.equal(label.textContent,`Times: your local timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  assert.equal(times[0].dateTime,'2026-10-02T09:24:00.000Z');
  assert.equal(times[0].textContent,new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(new Date(times[0].dateTime)));
});
if(process.env.LAMP_RENDER_OUTPUT){
  for(const a of rendered.artifacts){const filename=path.join(process.env.LAMP_RENDER_OUTPUT,a.key);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,a.body);}
}
