import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Render the real TSX components with local data and selected hook snapshots.
// Effects, hydration, events, focus and browser visibility remain browser checks.
const require = createRequire(import.meta.url);
let responses, stateSnapshot, stateIndex;
const noop = () => {};
const react = {...React, useState(initial) {
  const index = stateIndex++;
  return React.useState(Object.hasOwn(stateSnapshot, index) ? stateSnapshot[index] : initial);
}};
const appDataContext = React.createContext({});
const cache = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  function localRequire(id) {
    if (id === 'react') return react;
    if (id === '@tanstack/react-router') return {Link: ({to, params, children, ...props}) => React.createElement('a', {...props, href: to}, children), useNavigate: () => noop, useRouterState: ({select}) => select({location: {state: {}, hash: ''}})};
    if (id.endsWith('/ui/api')) return {AppDataContext: appDataContext, useAppData: route => ({data: responses[route] ?? null, loading: false, error: null, refresh: noop}), appApi: () => {throw Error('Render tests must not call an API');}};
    if (id.endsWith('/extensions')) return {ClientExtensionSlot: () => null};
    // As Vite does: a stylesheet import has no exports, and a ?url asset import is its URL.
    if (id.endsWith('.css')) return {};
    if (/\?url\b/.test(id)) return {default: id};
    if (!id.startsWith('.')) return require(id);
    const base = path.resolve(path.dirname(filename), id);
    const found = [base, base+'.tsx', base+'.ts', base+'.mjs', path.join(base,'index.ts')].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    assert.ok(found, `Resolve ${id}`); return load(found);
  }
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {filename})(localRequire,module,module.exports);
  return module.exports;
}
const {PageTimezoneContext} = load("src/core/app/client/ui/timezone.tsx");
const feature = name => `src/core/features/${name}`;
const {OverviewPage} = load(feature('overview/ui/overview-page.tsx'));
const {IncidentDetailPage} = load(feature('incidents/ui/incident-detail-page.tsx'));
const {IncidentOperatorControls} = load(feature('incidents/ui/incident-operator-controls.tsx'));
const {IncidentPreview} = load(feature('incidents/ui/incident-preview.tsx'));
const {IncidentReach} = load(feature('communication-performance/ui/incident-reach.tsx'));
const {MaintenancePage} = load(feature('maintenance/ui/maintenance-page.tsx'));
function render(Component, data, state = {}, props = {}) {
  responses=data; stateSnapshot=state; stateIndex=0;
  return renderToStaticMarkup(React.createElement(PageTimezoneContext.Provider, {value: "Australia/Brisbane"}, React.createElement(Component, props)));
}
const live = { publicOrigin: 'https://status.example.test', publishedAt: '2026-10-02T01:00:00Z', page: { ok: true, checkedAt: '2026-10-02T01:01:00Z', reason: null }, subscribe: { ok: true, checkedAt: '2026-10-02T01:01:00Z', reason: null }, sender: { state: 'local', message: null, checkedAt: null } };
const incident = {id:'incident-render',reference:'INC-RENDER',title:'Checkout delayed',lifecycle:'Investigating',openedAt:'2026-10-02T01:00:00Z',components:[],updates:[],internalNotes:[],draft:null};
const incidentData = {'/api/app/incidents/incident-render':{incident}, '/api/app/incident-templates':{templates:[]}};
const preview = {public:{heading:'Checkout delayed',lifecycle:'Investigating',fields:[{label:'Impact',value:'Checkout is delayed'}]},email:{subject:'Checkout delayed',plainText:'Title\n\nStatus: Investigating\n\nCheckout is delayed'}};
function details(html, summary) {
  const escaped = summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<details([^>]*)><summary>${escaped}</summary>([\\s\\S]*?)</details>`));
  assert.ok(match, `Named disclosure: ${summary}`); return {attributes:match[1],body:match[2]};
}

test("Operator incident overview and composer preserve timing and review controls", async t => {
  t.diagnostic("overview lists each active incident once and offers one action for an overdue update");
  await (() => {
  const html=render(OverviewPage, {'/api/app/overview':{overview:{live,components:[{publicState:'Operational'}],activeIncidents:[{...incident,overdue:true,updateDue:false,updateDueAt:'2026-09-08T01:00:00.000Z',impact:'Degraded performance'}],maintenance:[]}}});
  const list=html.slice(html.indexOf('aria-label="Active incidents"'));
  assert.equal(list.split('INC-RENDER').length-1,1);
  assert.equal(list.split('Checkout delayed').length-1,1);
  assert.equal(html.split('<h2>Active incidents</h2>').length-1,1);
  const notice=html.slice(html.indexOf('aria-label="Updates due"'),html.indexOf('aria-label="Active incidents"'));
  assert.match(notice,/INC-RENDER/); assert.equal(notice.split('href="/app/incidents/').length-1,1,'one action opens the incident composer');
  assert.match(html,/Components and history/);
})(t);
  t.diagnostic("composer shows the page preview and keeps publication timing and private actions closed, with safeguards");
  await (() => {
  // State 6 is the rendered preview and state 9 the publication timing of the incident visit.
  const html=render(IncidentDetailPage,incidentData,{6:preview},{incidentId:incident.id});
  assert.match(html,/Public page/); assert.match(html,/aria-pressed="false"[^>]*>Email<\/button>/);
  assert.match(html,/id="more-options" class="more-options" hidden=""/); assert.match(html,/aria-label="Publication controls"/);
  assert.match(html,/<legend>Notify<\/legend>/); assert.match(html,/<legend>Publish<\/legend>/); assert.doesNotMatch(html,/Historical publication date and time|Scheduled publication date and time/);
  assert.match(html,/<legend>Next update<\/legend>/); assert.doesNotMatch(html,/estimate/i);
  assert.match(html,/Saving draft/); assert.match(html,/<button[^>]*disabled=""[^>]*>Publish update<\/button>/);
  assert.match(html,/id="incident-actions" class="incident-actions-panel" hidden=""/); assert.match(html,/Another operator can review before the scheduled update/);
})(t);
  t.diagnostic("a chosen publication time names its action and what it does to subscribers");
  await (() => {
  const backdated=render(IncidentDetailPage,incidentData,{6:preview,9:{mode:'backdate',at:'2026-10-01T01:00:00Z'}},{incidentId:incident.id});
  assert.match(backdated,/aria-label="Historical publication date and time"/); assert.match(backdated,/Notifies no one/); assert.match(backdated,/>Publish historical update<\/button>/);
  const scheduled=render(IncidentDetailPage,incidentData,{6:preview,9:{mode:'schedule',at:null}},{incidentId:incident.id});
  assert.match(scheduled,/aria-label="Scheduled publication date and time"/); assert.match(scheduled,/Stays private until then/); assert.match(scheduled,/<button[^>]*disabled=""[^>]*>Schedule update<\/button>/);
})(t);
  t.diagnostic("reach and delivery details appear only once the provider accepted or delivered a send, not for planned or suppressed ones");
  await (() => {
  const channel = counts => ({channel:'email',coverage:'known',committed:null,distinctCommitted:null,providerAccepted:null,distinctProviderAccepted:null,delivered:null,distinctDelivered:null,queued:0,bounced:0,complained:0,suppressed:0,failed:0,firstProviderAcceptedAt:null,...counts});
  const reach = (channels, operatorPosts = []) => { const summary = {channels,unknownDeliveryUpdates:0,operatorPosts,deliveryFailure:{failures:0,denominator:0,rate:null,denominatorLabel:'sends'}}; return {incidentId:incident.id,timezone:'Australia/Brisbane',measuredAt:'2026-10-02T01:05:00Z',definitions:{},incident:{...summary,incidentId:incident.id,reference:incident.reference,title:incident.title,openedAt:incident.openedAt,resolvedAt:null,firstAcceptedAlertAt:null,firstPublicUpdateAt:null,firstUpdateLatencyMs:null,resolutionDurationMs:null,commitments:{kept:0,missed:0,pending:0,evaluated:0,keptRate:null},reportOwed:false,retainedImport:false},updates:[]}; };
  const path = `/api/app/incidents/${incident.id}/reach`;
  const reachOf = data => renderToStaticMarkup(React.createElement(appDataContext.Provider, {value: {[path]: {data}}}, React.createElement(PageTimezoneContext.Provider, {value: 'Australia/Brisbane'}, React.createElement(IncidentReach, {incidentId: incident.id, updateIds: []}))));
  const suppressed = reachOf(reach([channel({committed:1,distinctCommitted:1,providerAccepted:0,distinctProviderAccepted:0,delivered:0,distinctDelivered:0,suppressed:1})], [{channel:'slack',committed:1,accepted:0,rejected:1,uncertain:0,pending:0}]));
  assert.doesNotMatch(suppressed, /Emailed|Slack|reach-line|Delivery details/);
  const sent = reachOf(reach([channel({committed:2,distinctCommitted:2,providerAccepted:1,distinctProviderAccepted:1,delivered:1,distinctDelivered:1,suppressed:1})]));
  assert.match(sent, /Emailed 1 subscriber</); assert.match(sent, /Delivery details/);
})();
  t.diagnostic("the email view renders the notification as the renderer produced it");
  await (() => {
  const html=render(IncidentPreview,{},{0:'email'},{preview,error:null});
  assert.match(html,/Notification email/); assert.match(html,/aria-pressed="true"[^>]*>Email<\/button>/); assert.match(html,/Checkout is delayed/);
})(t);
});


test("Maintenance editing and destructive confirmation remain deliberate", async t => {
  t.diagnostic("maintenance date fields are contained in a closed Change dates disclosure");
  await (() => {
  const item={id:'maintenance-render',reference:'MNT-RENDER',title:'Database work',state:'Scheduled',startsAt:'2027-01-02T01:00:30Z',endsAt:'2027-01-02T02:00:30Z',components:[],overrunning:false};
  const html=render(MaintenancePage,{'/api/app/maintenance':{maintenance:[item]},'/api/app/components':{components:[]}});
  const dates=details(html,'Change dates');
  assert.doesNotMatch(dates.attributes,/\bopen\b/); assert.match(dates.body,/MNT-RENDER start/); assert.match(dates.body,/MNT-RENDER end/);
  const outside=html.replace(dates.body,''); assert.doesNotMatch(outside,/MNT-RENDER (start|end)/);
  assert.match(dates.body,/Cancel changes/); assert.match(dates.body,/Reschedule/); assert.match(outside,/Cancel maintenance/);
  assert.match(html,/Choose an end time after the start time/);
})(t);
  t.diagnostic("destructive confirmation retains recorded reason and audit/history warning");
  await (() => {
  const html=render(IncidentOperatorControls,{}, {2:true}, {incident,onChanged:noop,onDeleted:noop});
  assert.match(html,/Removes it from public history. The audit log keeps who deleted it and why/);
  assert.match(html,/aria-label="Deletion reason"/); assert.match(html,/Confirm deletion/); assert.match(html,/>Cancel<\/button>/);
})(t);
});
