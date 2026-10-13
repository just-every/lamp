import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { load } from '../operator-readiness/runtime.mjs';
const { readBetterStack, fetchBetterStack, mapSource } = await load('tests/betterstack/reader-adapter.ts');
export const fixture = family => readdirSync(`tests/fixtures/betterstack/${family}`).map(name => ({name,text:readFileSync(`tests/fixtures/betterstack/${family}/${name}`,'utf8')}));
const edit = (files,name,change) => { const file=files.find(file=>file.name===name);const raw=JSON.parse(file.text);change(raw);file.text=JSON.stringify(raw);return files; };

test('saved Better Stack pages retain complete raw history and refuse unknown access, state, scope and incomplete continuations',async()=>{
  const read=await readBetterStack(fixture('large'),{publicAccessAcknowledged:true});
  assert.deepEqual([read.data.groups.length,read.data.components.length,read.data.incidents.length,read.data.maintenance.length,read.data.subscribers.length],[4,12,36,3,159]);
  assert.equal([...read.data.incidents,...read.data.maintenance].reduce((n,row)=>n+row.incident_updates.length,0),81);
  assert.equal(read.accounting.filter(row=>row.outcome==='skipped').length,1);
  assert.equal(Object.values(read.publicAddresses).flat().length,4);
  const noLinks=await readBetterStack(fixture('small').filter(file=>!file.name.startsWith('webhook-')),{publicAccessAcknowledged:true});
  assert.deepEqual(noLinks.publicAddresses,{});
  for (const times of [['2025-01-01T11:00:00+02:00','2025-01-01T10:00:00Z'],['2025-01-01T09:00:00Z','2025-01-01T08:30:00-02:00'],['2025-01-01T11:00:00+02:00','2025-01-01T09:00:00Z']]) {
    const files=fixture('small');
    const report=JSON.parse(files.find(file=>file.name==='status-reports.json').text).data[0];
    edit(files,`status-updates-${report.id}.json`,raw=>{
      raw.data.forEach((row,index)=>{row.attributes.published_at=times[index];row.attributes.affected_resources.forEach(affected=>{affected.status='downtime';});});
      raw.data.reverse();
    });
    const read=await readBetterStack(files,{publicAccessAcknowledged:true});
    const mapped=mapSource(read.data,{maxGroupOrder:0,maxComponentOrder:0,lastReference:{INC:0,SCH:0},allocated:new Set(),destinations:new Set()},'operator','2025-02-01T00:00:00Z','betterstack');
    const tables=mapped.find(row=>row.kind==='incident'&&row.sourceId===report.id).value.tables;
    assert.equal(tables.incidents[0].lifecycle,'Resolved');
    assert.equal(tables.incidents[0].resolved_at,new Date(report.attributes.ends_at).toISOString());
    assert.deepEqual(tables.incident_updates.map(row=>[row.published_at,row.lifecycle]),times.map((time,index)=>[new Date(time).toISOString(),index===0?'Investigating':'Resolved']));
    const component=mapped.find(row=>row.kind==='component'&&row.sourceId===report.attributes.affected_resources[0].status_page_resource_id);
    const history=component.value.tables.component_state_history;
    assert.equal(history.at(-1).new_state,'Operational');
    assert.equal(history.at(-1).changed_at,new Date(report.attributes.ends_at).toISOString());
    assert.deepEqual(read.records.find(row=>row.kind==='incident'&&row.sourceId===report.id).payload.updates.map(row=>row.attributes.published_at),[...times].reverse());
  }
  const detailed=fixture('small');const report=JSON.parse(detailed.find(file=>file.name==='status-reports.json').text).data[0];
  const updateFile=detailed.find(file=>file.name===`status-updates-${report.id}.json`);const included=JSON.parse(updateFile.text).data;
  detailed.push({name:`status-report-${report.id}.json`,text:JSON.stringify({data:report,included:included.map(row=>{const copy=structuredClone(row);delete copy.attributes.notify_subscribers;return copy;})})});
  const deduplicated=await readBetterStack(detailed,{publicAccessAcknowledged:true});assert.equal(deduplicated.data.incidents[0].incident_updates.length,2);
  const includedOnly=await readBetterStack(detailed.filter(file=>file!==updateFile),{publicAccessAcknowledged:true});assert.equal(includedOnly.data.incidents[0].incident_updates.length,2);
  assert.ok(read.artifacts.every(a=>a.original.status==='available'));
  assert.ok(read.records.find(r=>r.kind==='component').payload.attributes.resource_id !== read.data.components[0].id);
  const check=files=>readBetterStack(files,{publicAccessAcknowledged:true});
  await assert.rejects(()=>readBetterStack(fixture('small')),/public and unrestricted/);
  for(const update of [a=>{delete a.published},a=>{a.published=false},a=>{a.password_enabled=true},a=>{a.ip_allowlist=['192.0.2.1']},a=>{a.audiences=['private']}]) await assert.rejects(()=>check(edit(fixture('small'),'status-page.json',raw=>update(raw.data.attributes))),/visibility|private/);
  await assert.rejects(()=>check(edit(fixture('small'),'resources.json',raw=>{raw.data[0].attributes.status='not_monitored'})),/cannot be represented/);
  await assert.rejects(()=>check(fixture('large').filter(f=>f.name!=='subscribers-2.json')),/missing complete/);
  await assert.rejects(()=>check(edit(fixture('small'),'subscribers.json',raw=>{raw.pagination.next='https://evil.example/steal?page=2'})),/fixed API origin/);
  await assert.rejects(()=>check(edit(fixture('small'),'sections.json',raw=>{raw.data[0].attributes.status_page_id=999})),/another page/);
  const skipped=await check(edit(fixture('small'),'subscribers.json',raw=>{raw.data[0].attributes.status_page_resource_ids=['missing'];raw.data[1].attributes.channel='sms'}));
  assert.equal(skipped.data.subscribers.length,1);
  for (const field of ['phone_number','sms','slack','webhook_url']) {
    const defensive=await check(edit(fixture('small'),'subscribers.json',raw=>{raw.data[0].attributes[field]='synthetic-destination';}));
    assert.ok(defensive.accounting.some(row=>row.outcome==='skipped'&&row.reason.includes(field)));
  }
  assert.ok(skipped.accounting.some(row=>row.reason.includes('broadened')));
  await assert.rejects(()=>check([{name:'status-page.json',text:'{oops'}]),/invalid Better Stack JSON/);
  await assert.rejects(()=>check([{name:'status-page.json',text:'x'.repeat(8*1024*1024+1)}]),/8 MiB/);
});

test('API token reader follows every fixed-origin GET continuation, refuses redirects and bounds responses without truncation',async()=>{
  const files=fixture('large').filter(file=>!file.name.startsWith('webhook-'));
  const calls=[];
  const fetcher=async(input,init)=>{
    const url=new URL(input);calls.push({url,init});
    const path=url.pathname.split('/').slice(5);
    const stem=path.length===0?'status-page':path[0]==='status-reports'&&path.length>1?`status-updates-${path[1]}`:path[0];
    const page=Number(url.searchParams.get('page')??1);
    const file=files.find(file=>file.name===`${stem}${page===1?'':`-${page}`}.json`);
    assert.ok(file,url.href);return new Response(file.text,{status:200});
  };
  const result=await fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher});
  assert.equal(result.length,files.length);
  assert.ok(calls.every(({url,init})=>url.origin==='https://incidents.betterstack.com'&&init.method==='GET'&&init.redirect==='manual'&&init.headers.Authorization==='Bearer synthetic-token-only'));
  assert.ok(calls.some(({url})=>url.pathname.includes('/status-updates')&&url.searchParams.get('page')==='2'));
  await readBetterStack(result,{publicAccessAcknowledged:true});
  await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async()=>new Response(JSON.stringify({data:{description:'synthetic-token-only'}}))}), error => error.message.includes('credential material') && !error.message.includes('synthetic-token-only'));
  const pageText=files.find(file=>file.name==='status-page.json').text;
  for (const apiKey of ['synthetic-token-only','synthetic-"slash\\token']) {
    const escaped=[...apiKey].map(char=>`\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`).join('');
    const page=JSON.parse(pageText);page.data.attributes.company_name=`Prefix ${apiKey} suffix`;
    const reflected=JSON.stringify(page).replace(JSON.stringify(apiKey).slice(1,-1),escaped);
    const extra=members=>pageText.replace(/\}\s*$/u,`,${members}}`);
    for (const text of [reflected,extra(`"${escaped}":{"nested":["unrelated"]}`),extra(`"extension":{"nested":["${escaped}"]}`),extra(`"extension":"${escaped}","extension":"replaced"`)]) {
      await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey,fetcher:async(input,init)=>new URL(input).pathname.endsWith('/32001')?new Response(text):fetcher(input,init)}),error=>error.message.includes('credential material')&&!error.message.includes(apiKey));
    }
  }
  await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}})}),/redirects are refused/);
  await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async()=>new Response('x'.repeat(8*1024*1024+1))}),/8 MiB/);
  await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async input=>new Response(new URL(input).pathname.endsWith('/32001')?pageText:JSON.stringify({data:Array.from({length:5001},()=>({id:'synthetic'})),pagination:{next:null}}))}),/record limit/);
  await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async input=>{
    const url=new URL(input);if(url.pathname.endsWith('/32001'))return new Response(pageText);
    const page=Number(url.searchParams.get('page')??1);return new Response(JSON.stringify({data:[],pagination:{next:`https://incidents.betterstack.com${url.pathname}?page=${page+1}`}}));
  }}),/pagination limit/);
  for(const next of ['https://evil.example/sections?page=2','https://incidents.betterstack.com/api/v2/status-pages/999/sections?page=2','https://incidents.betterstack.com/api/v2/status-pages/32001/status-reports/foreign/status-updates?page=2']) await assert.rejects(()=>fetchBetterStack({pageId:'32001',apiKey:'synthetic-token-only',fetcher:async input=>new Response(new URL(input).pathname.endsWith('/32001')?pageText:JSON.stringify({data:[],pagination:{next}}))}),/fixed API origin/);

});
