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
    if (id === '@tanstack/react-router') return {Link: ({to, params, children, ...props}) => React.createElement('a', {...props, href: to}, children), useNavigate: () => noop};
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
  t.diagnostic("composer renders closed named email and timing disclosures with safeguards");
  await (() => {
  const html=render(IncidentDetailPage,incidentData,{7:preview},{incidentId:incident.id});
  const email=details(html,'Email preview'), timing=details(html,'Schedule or backdate');
  assert.doesNotMatch(email.attributes,/\bopen\b/); assert.match(email.body,/Notification email/);
  assert.doesNotMatch(timing.attributes,/\bopen\b/); assert.match(timing.body,/Scheduled publication date and time/); assert.match(timing.body,/Historical publication date and time/);
  assert.match(timing.body,/without notifying subscribers/);
  assert.match(html,/A communication commitment, not an estimate of service restoration/);
  assert.match(html,/Saving draft/); assert.match(html,/<button[^>]*disabled=""[^>]*>Publish update<\/button>/);
  assert.match(html,/Another operator can review before the scheduled update/);
})(t);
  t.diagnostic("active historical timing stays exposed and names its publication action");
  await (() => {
  const html=render(IncidentDetailPage,incidentData,{7:preview,11:'2026-10-01T01:00:00Z'},{incidentId:incident.id});
  assert.match(details(html,'Schedule or backdate').attributes,/\bopen=""/);
  assert.match(html,/Publish historical update/); assert.match(html,/Use current time/);
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
