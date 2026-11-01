import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'parse5';
import { chatDeskNativeFlow } from '../chat-desk/flow.mjs';
import { assertLinkedUpdateHtml, assertLinkedFeed } from './helpers/update-link-evidence.mjs';
import { openStatusJourney, eventually, wording, visibleText } from './helpers/status-journey.mjs';
import { assertEmptyCalendar, validateMaintenanceCalendar } from './helpers/calendar-assertions.mjs';

function descendants(node) {
  return (node.childNodes ?? []).flatMap(child => [child, ...descendants(child)]);
}
function nodeText(node) {
  return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(nodeText).join('');
}
function publicUpdate(html, details) {
  const updates = descendants(parse(html)).filter(node => node.tagName === 'article'
    && node.attrs.some(attr => attr.name === 'class' && attr.value.split(' ').includes('update'))
    && nodeText(node).includes(details));
  assert.equal(updates.length, 1, `one public update contains ${details}`);
  return updates[0];
}
// Brisbane has a fixed ten-hour offset. Compute the expected calendar date
// independently of Lamp's formatter, including a possible UTC date rollover.
function brisbaneTime(instant) {
  const local = new Date(Date.parse(instant) + 10 * 3600_000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][local.getUTCMonth()];
  return `${month} ${local.getUTCDate()}, ${local.getUTCFullYear()}, ${local.toISOString().slice(11, 16)} UTC+10:00`;
}

test('INCIDENT-001 INCIDENT-002 INCIDENT-003 INCIDENT-004 INCIDENT-005 INCIDENT-006 INCIDENT-007 INCIDENT-008 INCIDENT-009 INCIDENT-013 HIST-005 HIST-008 NOTIFY-015 UPDATE-001 UPDATE-002 UPDATE-003 UPDATE-004 UPDATE-005 UPDATE-006 UPDATE-007 UPDATE-008 UPDATE-009 UPDATE-011 UPDATE-012 UPDATE-013 COMP-006 HIST-001 HIST-002 HIST-003 AGENT-005 AUTO-004 UPTIME-009 — reviewed incident from private template to immutable updates, recovery, report and audited deletion', async () => {
  const j = await openStatusJourney({ extraBindings: { LAMP_TEST_REQUIRE_REVIEW: 'true' } });
  const reviewer = 'synthetic-lamp-reviewer@example.test';
  const owner = () => j.signIn();
  const review = async id => {
    await j.signIn(reviewer);
    await j.json(`/api/app/incidents/${id}/draft/review`, 'POST', {});
  };
  const saveReviewed = async (id, patch) => { await owner(); await j.save(id, patch); await review(id); };
  try {
    const savedSettings = (await j.json('/api/app/page-settings')).settings;
    const settings = Object.fromEntries(['pageName', 'tagline', 'accentColor', 'timezone', 'hostname', 'mailFromAddress', 'template', 'footerCreditEnabled', 'widgetAllowedOrigins'].map(key => [key, savedSettings[key]]));
    await j.json('/api/app/page-settings', 'PUT', { ...settings, timezone: ['Australia', 'Brisbane'].join('/') });
    assert.equal((await j.raw('/api/app/components')).status, 401);
    assert.equal((await j.raw(new URL('/api/app/components', j.publicOrigin).href)).status, 404);
    await j.json('/api/app/operators/invite', 'POST', { email: reviewer, displayName: 'Incident reviewer' }, 202);
    const component = await j.component('Payments API');
    const hidden = await j.component('PRIVATE internal queue', { internal: true });
    const template = (await j.json('/api/app/incident-templates', 'POST', {
      name: 'Customer API recovery', ...wording, nextUpdateOffsetMinutes: 60,
      components: [{ componentId: component.id, state: 'Major outage', relationship: 'Primary' }],
    }, 201)).template;
    const incident = await j.incident('Payment requests delayed', [component, hidden]);
    const endpoint = `/api/app/incidents/${incident.id}`;
    assert.equal(incident.lifecycle, 'Investigating');
    assert.ok(incident.reference);
    await j.json(`${endpoint}/internal-notes`, 'POST', { body: 'PRIVATE investigation note' }, 201);
    await j.publish(incident.id, {}, 400);
    await j.json(`${endpoint}/templates/${template.id}/apply`, 'POST', {});
    const privateDraft = (await j.read(incident.id)).draft;
    assert.equal(privateDraft.customerImpact, wording.customerImpact);
    for (const path of ['/', '/history', '/feed.atom', '/api/public/status']) {
      const body = await j.publicText(path);
      assert.ok(!body.includes(incident.title) && !body.includes('PRIVATE investigation note'));
    }
    await j.json(`${endpoint}/draft/review`, 'POST', {}, 409);
    await j.publish(incident.id, {}, 409);
    const preview = await j.json(`${endpoint}/draft/preview`, 'POST', { ...wording, nextUpdateAt: privateDraft.nextUpdateAt });
    assert.ok(JSON.stringify(preview.preview).includes(wording.customerImpact));
    await review(incident.id);
    const subscriber = 'reviewed-publication-reader@example.test';
    const subscription = await j.raw(new URL('/subscribe', j.publicOrigin).href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: subscriber, componentId: component.id }) });
    assert.equal(subscription.status, 202);
    const confirmation = await eventually(() => j.messages.find(mail => mail.to.includes(subscriber)), Boolean, 'subscriber confirmation mail');
    assert.equal((await j.raw(confirmation.text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)[0])).status, 200);
    const first = (await j.publish(incident.id, { channels: ['email'] })).update;
    await j.tick(Date.now());
    const reached = await eventually(() => j.json(`${endpoint}/reach?updateId=${first.id}`), body => body.updates[0].channels.some(row => row.channel === 'email' && row.providerAccepted === 1), 'the frozen publication reaches its committed subscriber');
    assert.equal(reached.updates[0].channels.find(row => row.channel === 'email').committed, 1);
    const customerMail = j.messages.find(mail => mail.to.includes(subscriber) && !mail.text.includes('/confirm-subscription/'));
    for (const value of Object.values(wording).filter(value => value !== 'Identified')) assert.ok(customerMail.text.includes(value));
    assert.equal(customerMail.subject, preview.preview.email.subject, 'notification subject matches the preview');
    assert.equal(customerMail.text.split('\n\nManage this subscription:')[0], preview.preview.email.plainText, 'the complete customer message matches the preview before personal subscription links');
    await j.visible(`/incidents/${incident.reference}`, wording.customerImpact);
    for (const path of ['/', `/incidents/${incident.reference}`, '/feed.atom', '/widget.js']) {
      const body = await j.publicText(path);
      assert.ok(body.includes(incident.title), path);
      if (path !== '/feed.atom') assert.ok(visibleText(body).includes(wording.customerImpact), path);
      assert.ok(!body.includes('PRIVATE investigation note') && !body.includes(hidden.name), path);
    }
    const firstBody = await j.publicText(`/incidents/${incident.reference}`);
    assertLinkedUpdateHtml(firstBody, 'public incident');
    assertLinkedUpdateHtml(await j.publicText('/'), 'public root');
    assertLinkedFeed(await j.publicText('/feed.atom'), 'public Atom');
    for (const value of Object.values(wording).filter(value => value !== 'Identified')) {
      assert.ok(preview.preview.public.fields.some(field => field.value === value));
      assert.ok(preview.preview.email.plainText.includes(value));
    }
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Major outage');

    await saveReviewed(incident.id, { lifecycle: 'Monitoring', customerImpact: 'Payments are recovering.', componentChanges: [{ componentId: component.id, state: 'Degraded performance' }] });
    const monitoring = (await j.publish(incident.id)).update;
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Degraded performance');
    assert.equal((await j.read(incident.id)).impact, 'Major outage');
    const impact = (await j.json(`${endpoint}/impact`, 'PUT', { impactOverride: 'minor' })).impact;
    assert.equal(impact.effectiveImpact, 'minor');
    const publicIncident = (await (await j.publicResponse('/api/v2/incidents.json')).json()).incidents.find(row => row.shortlink.endsWith(incident.reference));
    assert.equal(publicIncident.impact, 'minor');
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Degraded performance');
    await j.json(`${endpoint}/impact`, 'PUT', { impactOverride: null });
    const oldVersion = `${privateDraft.id}:0`;
    const stale = await j.api(`${endpoint}/publish`, { method: 'POST', headers: { 'If-Match': oldVersion }, body: JSON.stringify({ channels: [] }) });
    assert.equal(stale.status, 409);

    await owner();
    await j.save(incident.id, { lifecycle: 'Monitoring', details: 'Corrected recovery wording.', nextUpdateAt: new Date(Date.now() - 60000).toISOString() });
    const committedTime = (await j.read(incident.id)).draft.nextUpdateAt;
    assert.ok(committedTime, 'the saved draft has a next-update commitment');
    await j.json(`${endpoint}/draft/correction`, 'POST', { updateId: monitoring.id });
    await review(incident.id);
    const corrected = (await j.publish(incident.id)).update;
    assert.equal(corrected.nextUpdateAt, committedTime, 'publication keeps the saved commitment');
    assert.equal(corrected.correctsUpdateId, monitoring.id);
    const correctedView = await j.read(incident.id);
    assert.deepEqual(correctedView.updates.find(row => row.id === first.id), first);
    assert.deepEqual(correctedView.updates.find(row => row.id === monitoring.id), monitoring);
    assert.equal(correctedView.overdue, true);
    assert.ok(!(await j.publicText(`/incidents/${incident.reference}`)).includes('overdue'));
    for (const path of ['/', `/incidents/${incident.reference}`]) {
      const html = await j.visible(path, corrected.details);
      const update = publicUpdate(html, corrected.details);
      const fields = descendants(update).filter(node => node.tagName === 'div'
        && node.childNodes.some(child => child.tagName === 'dt' && nodeText(child) === 'Next update by'));
      assert.equal(fields.length, 1, `${path}: the overdue update retains its labeled commitment`);
      const value = fields[0].childNodes.find(node => node.tagName === 'dd');
      const times = descendants(value).filter(node => node.tagName === 'time');
      assert.equal(times.length, 1, `${path}: the commitment has one semantic timestamp`);
      assert.equal(times[0].attrs.find(attr => attr.name === 'datetime')?.value, committedTime, `${path}: the committed instant is unchanged`);
      assert.equal(nodeText(value), brisbaneTime(committedTime), `${path}: the commitment stays in the configured zone`);
      assert.doesNotMatch(nodeText(parse(html)), /overdue/i, `${path}: no public overdue label`);
    }

    await saveReviewed(incident.id, { lifecycle: 'Resolved', customerImpact: 'Payment processing has recovered.', nextUpdateAt: null });
    await j.publish(incident.id);
    const resolved = await j.read(incident.id);
    assert.equal(resolved.lifecycle, 'Resolved');
    assert.equal(typeof resolved.resolvedAt, 'string');
    assert.equal((await j.read(incident.id)).draft, null);
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Operational');
    await j.visible('/history', incident.title);
    const reportPath = `${endpoint}/report`;
    const generated = (await j.json(`${reportPath}/draft`, 'POST', {})).report;
    assert.equal(generated.publishedAt, null);
    assert.ok(!JSON.stringify(generated).includes('PRIVATE investigation note'));
    await j.json(`${reportPath}/publish`, 'POST', { channels: [] }, 400);
    const report = { summary: 'Payment incident reviewed', timeline: generated.timeline, cause: 'A connection pool was exhausted.', remediation: 'We increased capacity and added alerting.' };
    await j.json(reportPath, 'PUT', report);
    await j.json(`${reportPath}/publish`, 'POST', { channels: [] });
    await j.visible(`/incidents/${incident.reference}`, report.cause);
    await j.json(reportPath, 'PUT', { ...report, cause: 'Changed later' }, 409);
    await j.json(`${reportPath}/publish`, 'POST', { channels: [] }, 409);
    assert.ok(!(await j.json('/api/app/reports/owing')).incidentIds.includes(incident.id));

    await saveReviewed(incident.id, { lifecycle: 'Investigating', customerImpact: 'Payments need another investigation.' });
    await j.publish(incident.id);
    assert.equal((await j.read(incident.id)).lifecycle, 'Investigating');
    await saveReviewed(incident.id, { lifecycle: 'Resolved', nextUpdateAt: null });
    await owner();
    const scheduleAt = Date.now() + 10000;
    await j.json(`${endpoint}/draft/schedule`, 'POST', { publishAt: new Date(scheduleAt).toISOString(), channels: [] }, 202);
    await j.tick(scheduleAt - 1000);
    assert.equal((await j.read(incident.id)).lifecycle, 'Investigating');
    await new Promise(resolve => setTimeout(resolve, Math.max(0, scheduleAt - Date.now()) + 100));
    await j.tick(scheduleAt + 1000);
    await eventually(() => j.read(incident.id), row => row.lifecycle === 'Resolved', 'scheduled reviewed publication');
    assert.equal((await j.read(incident.id)).updates.filter(row => row.lifecycle === 'Resolved').length, 2);
    await j.tick(scheduleAt + 2000);
    assert.equal((await j.read(incident.id)).updates.filter(row => row.lifecycle === 'Resolved').length, 2);

    // Backdate a complete incident through the same HTTP door, with an active
    // incident on the component: replay must preserve the current claim.
    const live = await j.incident('Current payment investigation', [component]);
    await saveReviewed(live.id, {}); await j.publish(live.id);
    const start = '2024-06-15T13:04:05.000Z';
    const end = new Date(Date.parse(start) + 3600000).toISOString();
    const historical = await j.incident('Historical payment degradation', [component], { openedAt: start });
    const originalDetails = 'Historical investigation from the original service log.';
    const resolutionDetails = 'Historical recovery from the original service log.';
    await saveReviewed(historical.id, { lifecycle: 'Investigating', details: originalDetails });
    const original = (await j.publish(historical.id, { publishedAt: start, channels: ['email'] })).update;
    await saveReviewed(historical.id, { lifecycle: 'Resolved', details: resolutionDetails, nextUpdateAt: null });
    const historicalResolution = (await j.publish(historical.id, { publishedAt: end, channels: ['email'] })).update;
    assert.equal(original.publishedAt, start);
    assert.equal(historicalResolution.publishedAt, end);
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Major outage');
    const month = start.slice(0, 7);
    const availability = await j.json(`/api/app/availability-report?component=${component.id}&month=${month}&format=json`);
    assert.ok(availability.incidents.some(row => row.id === historical.id));
    assert.ok(Number(availability.downtimeMinutes) > 0);
    await j.visible(`/history/${start.slice(0, 7)}`, historical.title);
    for (const path of [`/incidents/${historical.reference}`, `/history/${start.slice(0, 7)}`]) {
      const html = await j.visible(path, resolutionDetails);
      for (const [details, lifecycle, instant, display] of [
        [originalDetails, 'Investigating', start, 'Jun 15, 2024, 23:04 UTC+10:00'],
        [resolutionDetails, 'Resolved', end, 'Jun 16, 2024, 00:04 UTC+10:00'],
      ]) {
        const update = publicUpdate(html, details);
        const heading = update.childNodes.find(node => node.tagName === 'div' && node.attrs.some(attr => attr.name === 'class' && attr.value === 'update-head'));
        assert.equal(nodeText(heading.childNodes.find(node => node.tagName === 'strong')), lifecycle, `${path}: the original publication belongs to its lifecycle`);
        const times = descendants(heading).filter(node => node.tagName === 'time');
        assert.equal(times.length, 1, `${path}: one publication time belongs to this update`);
        assert.equal(times[0].attrs.find(attr => attr.name === 'datetime')?.value, instant, `${path}: the original publication instant`);
        assert.equal(nodeText(times[0]), display, `${path}: the original time in the configured zone`);
      }
    }
    const history = (await j.json(`/api/app/components/${component.id}/history`)).history;
    for (const [instant, state] of [[start, 'Major outage'], [end, 'Operational']]) {
      assert.ok(history.some(row => row.causeId === historical.id && row.changedAt === instant && row.newState === state), 'the original claim transition enters component history');
    }
    await saveReviewed(historical.id, { lifecycle: 'Monitoring', details: 'Current correction of the historical record.' });
    await j.publish(historical.id, { channels: ['email'] });
    await j.tick(Date.now());
    const historicalReach = await j.json(`/api/app/incidents/${historical.id}/reach`);
    assert.equal(historicalReach.updates.length, 3);
    assert.ok(historicalReach.updates.every(update => update.channels.every(channel => channel.committed === 0)), 'historical and later current-time updates create no subscriber delivery');
    assert.ok(!j.messages.some(mail => mail.text.includes(historical.title)), 'no historical incident notification reaches the provider');
    // The report month follows the page's fixed Brisbane offset.
    const performanceMonth = new Date(Date.now() + 10 * 3600_000).toISOString().slice(0, 7);
    const performance = await j.json(`/api/app/communication-performance?month=${performanceMonth}`);
    assert.ok(performance.incidents.some(row => row.incidentId === incident.id));
    assert.ok(performance.summary.commitments.evaluated > 0);
    const performanceCsv = await j.request(`/api/app/communication-performance?month=${performanceMonth}&format=csv`);
    assert.equal(performanceCsv.status, 200); assert.ok((await performanceCsv.text()).includes(incident.reference));
    for (const format of ['csv', 'pdf']) {
      const response = await j.request(`/api/app/availability-report?component=${component.id}&month=${month}&format=${format}`);
      assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength);
    }
    const reach = await j.json(`/api/app/incidents/${incident.id}/reach`);
    assert.ok(reach.incident);
    await j.json(endpoint, 'DELETE', {}, 400);
    await j.json(endpoint, 'DELETE', { reason: 'Duplicate incident replaced after review' });
    await j.json(endpoint, 'GET', undefined, 404);
    await eventually(() => j.publicText('/history'), body => !body.includes(incident.title), 'audited incident removed from public history');
    const audit = await j.json('/api/app/audit-log?limit=100');
    assert.ok(audit.entries.some(row => row.entityId === incident.id && row.reason === 'Duplicate incident replaced after review'));
  } finally { await j.close(); }
});

test('MAINT-001 MAINT-002 MAINT-003 MAINT-004 MAINT-005 MAINT-006 MAINT-007 MAINT-009 MAINT-013 — owner schedules, announces, starts, extends and completes maintenance without losing window or calendar history', async () => {
  const j = await openStatusJourney();
  try {
    const component = await j.component('Scheduled database service');
    await assertEmptyCalendar(j);
    const now = Date.now();
    const startsAt = new Date(now + 3600000).toISOString();
    const endsAt = new Date(now + 7200000).toISOString();
    const input = { title: 'Database capacity upgrade ;,\\\n' + 'é'.repeat(70), affectedAudience: 'Customers using the database', customerImpact: 'Writes may pause during the upgrade.', startsAt, endsAt, componentIds: [component.id], autoStart: true, autoComplete: false };
    const maintenance = (await j.json('/api/app/maintenance', 'POST', input, 201)).maintenance;
    const endpoint = `/api/app/maintenance/${maintenance.id}`;
    assert.ok(maintenance.reference);
    const uid = `lamp-maintenance-${maintenance.id}@lamp`;
    const readCalendar = async () => {
      const response = await j.publicResponse('/maintenance.ics');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/calendar/);
      const body = await response.text(), events = validateMaintenanceCalendar(body);
      return { body, events, event: events.find(event => event.getFirstPropertyValue('uid') === uid) };
    };
    let calendar = await eventually(readCalendar, value => Boolean(value.event), 'scheduled calendar event');
    assert.equal(calendar.event.getFirstPropertyValue('summary'), input.title);
    assert.equal(calendar.event.getFirstPropertyValue('status'), 'CONFIRMED');
    assert.equal(calendar.event.getFirstPropertyValue('sequence'), 0);
    assert.equal(calendar.event.getFirstPropertyValue('dtstart').toJSDate().getTime(), Math.floor(Date.parse(startsAt) / 1000) * 1000);
    assert.ok(!(await j.json('/api/app/incidents')).incidents.some(row => row.id === maintenance.id));
    await j.visible(`/maintenance/${maintenance.reference}`, input.customerImpact);
    await j.tick(now + 1000); await j.tick(now + 1000);
    const list = async () => (await j.json('/api/app/maintenance')).maintenance.find(row => row.id === maintenance.id);
    assert.equal((await list()).notices.filter(row => row.kind === 'reminder').length, 1);
    const actualStart = new Date(now - 7200000).toISOString();
    const elapsedEnd = new Date(Date.now() - 15 * 60000 + 30000).toISOString();
    await j.json(`${endpoint}/window`, 'PUT', { startsAt: actualStart, endsAt: elapsedEnd });
    await j.tick(Date.now());
    assert.equal((await list()).state, 'In progress');
    assert.equal((await list()).overrunning, false, 'an unfinished window has no overrun label before fifteen minutes');
    calendar = await eventually(readCalendar, value => value.event?.getFirstPropertyValue('sequence') === 1, 'rescheduled calendar event');
    assert.equal(calendar.event.getFirstPropertyValue('uid'), uid);
    assert.equal(calendar.event.getFirstPropertyValue('dtstart').toJSDate().getTime(), Math.floor(Date.parse(actualStart) / 1000) * 1000);
    assert.equal(calendar.event.getFirstPropertyValue('dtend').toJSDate().getTime(), Math.floor(Date.parse(elapsedEnd) / 1000) * 1000);
    // Public HTML localizes the human date; its semantic time attributes
    // carry the exact owner-selected window for browsers and calendar readers.
    const publicWindow = ends => eventually(() => j.publicText(`/maintenance/${maintenance.reference}`), html => html.includes(`data-maintenance-ends-at="${ends}"`) && html.includes(`<time datetime="${actualStart}"`), 'public maintenance window');
    const beforeOverrun = await publicWindow(elapsedEnd);
    assert.ok(!beforeOverrun.includes('Running longer than planned'));
    const initialPage = await j.publicResponse('/');
    const oldValidator = initialPage.headers.get('etag');
    assert.ok(Date.parse(initialPage.headers.get('x-lamp-snapshot-generated-at')) < Date.parse(elapsedEnd) + 15 * 60000);
    assert.ok(!(await initialPage.text()).includes('Running longer than planned'));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(elapsedEnd) + 15 * 60000 - Date.now()) + 100));
    const aged = await j.raw(j.publicOrigin + '/', { headers: { 'If-None-Match': oldValidator } });
    assert.equal(aged.status, 200);
    assert.notEqual(aged.headers.get('etag'), oldValidator);
    for (const html of [await aged.text(), await j.publicText(`/maintenance/${maintenance.reference}`)]) {
      assert.ok(html.includes('Running longer than planned'));
      assert.ok(html.includes(`data-maintenance-ends-at="${elapsedEnd}"`), 'the overrun keeps its original end beside the warning');
    }
    assert.equal((await list()).overrunning, true);
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Under maintenance');
    await j.tick(now + 3 * 3600000);
    assert.equal((await list()).state, 'In progress', 'an unchecked automatic completion never ends the window');
    const later = new Date(now + 4 * 3600000).toISOString();
    await j.json(`${endpoint}/window`, 'PUT', { startsAt: actualStart, endsAt: later });
    assert.equal((await list()).startsAt, actualStart);
    assert.equal((await list()).endsAt, later);
    assert.equal((await list()).overrunning, false);
    assert.ok(!(await publicWindow(later)).includes('Running longer than planned'));
    const extendedPage = await eventually(() => j.publicText('/'), html => html.includes(`data-maintenance-ends-at="${later}"`), 'extended public window');
    assert.ok(!extendedPage.includes('Running longer than planned'));
    calendar = await eventually(readCalendar, value => value.event?.getFirstPropertyValue('sequence') === 2, 'extended calendar event');
    assert.equal(calendar.event.getFirstPropertyValue('uid'), uid);
    await j.json(`${endpoint}/complete`, 'POST', {});
    await j.json(`${endpoint}/complete`, 'POST', {}, 409);
    const completed = await eventually(list, row => row.state === 'Completed', 'manual completion');
    assert.ok(completed.notices.some(row => row.kind === 'started'));
    assert.equal(completed.notices.filter(row => row.kind === 'completed').length, 1);
    assert.ok(!(await j.visible(`/maintenance/${maintenance.reference}`, 'Completed')).includes('Running longer than planned'));
    await eventually(readCalendar, value => !value.event, 'completed window leaves the calendar');
    assert.ok(completed.notices.some(row => row.kind === 'rescheduled'));
    assert.equal((await j.json('/api/app/components')).components.find(row => row.id === component.id).publicState, 'Operational');
    const feed = await j.visible('/feed.atom', input.customerImpact);
    assert.ok(feed.includes(maintenance.reference));
    const cancelled = (await j.json('/api/app/maintenance', 'POST', { ...input, title: 'Cancelled upgrade' }, 201)).maintenance;
    await j.json(`/api/app/maintenance/${cancelled.id}/window`, 'PUT', { startsAt: new Date(now + 5 * 3600000).toISOString(), endsAt: new Date(now + 6 * 3600000).toISOString() });
    await j.json(`/api/app/maintenance/${cancelled.id}/cancel`, 'POST', {});
    assert.equal((await j.json('/api/app/maintenance')).maintenance.find(row => row.id === cancelled.id).state, 'Cancelled');
    await eventually(readCalendar, value => value.events.some(event => event.getFirstPropertyValue('uid') === `lamp-maintenance-${cancelled.id}@lamp` && event.getFirstPropertyValue('status') === 'CANCELLED'), 'cancelled calendar event');
    const internal = await j.component('Internal database topology', { internal: true });
    const hidden = (await j.json('/api/app/maintenance', 'POST', { ...input, title: 'Internal-only upgrade', componentIds: [internal.id] }, 201)).maintenance;
    const barrier = (await j.json('/api/app/maintenance', 'POST', { ...input, title: 'Public calendar generation barrier', componentIds: [component.id, internal.id] }, 201)).maintenance;
    calendar = await eventually(readCalendar, value => value.body.includes(barrier.id), 'later public calendar generation');
    for (const privateValue of [hidden.id, hidden.title, internal.id, internal.name]) assert.ok(!calendar.body.includes(privateValue), 'a later calendar generation excludes internal-only windows and component details');
    // A second window keeps automatic completion on and proves both scheduled
    // transitions, rather than treating manual completion as a Cron result.
    const automatic = (await j.json('/api/app/maintenance', 'POST', { ...input, title: 'Automatic maintenance', startsAt: new Date(now - 7200000).toISOString(), endsAt: new Date(now - 3600000).toISOString(), autoComplete: true }, 201)).maintenance;
    await j.tick(Date.now()); await j.tick(Date.now());
    assert.equal((await j.json('/api/app/maintenance')).maintenance.find(row => row.id === automatic.id).state, 'Completed');
  } finally { await j.close(); }
});

test('INCIDENT-012 — linked operators run a whole private incident draft, preview and explicit publication through signed Slack and Teams', chatDeskNativeFlow);
