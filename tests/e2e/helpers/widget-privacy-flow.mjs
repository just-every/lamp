import assert from 'node:assert/strict';
import { chromium } from 'playwright';

/** Execute the public script: only the status origin may receive polling reads. */
export async function widgetPrivacyFlow(fixture) {
  const {settings}=await(await fixture.appFetch('/api/app/page-settings')).json();
  const input={pageName:settings.pageName,tagline:settings.tagline,accentColor:settings.accentColor,timezone:settings.timezone,hostname:settings.hostname,footerCreditEnabled:settings.footerCreditEnabled,mailFromAddress:settings.mailFromAddress,aiToneInstructions:settings.aiToneInstructions,widgetAllowedOrigins:[fixture.pageUrl]};
  assert.equal((await fixture.appFetch('/api/app/page-settings',{method:'PUT',body:JSON.stringify(input)})).status,200);
  const browser=await chromium.launch({headless:true,executablePath:process.env.LAMP_CHROMIUM_PATH,args:['--no-sandbox','--use-mock-keychain','--password-store=basic']});
  try {
    const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();await page.clock.install();
    await page.goto(fixture.pageUrl+'/');
    const requests=[];page.on('request',request=>requests.push(request));
    await page.evaluate(url=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=reject;document.body.append(script);}),fixture.pageUrl+'/widget.js');
    assert.equal(await page.locator('section[role=status]').count(),1);
    const polled=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/public/status'&&response.status()===200);
    await page.clock.fastForward(30000);await polled;
    assert.ok(requests.some(request=>new URL(request.url()).pathname==='/api/public/status'));
    for(const request of requests) {
      const url=new URL(request.url());assert.equal(url.origin,fixture.pageUrl, 'widget reads stay on the public status origin');
      assert.equal(url.search,'');assert.equal(request.method(),'GET');assert.equal(request.postData(),null);
      assert.equal((await request.allHeaders()).cookie,undefined);
    }
    const denied=await(await browser.newContext({viewport:{width:1440,height:900}})).newPage();await denied.setContent(`<script src="${fixture.pageUrl}/widget.js"></script>`);await denied.waitForLoadState();
    assert.equal(await denied.locator('section[role=status]').count(),0,'an unlisted origin renders no widget');
  } finally {await browser.close();await fixture.appFetch('/api/app/page-settings',{method:'PUT',body:JSON.stringify({...input,widgetAllowedOrigins:settings.widgetAllowedOrigins})});}
}
