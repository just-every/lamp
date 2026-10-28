import assert from 'node:assert/strict';
import { RECORDED_SLACK_WEBHOOK } from '../slack-subscriptions-helper.mjs';
import { subscriberTeamsUrl } from '../teams-subscriptions-helper.mjs';

/** Token management, Settings, maintenance actions and the real scheduled entry
 * prove chat preferences and retained-recipient maintenance notices. */
export async function chatPreferencesFlow({runtime,publicOrigin,received,publish,component,manageUrls}){
  assert.ok(manageUrls.every(Boolean),'the channel confirmation pages supply management capabilities');
  const saved=(await runtime.api('/api/app/page-settings')).body.settings;
  const {pageName,tagline,accentColor,hostname,footerCreditEnabled,widgetAllowedOrigins,mailFromAddress}=saved;
  const timezone=await runtime.api('/api/app/page-settings',{method:'PUT',body:JSON.stringify({pageName,tagline,accentColor,hostname,footerCreditEnabled,widgetAllowedOrigins,mailFromAddress,timezone:'Australia/Brisbane'})});
  assert.equal(timezone.status,200,timezone.text);
  const manage=async(componentId,kinds)=>{
    for(const url of manageUrls){
      const fields=new URLSearchParams([['componentId',componentId],['preferencesPresent','1'],...kinds.map(kind=>['eventKind',kind])]);
      const result=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',Origin:publicOrigin},body:fields});
      assert.equal(result.status,200,await result.text());
    }
  };
  const slackPath=new URL(RECORDED_SLACK_WEBHOOK).pathname,teamsPath=new URL(subscriberTeamsUrl).pathname;
  const posts=()=>({slack:received.filter(row=>row.path===slackPath),teams:received.filter(row=>row.path.startsWith(teamsPath))});
  const flush=async()=>{const worker=await runtime.runtime.getWorker();const result=await worker.scheduled({cron:'* * * * *'});assert.equal(result.outcome,'ok','the ordinary scheduled handler dispatches committed channel notices');};
  const nextNotice=async(action,label)=>{
    const before=posts();await action();await flush();const after=posts();
    assert.equal(after.slack.length,before.slack.length+1,`Slack receives ${label} once`);
    assert.equal(after.teams.length,before.teams.length+1,`Teams receives ${label} once`);
    return {slack:JSON.parse(after.slack.at(-1).body),teams:JSON.parse(after.teams.at(-1).body)};
  };
  const create=async(hours,title)=>{
    const startsAt=new Date(Date.now()+hours*3600000).toISOString(),endsAt=new Date(Date.parse(startsAt)+3600000).toISOString();
    const result=await runtime.post('/api/app/maintenance',{ affectedAudience: "Customers using the scheduled service.", customerImpact: "Requests may be interrupted during this maintenance window.",title,startsAt,endsAt,componentIds:[component.id],autoStart:false,autoComplete:false});
    assert.equal(result.status,201,result.text);return result.body.maintenance;
  };
  await manage(component.id,['maintenance']);
  const beforeIncident=posts();
  await publish('Incident publication excluded by maintenance-only chat preferences.');
  const afterIncident=posts();
  assert.equal(afterIncident.slack.length,beforeIncident.slack.length,'maintenance-only Slack receives no incident');
  assert.equal(afterIncident.teams.length,beforeIncident.teams.length,'maintenance-only Teams receives no incident');
  let window;
  await nextNotice(async()=>{window=await create(48,'Chat maintenance. See https://help.example.com/kb/123.');},'the scheduled notice');
  let started;
  const messages=await nextNotice(async()=>{const result=await runtime.post(`/api/app/maintenance/${window.id}/start`);assert.equal(result.status,200,result.text);started=result.body.maintenance;},'the maintenance start');
  const notice=started.notices.find(row=>row.kind==='started');assert.ok(notice);
  assert.match(messages.slack.text,/Maintenance: started/);
  assert.match(messages.slack.text,/See <https:\/\/help\.example\.com\/kb\/123>\./);
  assert.ok(messages.slack.text.includes('UTC+10:00')&&messages.slack.text.includes(notice.publishedAt),'Slack retains the exact notice instant beside its configured-zone display');
  const teamsText=messages.teams.attachments[0].content.body.map(block=>block.text).join('\n');
  assert.match(teamsText,/Maintenance: started/);
  assert.match(teamsText,/See \[https:\/\/help\\\.example\\\.com\/kb\/123\]\(https:\/\/help\.example\.com\/kb\/123\)\\\./);
  const teamsVisible=teamsText.replace(/\\(.)/g,'$1');
  assert.ok(teamsVisible.includes('UTC+10:00')&&teamsVisible.includes(notice.publishedAt),'Teams retains the exact notice instant beside its configured-zone display');

  let changedWindow;
  await nextNotice(async()=>{changedWindow=await create(72,'Previously selected chat maintenance.');},'a second scheduled notice');
  const other=await runtime.post('/api/app/components',{groupId:null,name:'Unrelated chat selection',description:'',internal:false,displayOrder:1,note:''});assert.equal(other.status,201,other.text);
  await manage(other.body.component.id,['maintenance']);
  await nextNotice(async()=>{
    const result=await runtime.api(`/api/app/maintenance/${changedWindow.id}/window`,{method:'PUT',body:JSON.stringify({startsAt:new Date(Date.parse(changedWindow.startsAt)+3600000).toISOString(),endsAt:new Date(Date.parse(changedWindow.endsAt)+3600000).toISOString()})});assert.equal(result.status,200,result.text);
  },'the original subscription\'s reschedule despite changed component selection');
  await nextNotice(async()=>{const result=await runtime.post(`/api/app/maintenance/${changedWindow.id}/cancel`);assert.equal(result.status,200,result.text);},'the original subscription\'s cancellation despite changed component selection');
  await manage(component.id,['incidents','maintenance']);
  const restored=await runtime.api('/api/app/page-settings',{method:'PUT',body:JSON.stringify({pageName,tagline,accentColor,hostname,footerCreditEnabled,widgetAllowedOrigins,mailFromAddress,timezone:saved.timezone})});
  assert.equal(restored.status,200,restored.text);
}

