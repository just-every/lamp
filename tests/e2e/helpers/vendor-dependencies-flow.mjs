import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { openStatusJourney, eventually } from './status-journey.mjs';
import { moveInDoor } from '../../helpers/import-notifications.mjs';

/** The scheduled Worker and ordinary HTTP doors own every status change.
 * Only public vendor responses and public DNS answers are recorded fixtures. */
export async function vendorDependenciesFlow() {
  const catalog=JSON.parse(await readFile('src/core/features/dependencies/formats/catalog.json','utf8'));
  const sources=new Map(), calls=[];
  for(const entry of catalog) {
    const fixture=JSON.parse(await readFile(entry.fixture,'utf8'));
    const healthy=fixture.cases.find(row=>row.expected==='Operational');
    sources.set(entry.origin+entry.path,{fixture,body:healthy.body,status:200});
    if(entry.supplementalPath)sources.set(entry.origin+entry.supplementalPath,{body:healthy.options.supplementalBody,status:200});
  }
  const j=await openStatusJourney({pageHost:'localhost',providerEdge:async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:Number(url.searchParams.get('type')),data:url.searchParams.get('type')==='1'?'1.1.1.1':'2606:4700:4700::1111'}]});
    const source=sources.get(url.href);
    if(!source)return undefined;
    calls.push({url:url.href,method:request.method,headers:Object.fromEntries(request.headers)});
    return new Response(source.body,{status:source.status});
  }});
  let browser;
  const now=Date.now();let minute=0;
  const tick=async()=>{const at=now+minute*60_000;await j.tick(at);minute+=2;return at;};
  const followed=[];
  const list=async()=>(await j.json('/api/app/dependencies')).dependencies;
  const publicRows=async()=>(await (await j.publicResponse('/api/public/dependencies')).json()).dependencies;
  try {
    const buyer=await j.component('synthetic-lamp-buyer');
    const offered=(await j.json('/api/app/dependencies')).catalog;
    assert.equal(offered.length,20);
    for(const entry of catalog) {
      assert.ok(offered.some(row=>row.name===entry.name && row.origin===entry.origin));
      followed.push((await j.json('/api/app/dependencies','POST',{catalogId:entry.id,name:entry.name},201)).dependency);
    }
    const cloudflare=followed.find(row=>row.catalogId==='cloudflare'),aws=followed.find(row=>row.catalogId==='aws');
    const same=(await j.json('/api/app/dependencies','POST',{catalogId:'cloudflare',name:'synthetic-lamp-selected',options:{componentId:'synthetic-lamp-1'}},201)).dependency;
    await tick();
    assert.equal(calls.length,21,'one GET per declared public source path');
    assert.ok(calls.every(row=>row.method==='GET' && !('authorization' in row.headers) && !('cookie' in row.headers)));
    assert.ok((await list()).every(row=>row.state==='Operational' && row.failures===0));
    const before=calls.length;await j.tick(now+119_999);assert.equal(calls.length,before,'an early scheduled read performs no vendor request');
    const upstream=sources.get(cloudflare.sourceUrl),awsSource=sources.get(aws.sourceUrl);
    upstream.body=upstream.fixture.cases.find(row=>row.sourceState==='major_outage').body;
    awsSource.body=awsSource.fixture.cases.find(row=>row.sourceState==='major_outage').body;
    const outageAt=await tick();
    for(const row of [cloudflare,aws,same]) {
      const current=(await list()).find(value=>value.id===row.id);assert.equal(current.state,'Major outage');
      const history=(await j.json(`/api/app/components/${row.componentId}/history`)).history;
      assert.ok(history.some(item=>item.sourceName===row.vendorName && item.sourceUrl===row.statusPageUrl && item.newState==='Major outage' && Date.parse(item.changedAt)===outageAt),'changed fixture is source-attributed within the next two-minute trigger');
    }
    const customerReports=await publicRows();
    for(const row of [cloudflare,aws,same])assert.equal(customerReports.find(value=>value.componentId===row.componentId).state,'Major outage','changed vendor state reaches the public source read in the same trigger');
    const status=async()=>(await (await j.publicResponse('/api/public/status')).json());
    assert.equal((await status()).overall,'Operational');
    assert.equal((await j.json("/api/app/components")).components.find(row=>row.id===buyer.id).publicState,'Operational');
    assert.equal((await j.json('/api/app/incidents')).incidents.length,0,'show only creates no incident');
    const visible=await j.publicText('/');
    assert.ok(visible.includes('Reported by Cloudflare') && visible.includes(cloudflare.statusPageUrl));
    await j.json(`/api/app/dependencies/${cloudflare.id}`,'PUT',{mode:'rollup',dependentComponentIds:[],templateId:null});
    await eventually(status,row=>row.overall==='Major outage','explicit vendor rollup');
    assert.equal((await j.json("/api/app/components")).components.find(row=>row.id===buyer.id).publicState,'Operational','rollup claims no buyer component state');
    await j.json(`/api/app/dependencies/${cloudflare.id}`,'PUT',{mode:'show',dependentComponentIds:[],templateId:null});
    const template=(await j.json('/api/app/incident-templates','POST',{name:'Upstream provider',lifecycle:'Investigating',affectedAudience:'synthetic-lamp-customers',customerImpact:'synthetic-lamp-provider-impact',whatStillWorks:'synthetic-lamp-alternative',details:'synthetic-lamp-review-first',nextUpdateOffsetMinutes:60,components:[{componentId:buyer.id,state:'Major outage',relationship:'Dependent'}]},201)).template;
    await j.json(`/api/app/dependencies/${cloudflare.id}`,'PUT',{mode:'draft',dependentComponentIds:[buyer.id],templateId:template.id});
    await tick();await tick();
    const allIncidents=(await j.json('/api/app/incidents')).incidents;
    assert.equal(allIncidents.length,1,'repeated trouble creates one private draft');
    const incident=await j.read(allIncidents[0].id);
    assert.equal(incident.updates.length,0);
    assert.equal(incident.draft.customerImpact,'synthetic-lamp-provider-impact');
    assert.ok(incident.components.some(row=>row.componentId===buyer.id && row.relationship==='Dependent'));
    assert.equal((await j.json("/api/app/components")).components.find(row=>row.id===buyer.id).publicState,'Operational');
    assert.equal((await status()).overall,'Operational');
    assert.ok(!(await j.publicText('/')).includes('synthetic-lamp-provider-impact'));
    await j.save(incident.id,{lifecycle:'Identified',affectedAudience:'synthetic-lamp-customers',customerImpact:'synthetic-lamp-provider-impact',whatStillWorks:'synthetic-lamp-alternative',details:'synthetic-lamp-review-first'});await j.publish(incident.id);
    assert.equal((await j.json('/api/app/components')).components.find(row=>row.id===buyer.id).publicState,'Major outage');
    upstream.body=upstream.fixture.cases.find(row=>row.expected==='Operational').body;await tick();
    const recovered=await j.read(incident.id);assert.equal(recovered.lifecycle,'Identified');assert.equal(recovered.updates.length,1);
    assert.equal((await j.json('/api/app/components')).components.find(row=>row.id===buyer.id).publicState,'Major outage','vendor recovery preserves the buyer incident claim');
    const brief=(await j.json(`/api/app/incidents/${incident.id}/brief`)).brief;
    assert.ok(brief.whatWeKnow.alerts.some(row=>row.source==='Cloudflare' && row.state==='recovered' && row.payload.sourceUrl===cloudflare.statusPageUrl));
    awsSource.status=503;await tick();await tick();const failedAt=await tick();
    const failed=(await list()).find(row=>row.id===aws.id);
    assert.equal(failed.failures,3);assert.equal(failed.state,'Major outage');assert.equal(Date.parse(failed.unavailableAt),failedAt);
    const unavailablePage=await j.visible('/','Vendor status unavailable since');
    assert.ok(unavailablePage.includes(`datetime="${failed.unavailableAt}"`),'the public unavailable notice names the first unavailable instant');
    if(process.env.LAMP_DEP_SCREENSHOTS) {
      await mkdir(process.env.LAMP_DEP_SCREENSHOTS,{recursive:true});
      browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
      const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(j.publicOrigin);
      for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${process.env.LAMP_DEP_SCREENSHOTS}/public-vendors-${width}.png`,fullPage:true});}
    }
    assert.equal((await publicRows()).find(row=>row.componentId===aws.componentId).state,'Major outage');
    const firstUnavailable=failed.unavailableAt;await tick();assert.equal((await list()).find(row=>row.id===aws.id).unavailableAt,firstUnavailable);
    awsSource.status=200;awsSource.body=awsSource.fixture.cases.find(row=>row.expected==='Operational').body;await tick();
    assert.equal((await list()).find(row=>row.id===aws.id).unavailableAt,null);
    for(const [index,[format,body,options]] of [
      ['rss','<rss><channel><item><guid>synthetic-lamp-1</guid><title>[SERVICE DISRUPTION] synthetic-lamp-1</title></item></channel></rss>',{}],
      ['atom','<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>synthetic-lamp-1</id><title>[SERVICE DISRUPTION] synthetic-lamp-1</title></entry></feed>',{}],
      ['json',JSON.stringify({status:'bad',incident:'synthetic-lamp-1',summary:'synthetic-lamp-generic'}),{json:{statePath:'status',incidentPath:'incident',summaryPath:'summary',mapping:{good:'Operational',bad:'Major outage'}}}],
      ['json',JSON.stringify([{state:'bad'}]),{json:{statePath:'0.state',mapping:{bad:'Major outage'}}}],
      ['json',JSON.stringify('bad'),{json:{statePath:'$',mapping:{bad:'Major outage'}}}],
    ].entries()) {
      const sourceUrl=`https://status.synthetic-lamp.test/${format}-${index}`;sources.set(sourceUrl,{body,status:200});
      const row=(await j.json('/api/app/dependencies','POST',{name:`synthetic-lamp-${format}`,sourceUrl,statusPageUrl:'https://status.synthetic-lamp.test/',format,options},201)).dependency;
      await tick();assert.equal((await list()).find(value=>value.id===row.id).state,'Major outage');
    }
    const atomUrl='https://status.synthetic-lamp.test/changing-atom';
    const atomReport=term=>`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>synthetic-lamp-changing-report</id><title>synthetic-lamp-component-report</title><category term="${term}"/></entry></feed>`;
    sources.set(atomUrl,{body:atomReport('major_outage'),status:200});
    const atom=(await j.json('/api/app/dependencies','POST',{name:'synthetic-lamp-changing-atom',sourceUrl:atomUrl,format:'atom'},201)).dependency;
    const atomStates=[];
    for(const term of ['major_outage','operational']) {
      sources.get(atomUrl).body=atomReport(term);await tick();
      atomStates.push((await j.json('/api/app/components')).components.find(row=>row.id===atom.componentId).publicState);
    }
    assert.deepEqual(atomStates,['Major outage','Operational'],'each Atom category term maps to the current native component state');
    const count=(await list()).length;
    const sourceBefore=(await list()).find(row=>row.id===aws.id);
    const historyBefore=(await j.json(`/api/app/components/${aws.componentId}/history`)).history.length;
    awsSource.body='<html>synthetic-lamp-provider-unavailable</html>';await tick();
    assert.equal((await list()).find(row=>row.id===aws.id).state,sourceBefore.state,'malformed status never fabricates a healthy observation');
    assert.equal((await j.json(`/api/app/components/${aws.componentId}/history`)).history.length,historyBefore);
    awsSource.body=awsSource.fixture.cases.find(row=>row.expected==='Operational').body;

    for(const sourceUrl of ['https://127.0.0.1/status','https://localhost/status',(() => { const url=new URL('https://status.synthetic-lamp.test/status');url.username='synthetic-lamp-1';url.password='synthetic-lamp-2';return url.href; })()])await j.json('/api/app/dependencies','POST',{name:'synthetic-lamp-refused',sourceUrl,format:'rss'},400);
    assert.equal((await list()).length,count);
    const forbidden=await j.raw('/api/app/dependencies',{method:'POST',headers:{Origin:j.appOrigin,'Content-Type':'application/json'},body:JSON.stringify({catalogId:'aws',name:'synthetic-lamp-denied'})});assert.equal(forbidden.status,401);
    const viewerAddress=['synthetic-lamp-viewer','example.test'].join('@');
    await j.json('/api/app/operators/invite','POST',{email:viewerAddress,displayName:'synthetic-lamp-viewer'},202);
    await j.signIn(viewerAddress);
    await j.signIn();
    const viewer=(await j.json('/api/app/operators')).operators.find(row=>row.email===viewerAddress);
    await j.json(`/api/app/operators/${viewer.id}/role`,'POST',{role:'viewer'});
    await j.signIn(viewerAddress,{fresh:true});
    await j.json(`/api/app/dependencies/${aws.id}`,'PUT',{mode:'rollup',dependentComponentIds:[],templateId:null},403);
    await j.json('/api/app/dependencies','POST',{catalogId:'aws',name:'synthetic-lamp-denied'},403);
    await j.signIn();
    assert.equal((await list()).length,count);
    assert.equal((await list()).find(row=>row.id===aws.id).mode,'show','a denied role cannot change vendor authority');
    await j.json(`/api/app/operators/${viewer.id}/role`,'POST',{role:'owner'});
    await j.signIn(viewerAddress,{fresh:true});
    await j.json(`/api/app/dependencies/${aws.id}`,'PUT',{mode:'draft',dependentComponentIds:[buyer.id],templateId:template.id});
    await j.signIn();
    await j.json(`/api/app/operators/${viewer.id}`,'DELETE',undefined,204);
    upstream.body=upstream.fixture.cases.find(row=>row.expected==='Operational').body;
    awsSource.body=awsSource.fixture.cases.find(row=>row.sourceState==='major_outage').body;
    await tick();
    assert.equal((await j.json('/api/app/incidents')).incidents.length,1,'an erased approver cannot create a new vendor incident');
    await j.signIn(viewerAddress);
    await j.json('/api/app/dependencies','POST',{catalogId:'aws',name:'synthetic-lamp-replay'},401);
    await j.signIn();
    // An owner choosing an imported template gives it a native use that undo
    // must retain, including the ability to draft on a later vendor outage.
    const moveIn=moveInDoor((path,body,headers)=>j.api(path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers}));
    const files=Object.entries({
      'page.json':{id:'synthetic-lamp-template-page',name:'Synthetic Lamp source',viewers_must_be_team_members:false,ip_restrictions:null},
      'page-access-groups.json':[],'component-groups.json':[],
      'components.json':[{id:'synthetic-lamp-template-component',name:'Synthetic Lamp template service',group:false,group_id:null,position:1,status:'operational',created_at:'2026-01-01T00:00:00.000Z'}],
      'incidents.json':[],'incidents-scheduled.json':[],'subscribers.json':[],
      'incident-templates.json':[{id:'synthetic-lamp-imported-template',name:'synthetic-lamp-imported-template',title:'synthetic-lamp-future-draft',body:'synthetic-lamp-imported-impact',update_status:'investigating',components:[{id:'synthetic-lamp-template-component',status:'major_outage'}]}],
    }).map(([name,value])=>({name,text:JSON.stringify(value)}));
    const reviewed=await moveIn.preview({files});assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
    const imported=await moveIn.apply(reviewed.body);assert.equal(imported.status,200,JSON.stringify(imported.body));
    const importedTemplate=(await j.json('/api/app/incident-templates')).templates.find(row=>row.name==='synthetic-lamp-imported-template');
    await j.json(`/api/app/dependencies/${cloudflare.id}`,'PUT',{mode:'draft',dependentComponentIds:[buyer.id],templateId:importedTemplate.id});
    const undone=await moveIn.undo(imported.body.door);assert.equal(undone.status,200,JSON.stringify(undone.body));
    const savedRule=(await list()).find(row=>row.id===cloudflare.id);
    const incidentsBeforeUndoOutage=(await j.json('/api/app/incidents')).incidents.map(row=>row.id);
    upstream.body=upstream.fixture.cases.find(row=>row.sourceState==='major_outage').body;await tick();
    const futureDraft=(await j.json('/api/app/incidents')).incidents.find(row=>!incidentsBeforeUndoOutage.includes(row.id));
    assert.deepEqual({templateId:savedRule.templateId,mode:savedRule.mode,impact:futureDraft?(await j.read(futureDraft.id)).draft?.customerImpact:null},
      {templateId:importedTemplate.id,mode:'draft',impact:'synthetic-lamp-imported-impact'},'undo retains the owner-saved template choice and future vendor drafting');
    await j.json(`/api/app/dependencies/${cloudflare.id}`,'DELETE',undefined,204);
    assert.ok(!(await publicRows()).some(row=>row.componentId===cloudflare.componentId));
    const history=(await j.json(`/api/app/components/${cloudflare.componentId}/history`)).history;
    assert.ok(history.some(row=>row.sourceName==='Cloudflare'),'unfollow retains attributed history');
  } finally {await browser?.close();await j.close();}
}
