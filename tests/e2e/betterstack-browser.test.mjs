import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { openNativeRuntime, origin, publicOrigin, operator, envelopes } from '../dev-ingress/runtime.mjs';
import { devKey } from '../helpers/dev-key.mjs';

test('MOVE-001 Better Stack source-first wizard and source-specific Cutover preserve history silently at desktop and phone widths', {timeout:600000}, async()=>{
  const runtime=await openNativeRuntime();let browser;
  try {
    await runtime.start();await runtime.seedOperator();browser=await chromium.launch();
    const context=await browser.newContext();
    await context.route(url=>url.pathname.startsWith('/@fs/'),route=>route.continue({headers:{...route.request().headers(),'x-rer-dev-key':devKey}}));
    const page=await context.newPage();await page.goto(origin+'/signin');
    const priorMail=new Set((await envelopes()).map(row=>row.id));
    await page.getByLabel('Email',{exact:true}).fill(operator);
    const requested=page.waitForResponse(response=>response.url()===origin+'/auth/magic-link'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Email a sign-in link'}).click();
    const sent=await requested;
    // The maintained sign-in page submits a native form, not the JSON API.
    assert.equal(sent.request().isNavigationRequest(),true);
    assert.match(sent.request().headers()['content-type'],/^application\/x-www-form-urlencoded(?:;|$)/);
    assert.equal(sent.status(),303);
    assert.equal(sent.headers().location,'/signin?notice=sent');
    await page.waitForURL(origin+'/signin?notice=sent');
    await page.getByRole('status').waitFor();
    const signInMail=(await envelopes()).find(row=>!priorMail.has(row.id)&&row.message.to===operator&&row.message.text.includes('/auth/confirm?'));
    assert.ok(signInMail,'the form submission captures a new sign-in email');
    const link=signInMail.message.text.match(/https?:\/\/[^\s]+/)[0];
    await page.goto(link);await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForURL('**/app');
    await fetch(publicOrigin+'/');
    const evidence=resolve(process.env.LAMP_BETTERSTACK_EVIDENCE??'visual/betterstack');await mkdir(evidence,{recursive:true});
    const api=async(path,body)=>{const response=await page.request.post(origin+path,{headers:{Origin:origin},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
    for(const family of ['small','large']) {
      const hydrated=page.waitForResponse(response=>response.url()===origin+'/api/app/statuspage-import/jobs'&&response.request().method()==='GET'&&response.status()===200);
      await page.goto(origin+'/app/move-in');await hydrated;
      await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('betterstack');
      assert.equal(await page.getByRole('heading',{name:'Move in from Better Stack'}).count(),1);
      const dir=resolve('tests/fixtures/betterstack',family);
      await page.getByLabel('Saved responses').setInputFiles((await readdir(dir)).map(name=>join(dir,name)));
      await page.getByLabel(/This Better Stack page is public and unrestricted/).check();
      const before=(await envelopes()).length;
      const response=page.waitForResponse(r=>r.url().endsWith('/statuspage-import/preview'));
      await page.getByRole('button',{name:'Run dry run',exact:true}).click();const dry=await response;assert.equal(dry.status(),200,await dry.text());
      if(family==='small') {
        await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('statuspage');
        assert.equal(await page.getByRole('heading',{name:'Dry run',exact:true}).count(),0);
        await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('betterstack');
        await page.getByLabel('Saved responses').setInputFiles((await readdir(dir)).map(name=>join(dir,name)));
        await page.getByLabel(/This Better Stack page is public and unrestricted/).check();
        await page.getByRole('button',{name:'Run dry run',exact:true}).click();
      }
      await page.getByLabel('I reviewed what changes, is skipped or is refused.').check();
      const applying=page.waitForResponse(r=>r.url().endsWith('/statuspage-import/apply'));
      await page.getByRole('button',{name:'Import',exact:true}).click();let result=await (await applying).json();
      while(result.job.state==='applying')result=await api(`/api/app/statuspage-import/jobs/${result.job.id}/resume`,{});
      assert.equal(result.job.state,'completed');
      await page.goto(origin+`/app/cutover?job=${result.job.id}`);await page.getByRole('heading',{name:'Old public addresses',exact:true}).waitFor();
      assert.ok((await page.locator('body').innerText()).includes('/index.json'));
      assert.ok(!(await page.locator('body').innerText()).includes('/history.rss'));
      await page.getByLabel('Public address',{exact:true}).fill(publicOrigin);await page.getByRole('button',{name:'Use this address for checks'}).click();
      for(const button of await page.getByRole('button',{name:'Check opens',exact:true}).all()) {await button.click();await button.locator('..').getByRole('status').filter({hasText:/^Opens$/}).waitFor();}
      for(const width of [1440,390]) {await page.setViewportSize({width,height:1000});assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.filter(row=>['serious','critical'].includes(row.impact)),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:join(evidence,`${family}-${width}.png`),fullPage:true});}
      assert.equal((await envelopes()).length,before);
      assert.equal((await fetch(publicOrigin+'/feed.atom')).status,200);
      for(const path of ['/feed.rss','/index.json'])assert.equal((await fetch(publicOrigin+path)).status,404);
      const maintenance=result.report.cutover.rows.find(row=>row.target.startsWith('/maintenance/'));
      assert.match(await (await fetch(publicOrigin+maintenance.target)).text(),/original update 3/);
      let undone=await api(`/api/app/statuspage-import/jobs/${result.job.id}/undo`,{});while(undone.job.state==='undoing')undone=await api(`/api/app/statuspage-import/jobs/${result.job.id}/undo`,{});
      assert.equal(undone.job.state,'undone');assert.equal((await envelopes()).length,before);
    }
    await context.close();
  } finally {await browser?.close();await runtime.close();}
});
