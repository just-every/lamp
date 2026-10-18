import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readDevKey,signInAs } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { reservePort } from './worker-startup.mjs';
import { cutoverRuntime } from './cutover-runtime.mjs';
import { moveInDoor } from '../helpers/import-notifications.mjs';

const owner = 'cutover-owner@example.test';
const evidence = resolve(process.env.LAMP_CUTOVER_EVIDENCE ?? 'visual/cutover');
async function visible(page, width, name) {
  await page.setViewportSize({width,height:1000});
  const axe = await new AxeBuilder({page}).analyze();
  await writeFile(join(evidence, `${name}-${width}-axe.json`), JSON.stringify(axe.violations,null,2));
  assert.deepEqual(axe.violations.filter(row => ['serious','critical'].includes(row.impact)), []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page fits the viewport');
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  await page.screenshot({path:join(evidence,`${name}-${width}.png`),fullPage:true});
}

test('MOVE-006 rer setup twice, one-click sign-in, silent imports and browser cutover at both widths and fixture families', {timeout:1200000}, async () => {
  await mkdir(evidence,{recursive:true});
  const runtime = await cutoverRuntime(evidence);
  const {root} = runtime;
  let browser;
  try {
    execFileSync('sh',['-c','git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$1"','copy',root]);
    await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
    const port = await reservePort(), origin = `http://127.0.0.1:${port}`;
    for(let pass=0;pass<2;pass++) await runtime.run('setup','--owner-email',owner,'--non-interactive','--port',String(port));
    await runtime.start();
    const key = await readDevKey(root);
    browser=await chromium.launch({headless:true,args:["--use-mock-keychain","--password-store=basic"]});
    const context=await browser.newContext();
    await context.route(url=>url.pathname.startsWith('/@fs/'),route=>route.continue({headers:{...route.request().headers(),'x-rer-dev-key':key}}));
    const page=await context.newPage();
    const entered=await signInAs({origin,key});await context.addCookies(entered.cookies.map(c=>({...c,url:origin})));
    await page.goto(origin+entered.location);
    if(new URL(page.url()).pathname==='/setup') {
      await page.getByLabel('Page name').fill('Cutover fixture');
      await page.getByRole('button',{name:'Save and open Lamp'}).click();await page.waitForURL('**/app');
    }
    const api=async(path,body)=>{
      const response=body===undefined ? await page.request.get(origin+path) : await page.request.post(origin+path,{headers:{Origin:origin},data:body});
      assert.equal(response.status(),200,await response.text());return response.json();
    };
    const moveIn=moveInDoor(async(path,body,headers)=>{
      const response=body===undefined ? await page.request.get(origin+path) : await page.request.post(origin+path,{headers:{Origin:origin,...headers},data:body});
      return {status:response.status(),body:await response.json()};
    });
    const publicOrigin=(await api('/api/app/overview')).overview.checklist.publicOrigin;
    await fetch(publicOrigin+'/'); // capture the actual local notification origin
    for(const width of [1440,390]) for(const family of ['small','large']) {
      await page.setViewportSize({width,height:1000});
      const hydrated=page.waitForResponse(response=>response.url()===origin+'/api/app/statuspage-import/jobs'&&response.request().method()==='GET'&&response.status()===200);
      await page.goto(origin+'/app/move-in');await hydrated;
      const fixtureDir=resolve('tests/fixtures/statuspage',family);
      await page.getByLabel('Saved responses').setInputFiles((await readdir(fixtureDir)).map(name=>join(fixtureDir,name)));
      // A source imported and undone in an earlier pass is uploaded afresh: the reviewed plan is the 200.
      const dryResponse=page.waitForResponse(response=>response.url()===origin+'/api/operator/import/plan'&&response.status()===200);
      await page.getByRole('button',{name:'Run dry run',exact:true}).click();
      const dry=await (await dryResponse).json();assert.ok(dry.report.cutover.rows.length);
      // Inspect the proposed table before apply, then return to the retained wizard.
      await page.getByRole('link',{name:'Read the Cutover preview',exact:true}).click();
      await page.getByRole('heading',{name:'Old public addresses',exact:true}).waitFor();
      await expect(page.getByRole('button',{name:'Send invitations',exact:true})).toBeDisabled();
      await visible(page,width,`${family}-dry-run`);
      const returned=page.waitForResponse(response=>response.url()===origin+'/api/app/statuspage-import/jobs'&&response.request().method()==='GET'&&response.status()===200);
      await page.goBack();await returned;
      await page.getByRole('heading',{name:'Move in from Statuspage',exact:true}).waitFor();
      await visible(page,width,`${family}-return-to-import`);
      // The document navigation discards source files; reselect and review freshly.
      await page.getByLabel('Saved responses').setInputFiles((await readdir(fixtureDir)).map(name=>join(fixtureDir,name)));
      await page.getByRole('button',{name:'Run dry run',exact:true}).click();
      await page.getByLabel('I reviewed what changes, is skipped or is refused.').check();
      const applying=page.waitForResponse(response=>/\/api\/app\/statuspage-import\/jobs\/[^/]+$/.test(new URL(response.url()).pathname)&&response.request().method()==='GET');
      await page.getByRole('button',{name:'Import',exact:true}).click();
      const result=await (await applying).json();
      assert.equal(result.job.state,'completed');
      await page.goto(origin+`/app/cutover?job=${result.job.id}`);
      await page.getByRole('heading',{name:'Old public addresses',exact:true}).waitFor();
      assert.ok(result.report.cutover.invitations.eligible>0);
      await expect(page.getByRole('button',{name:'Send invitations',exact:true})).toBeEnabled();
      await page.getByLabel('Public address',{exact:true}).fill(publicOrigin);
      await page.getByRole('button',{name:'Use this address for checks'}).click();
      const buttons=page.getByRole('button',{name:'Check opens',exact:true});
      assert.ok(await buttons.count()>0&&await buttons.count()<=25);
      for(const button of await buttons.all()) {
        await button.click();await button.locator('..').getByRole('status').filter({hasText:/^Opens$/}).waitFor();
      }
      await visible(page,width,`${family}-opens`);
      const feed=await fetch(publicOrigin+'/history.atom');assert.equal(feed.status,200);assert.match(feed.headers.get('content-type'),/atom/);
      for(const path of ['/history.rss','/api/v2/status.json']) { const response=await fetch(publicOrigin+path);assert.equal(response.status,200);assert.ok((await response.text()).length>0); }
      await page.getByLabel('Public address',{exact:true}).fill(`http://127.0.0.1:${await reservePort()}`);
      await page.getByRole('button',{name:'Use this address for checks'}).click();
      const first=page.getByRole('button',{name:'Check opens',exact:true}).first();await first.click();
      await first.locator('..').getByRole('status').filter({hasText:'Could not verify'}).waitFor();
      await visible(page,width,`${family}-unreachable`);
      const sending=page.waitForResponse(response=>response.url().endsWith('/send-invitations'));
      await page.getByRole('button',{name:'Send invitations',exact:true}).click();
      const sent=await sending;assert.equal(sent.status(),200);
      assert.equal((await sent.json()).report.cutover.invitations.eligible,0);
      await expect(page.getByRole('button',{name:'Send invitations',exact:true})).toBeDisabled();
      await visible(page,width,`${family}-invitations-sent`);
      const repeated=await api(`/api/app/statuspage-import/jobs/${result.job.id}/send-invitations`,{});
      assert.equal(repeated.invites.sent,0);assert.equal(repeated.report.cutover.invitations.eligible,0);
      await page.getByRole('link',{name:'Move in',exact:true}).first().click();
      await page.getByRole('heading',{name:'Move in from Statuspage',exact:true}).waitFor();
      await visible(page,width,`${family}-return-after-invitations`);
      await page.goto(origin+`/app/cutover?job=${result.job.id}`);
      await page.getByRole('heading',{name:'Old public addresses',exact:true}).waitFor();
      await expect(page.getByRole('button',{name:'Send invitations',exact:true})).toBeDisabled();
      await visible(page,width,`${family}-saved-invitations`);
      const files=await Promise.all((await readdir(fixtureDir)).map(async name=>({name,text:await readFile(join(fixtureDir,name),'utf8')})));
      const again=await moveIn.preview({files});assert.equal(again.status,200,JSON.stringify(again.body));
      const reapplied=await moveIn.apply(again.body);assert.equal(reapplied.body.job.id,result.job.id);
      const undone=await moveIn.undo(result.door);assert.equal(undone.body.job.state,'undone');
      for(const row of result.report.cutover.rows) assert.equal((await fetch(publicOrigin+row.path)).status,404);
    }
    await context.close();
  } finally {
    await browser?.close();
    await runtime.close();
  }
});
