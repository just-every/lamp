import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';

export async function widgetVariantsFlow({appFetch,pageUrl,currentSettings,updateSettings}) {
  let component, incident;
  const previousOrigins=(await currentSettings()).widgetAllowedOrigins;
  const receiver=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><html lang="en"><title>Customer portal embed receiver</title><body><h1>Customer portal</h1></body></html>');});
  await new Promise(resolve=>receiver.listen(0,'127.0.0.1',resolve));
  const receiverOrigin=`http://127.0.0.1:${receiver.address().port}`;
  await updateSettings({widgetAllowedOrigins:[pageUrl,receiverOrigin]});
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext();const page=await context.newPage();
    await page.clock.install();await page.goto(receiverOrigin);
    const install=async variant=>page.evaluate(async({url,variant})=>{
      const script=document.createElement('script');script.src=url;script.dataset.variant=variant;script.dataset.position='top-left';script.dataset.background='#effaf3';script.dataset.color='#182d24';
      document.body.append(script);await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;});
    },{url:pageUrl+'/widget.js',variant});
    await install('banner');await install('dot');await install('floating');
    const widgets=page.locator('section[role=status]');assert.equal(await widgets.count(),3);
    assert.equal(await widgets.nth(1).locator('strong').textContent(),(await (await fetch(pageUrl+'/api/public/status')).json()).overall);
    assert.equal(await widgets.nth(2).isVisible(),false);
    component=(await (await appFetch('/api/app/components',{method:'POST',body:JSON.stringify({name:'Embed journey API',description:'Customer requests',groupId:null,internal:false,displayOrder:1000,note:''})})).json()).component;
    incident=(await (await appFetch('/api/app/incidents',{method:'POST',body:JSON.stringify({title:'Elevated request errors',components:[{componentId:component.id,state:'Major outage',relationship:'Primary'}]})})).json()).incident;
    const draft=async lifecycle=>{
      const response=await appFetch(`/api/app/incidents/${incident.id}/draft`,{method:'PUT',body:JSON.stringify({lifecycle,affectedAudience:'API customers in US East',customerImpact:lifecycle==='Resolved'?'Requests are succeeding again.':'Some API requests fail while we restore the affected workers.',whatStillWorks:'The dashboard remains available.',details:'',nextUpdateAt:lifecycle==='Resolved'?null:new Date(Date.now()+3600000).toISOString()})});assert.equal(response.status,200);
      const published=await appFetch(`/api/app/incidents/${incident.id}/publish`,{method:'POST',body:JSON.stringify({channels:[]})});assert.equal(published.status,200);
    };
    const waitForPublic=async lifecycle=>{
      const until=Date.now()+10000;
      while(true) {const data=await(await fetch(pageUrl+'/api/public/status')).json();if(lifecycle==='Resolved'?data.incident?.reference!==incident.reference:data.incident?.reference===incident.reference) return;assert.ok(Date.now()<until,'publication is visible within 10 seconds');await delay(100);}
    };
    await draft('Investigating');await waitForPublic('Investigating');
    await page.clock.fastForward(30000);
    await widgets.nth(2).waitFor({state:'visible'});assert.match(await widgets.nth(2).innerText(),/Elevated request errors/);
    assert.equal(await widgets.nth(2).evaluate(element=>element.style.top),'16px');
    await draft('Resolved');await waitForPublic('Resolved');await page.clock.fastForward(30000);await widgets.nth(2).waitFor({state:'hidden'});
    const denied=await (await browser.newContext()).newPage();await denied.setContent(`<script src="${pageUrl}/embed/script.js"></script>`);await denied.waitForLoadState();assert.equal(await denied.locator('section[role=status]').count(),0);
  } finally {
    if (incident) await appFetch(`/api/app/incidents/${incident.id}`,{method:'DELETE',body:JSON.stringify({reason:'Remove completed embed test fixture'})});
    if (component) await appFetch(`/api/app/components/${component.id}`,{method:'DELETE'});
    await browser.close();
    receiver.closeAllConnections();await new Promise(resolve=>receiver.close(resolve));
    await updateSettings({widgetAllowedOrigins:previousOrigins});
  }
}
