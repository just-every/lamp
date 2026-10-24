import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

export const RECORDED_SLACK_WEBHOOK='https://hooks.slack.com/services/synthetic-lamp-1/synthetic-lamp-2/synthetic-lamp-3';
export const RECORDED_SLACK_TEAM='synthetic-lamp-team';
export const recordedSlackOAuth={ok:true,scope:'incoming-webhook',team:{id:RECORDED_SLACK_TEAM},incoming_webhook:{channel:'#synthetic-lamp',channel_id:'synthetic-lamp-channel',url:RECORDED_SLACK_WEBHOOK}};

export async function prepareSlackSubscription({componentId,publicOrigin,sql,widths=[1440,390],onManage}){
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});
  try{
    for(const width of widths){
      const context=await browser.newContext({viewport:{width,height:1000},extraHTTPHeaders:{"CF-Connecting-IP":"192.0.2.14"}}),page=await context.newPage();
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const publicResponse=await page.goto(publicOrigin);
      assert.equal(publicResponse.status(),200);
      await page.getByRole('heading',{name:'Subscribe to status updates'}).waitFor();
      await page.locator('summary').filter({hasText:/^Get updates in Slack$/}).click();
      const form=page.locator('form[action="/subscribe/slack"]');
      await form.getByText('Choose components',{exact:true}).click();
      await form.locator(`input[name="componentId"][value="${componentId}"]`).check();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
      await page.route('https://slack.com/oauth/v2/authorize**',route=>route.fulfill({status:200,contentType:'text/html',body:'<title>Synthetic Slack OAuth edge</title>'}));
      const started=page.waitForResponse(response=>response.url()===`${publicOrigin}/subscribe/slack`&&response.request().method()==='POST');
      await form.getByRole('button',{name:'Get updates in Slack',exact:true}).click();
      const start=await started;
      assert.equal(start.status(),303);
      assert.equal(start.headers()['set-cookie'],undefined,'the public Slack door stores no visitor cookie');
      assert.equal(start.request().headers().cookie,undefined);
      const location=new URL(start.headers().location);
      assert.equal(location.origin,'https://slack.com');assert.equal(location.pathname,'/oauth/v2/authorize');
      assert.equal(location.searchParams.get('scope'),'incoming-webhook');
      const callback=new URL('/subscribe/slack/callback',publicOrigin);callback.searchParams.set('state',location.searchParams.get('state'));callback.searchParams.set('code','synthetic-lamp-oauth-code');
      const response=await page.goto(callback.href);assert.equal(response.status(),200,await page.textContent('body'));
      assert.equal(response.headers()['set-cookie'],undefined,'the callback stores no visitor cookie');
      assert.equal(response.request().headers().cookie,undefined,'hashed OAuth state works without a cookie');
      assert.deepEqual(await context.cookies(),[]);
      await page.getByRole('link',{name:'Manage subscription'}).waitFor();
      if(onManage)await onManage(new URL(await page.getByRole('link',{name:'Manage subscription'}).getAttribute('href'),publicOrigin).href);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
      assert.deepEqual(errors,[]);
      if(process.env.LAMP_BROWSER_EVIDENCE){await mkdir(process.env.LAMP_BROWSER_EVIDENCE,{recursive:true});await page.screenshot({path:join(process.env.LAMP_BROWSER_EVIDENCE,`slack-subscription-${width}.png`),fullPage:true});}
      await context.close();
    }
  }finally{await browser.close();}
  const row=(await sql("SELECT s.id,s.channel,s.state,s.destination,d.sealed_url,t.slack_team_id FROM subscriber_directory s JOIN subscriber_chat_destinations t ON t.subscriber_id=s.id JOIN delivery_channel_destinations d ON d.id=s.id WHERE s.channel='slack'"))[0];
  assert.equal(row.channel,'slack');assert.equal(row.state,'active');assert.equal(row.slack_team_id,RECORDED_SLACK_TEAM);
  assert.doesNotMatch(JSON.stringify(row),/synthetic-lamp-3/,'webhook is only stored encrypted');
  return row.id;
}
export function verifySlackPublication({received}){
  const delivered=received.filter(x=>x.path===new URL(RECORDED_SLACK_WEBHOOK).pathname);
  assert.equal(delivered.length,1);
  assert.match(JSON.parse(delivered[0].body).text,/See <https:\/\/help\.example\.com\/kb\/123>\./);
}
export async function removeSlackSubscription({publicOrigin,signingSecret,id,sql,eventType='app_uninstalled'}){
  const raw=JSON.stringify({type:'event_callback',team_id:RECORDED_SLACK_TEAM,event:{type:eventType}}),timestamp=String(Math.floor(Date.now()/1000));
  const signature='v0='+createHmac('sha256',signingSecret).update(`v0:${timestamp}:${raw}`).digest('hex');
  const response=await fetch(`${publicOrigin}/subscribe/slack/events`,{method:'POST',headers:{'content-type':'application/json','x-slack-request-timestamp':timestamp,'x-slack-signature':signature},body:raw});
  assert.equal(response.status,200,await response.text());
  assert.deepEqual(await sql(`SELECT state,deactivation_reason FROM subscriber_directory AS subscribers WHERE id='${id}'`),[{state:'deactivated',deactivation_reason:eventType}]);
}
