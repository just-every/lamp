// The one sample every plate draws: one business on status.example.com (RFC 2606), in Europe/London. No page or
// business name is drawn. Where the product exports a pure formatter, the strings below are made by it, so they are the
// product's by construction; strings private to a product module are literals here, copied from that module's source.
// No test checks them against the product (DIVERGENCE.md, Test prune — 10 October 2026).
import { renderIncidentUpdate } from '../../../core/features/incidents/renderer';
import { renderedUpdate, updateSummary, updateText } from '../../../core/features/public-snapshot/feed-widget';
import { dateLabel, formatTime } from '../../../core/features/public-snapshot/format';
import { defaultPublicSnapshotPolicies } from '../../../core/features/public-snapshot/policies';
import type { PublicSnapshotSource } from '../../../core/features/public-snapshot/repository';
import { computeUptime } from '../../../core/features/public-snapshot/uptime';

export const HOST = 'status.example.com';
export const OWNER_SITE = 'www.example.com';
export const MAIL_FROM = 'status@example.com';
export const TIMEZONE = 'Europe/London';
export const GENERATED_AT = '2026-10-09T12:12:04.512Z';
export const time = (instant: string) => formatTime(instant, TIMEZONE);

// Component display orders run 1 to 4 across the groups, so the public page (group, then component) and the Manage
// subscription page (component display order alone) list them in the same order.
export const COMPONENTS = [
  { id: '01KT1A0D2M8Q4V6T9XRB3N5HC1', name: 'Website', groupName: 'Storefront', groupOrder: 1, displayOrder: 1, state: 'Operational', note: '' },
  { id: '01KT1A0F80Q1V7T3X9RB5N2HD6', name: 'Checkout', groupName: 'Storefront', groupOrder: 1, displayOrder: 2, state: 'Partially unavailable', note: 'Card payments only.' },
  { id: '01KT1A0H4R2W8Y5V1ZTC7P3JE8', name: 'Sign-in', groupName: 'Accounts', groupOrder: 2, displayOrder: 3, state: 'Operational', note: '' },
  { id: '01KT1A0K6T4Y1A7X3BVD9R5KF2', name: 'Email receipts', groupName: 'Accounts', groupOrder: 2, displayOrder: 4, state: 'Operational', note: '' },
] as const;
export const CHECKOUT = COMPONENTS[1];
export const OVERALL = 'Partially unavailable';
export const groups = ['Storefront', 'Accounts'].map((name) => ({ name, components: COMPONENTS.filter((component) => component.groupName === name) }));

type Update = { id: string; lifecycle: string; affectedAudience: string; customerImpact: string; whatStillWorks: string; details: string; nextUpdateAt: string | null; publishedAt: string };
type Incident = { id: string; reference: string; title: string; lifecycle: string; openedAt: string; resolvedAt: string | null; updates: Update[] };

/** INC-14, the current incident. Updates are oldest first, as the webhook carries them. */
export const INC14: Incident = {
  id: '01M4G8DZA0K3T7QW9XRB5NHD2V', reference: 'INC-14', title: 'Card payments failing', lifecycle: 'Identified',
  openedAt: '2026-10-09T11:58:00.214Z', resolvedAt: null,
  updates: [
    { id: '01M4G8DZGPR2V6Q9TX3B7N4HKD', lifecycle: 'Investigating', affectedAudience: 'Customers paying by card at checkout.', customerImpact: 'Some card payments are declined.', whatStillWorks: '', details: '', nextUpdateAt: '2026-10-09T12:15:00.000Z', publishedAt: '2026-10-09T11:58:00.214Z' },
    { id: '01M4G97QX7M3T8Q2VB6N9XKH4D', lifecycle: 'Identified', affectedAudience: 'Customers paying by card at checkout.', customerImpact: 'About one in five card payments is declined.', whatStillWorks: 'Browsing, baskets and gift card payments.', details: '', nextUpdateAt: '2026-10-09T12:45:00.000Z', publishedAt: '2026-10-09T12:12:04.391Z' },
  ],
};

/** INC-11, resolved on 2 September, with its post-incident report. */
const slow = 'Customers checking out.';
export const INC11: Incident = {
  id: '01M2Q3B8N5V7X1Z4C6T9R2K8HD', reference: 'INC-11', title: 'Slow checkout pages', lifecycle: 'Resolved',
  openedAt: '2026-09-02T08:14:00.000Z', resolvedAt: '2026-09-02T08:54:00.000Z',
  updates: [
    { id: '01M2Q3B8P1K4T7W2Y5A8D3F6GJ', lifecycle: 'Investigating', affectedAudience: slow, customerImpact: 'Checkout pages are loading slowly.', whatStillWorks: '', details: '', nextUpdateAt: '2026-09-02T08:45:00.000Z', publishedAt: '2026-09-02T08:14:00.000Z' },
    { id: '01M2Q4C1R3M6V9X2Z5B8E1H4JK', lifecycle: 'Identified', affectedAudience: slow, customerImpact: 'Checkout pages take up to ten seconds to load.', whatStillWorks: 'Browsing and baskets.', details: '', nextUpdateAt: '2026-09-02T09:00:00.000Z', publishedAt: '2026-09-02T08:31:00.000Z' },
    { id: '01M2Q4X7T2N5W8Y1A4C7F2J5KM', lifecycle: 'Monitoring', affectedAudience: slow, customerImpact: 'Checkout pages are loading normally again.', whatStillWorks: '', details: '', nextUpdateAt: '2026-09-02T09:15:00.000Z', publishedAt: '2026-09-02T08:47:00.000Z' },
    { id: '01M2Q5D4V6P9X2Z5B8D1G4K7MN', lifecycle: 'Resolved', affectedAudience: slow, customerImpact: 'Checkout pages load normally.', whatStillWorks: '', details: '', nextUpdateAt: null, publishedAt: '2026-09-02T08:54:00.000Z' },
  ],
};
export const INC11_REPORT = {
  summary: 'Checkout pages loaded slowly for 40 minutes.',
  timeline: '09:14 slow pages reported; 09:31 cause found; 09:54 resolved.',
  cause: 'A database index was missing after a release.',
  remediation: 'The index is back and releases now check query plans.',
  publishedAt: '2026-09-03T10:00:00.000Z',
};

/** Checkout's recorded states: operational from before the window, INC-11's half-weight slowdown, then INC-14. */
export const CHECKOUT_HISTORY = [
  { id: '01K9V2A1B3C5D7E9F1G3H5J7K9', componentId: CHECKOUT.id, previousState: null, newState: 'Operational', causeType: 'standing-claim', causeId: null, operatorId: null, supersedesHistoryId: null, changedAt: '2026-01-05T09:00:00.000Z', createdAt: '2026-01-05T09:00:00.000Z' },
  { id: '01M2Q3B8N6W8Y2A5D7G1J4M6PR', componentId: CHECKOUT.id, previousState: 'Operational', newState: 'Degraded performance', causeType: 'incident', causeId: INC11.id, operatorId: null, supersedesHistoryId: null, changedAt: '2026-09-02T08:14:00.000Z', createdAt: '2026-09-02T08:14:00.000Z' },
  { id: '01M2Q5D4V7Q1Y3A6C9F2H5K8NP', componentId: CHECKOUT.id, previousState: 'Degraded performance', newState: 'Operational', causeType: 'incident', causeId: INC11.id, operatorId: null, supersedesHistoryId: null, changedAt: '2026-09-02T08:54:00.000Z', createdAt: '2026-09-02T08:54:00.000Z' },
  { id: '01M4G8DZB2M5R8V1X4Z7C2F5HJ', componentId: CHECKOUT.id, previousState: 'Operational', newState: 'Partially unavailable', causeType: 'incident', causeId: INC14.id, operatorId: null, supersedesHistoryId: null, changedAt: '2026-10-09T11:58:00.214Z', createdAt: '2026-10-09T11:58:00.214Z' },
] as const;

/** SCH-6, planned for 14 October. Its notices are newest first, as the page loads them. */
export const SCH6 = {
  id: '01M4F2K7C9P3T6W1Y4B7E2H5MQ', reference: 'SCH-6', title: 'Card provider upgrade', state: 'Scheduled',
  startsAt: '2026-10-14T21:00:00.000Z', endsAt: '2026-10-14T23:30:00.000Z', components: ['Checkout'],
  notices: [
    { id: '01M4NQ8D3F6J9M2P5S8V1Y4B7C', kind: 'reminder', body: 'SCH-6: Card provider upgrade', publishedAt: '2026-10-13T21:00:00.000Z' },
    { id: '01M4F2K7D1Q4V7X2Z5C8F3J6MR', kind: 'scheduled', body: 'SCH-6: Card provider upgrade', publishedAt: '2026-10-09T09:05:00.000Z' },
  ],
};

// Derived with the product's own formatters.
const newestFirst = (incident: Incident) => [...incident.updates].reverse();
const publicUpdate = (incident: Incident, update: Update) => ({
  lifecycle: update.lifecycle,
  time: time(update.publishedAt),
  fields: renderedUpdate(incident, update, TIMEZONE).public.fields.map(({ label, value }) => ({ label, value })),
});
export const current = INC14.updates[1];
export const inc14Updates = newestFirst(INC14).map((update) => publicUpdate(INC14, update));
export const inc11Updates = newestFirst(INC11).map((update) => publicUpdate(INC11, update));
export const summary = updateSummary(INC14, current);
export const generatedTime = time(GENERATED_AT);

/** The notification email: the product's renderer with the email's own time format (deliveries/service.ts). */
export const EMAIL_NEXT_UPDATE = '9 Oct 2026, 13:45 GMT+01:00';
export const email = renderIncidentUpdate({ incidentReference: INC14.reference, incidentTitle: INC14.title, lifecycle: 'Identified', affectedAudience: current.affectedAudience, customerImpact: current.customerImpact, whatStillWorks: current.whatStillWorks, details: current.details, nextUpdateAt: current.nextUpdateAt, nextUpdateDisplay: EMAIL_NEXT_UPDATE }).email;
export const emailLines = email.plainText.split('\n\n');
/** The line all three surfaces share, highlighted in section 2. */
export const SAME_WORDS = `Customer impact: ${current.customerImpact}`;

/** The site banner (renderWidget): the state, then ` · title — message`, the message in pre-line. Its real dot is
 * #d66a1f, outside this page's palette, so the plate draws it amber as the current state. */
export const widgetLines = ` · ${INC14.title} — ${updateText(INC14, current, TIMEZONE)}`.split('\n\n');
/** The Atom entry (renderAtom) for the current update. */
export const atom = { title: `${INC14.reference}: ${INC14.title}`, updated: current.publishedAt, lines: updateText(INC14, current, TIMEZONE).split('\n\n') };

/** Checkout's 90-day record, computed by the product: 91 day marks and the rounded-down percentage. */
const uptime = computeUptime({ history: CHECKOUT_HISTORY, corrections: [] } as unknown as PublicSnapshotSource, CHECKOUT.id, new Date(GENERATED_AT).getTime(), TIMEZONE, defaultPublicSnapshotPolicies);
export const uptimePercentage = uptime.percentage ?? '';
export const uptimeMarks = uptime.marks.map((mark) => (mark.downtimeMinutes === null ? 'no-data' : mark.downtimeMinutes > 0 ? 'down' : 'good'));
export const uptimeWindow = `90-day record ending ${dateLabel(GENERATED_AT, TIMEZONE)}`;
/** The stated method's first two sentences, as the page prints them (UPTIME-005); the weights of each state follow. */
export const UPTIME_METHOD_LEAD = 'Availability days use Europe/London. Uptime uses a 90-day window.';

/** The stale response's banner (public-snapshot/routes.ts labelledStaleResponse). */
export const STALE_BANNER = `Last known state — content generated at ${GENERATED_AT}; current state could not be verified.`;

/** SCH-6 on the page and in its reminder email (renderMaintenanceNotice, with the email's time format). */
export const maintenanceWindow = `${time(SCH6.startsAt)} – ${time(SCH6.endsAt)}`;
export const maintenanceNotices = SCH6.notices.map((notice) => ({ kind: notice.kind, time: time(notice.publishedAt), body: notice.body }));
export const reminder = {
  subject: `[${SCH6.reference}] Reminder: ${SCH6.title}`,
  lines: [`${SCH6.reference}: ${SCH6.title}`, `Status: ${SCH6.state}`, 'Notice: Reminder', 'Start: 14 Oct 2026, 22:00 GMT+01:00', 'End: 15 Oct 2026, 00:30 GMT+01:00', SCH6.notices[0].body],
};

/** The operator Alerts screen's configured source: its authentication and its deduplication path. */
export const ALERT_SOURCE = { name: 'Payments monitor', authentication: 'HMAC-SHA256 signed request', dedupe: ['Deduplication path', '$.alert.id'] };

/** One signed webhook delivery (sendWebhook), its body in the product's shape and key order. The two signatures are
 * HMAC-SHA256 in base64url over `{id}.{timestamp}.{body}` with the sample secrets `sample-secret-previous` and
 * `sample-secret-current`; no test recomputes them. */
export const webhook = {
  id: '01M4G97SFGM2V9Q4XR7TB3N6HD',
  timestamp: '1791547926',
  body: JSON.stringify({
    event: 'incident.update.published', deliveryId: '01M4G97SFGM2V9Q4XR7TB3N6HD',
    incident: { reference: INC14.reference, title: INC14.title },
    updates: INC14.updates.map(({ id, lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt, publishedAt }) => ({ id, lifecycle, affectedAudience, customerImpact, whatStillWorks, details, nextUpdateAt, publishedAt })),
    components: [{ id: CHECKOUT.id, name: CHECKOUT.name, previousState: 'Operational', newState: 'Partially unavailable' }],
  }),
  signatures: ['v1=xDWs0RM6me2HrKqEoS1MrAvvmfUbZFPSJHcXeZq2iFg', 'v1=dYFXSydeMn1HnaKYUqEgZ5-mYcMIRkSVs2Rn1lsEAfM'],
};
/** The body's first line as the plate prints it: its opening key, the event. */
export const webhookEvent = webhook.body.slice(0, webhook.body.indexOf(',') + 1);
/** The id and each signature as the plate prints them, the middle elided: the id's first eight and last four
 * characters, and each signature's `v1=` with its first and last four. */
export const shortId = `${webhook.id.slice(0, 8)}…${webhook.id.slice(-4)}`;
export const shortSignatures = webhook.signatures.map((signature) => `v1=${signature.slice(3, 7)}…${signature.slice(-4)}`).join(' ');

/** The operator Deliveries screen's rows: destination, channel, outcome. */
export const DELIVERIES = [
  ['ops@example.com', 'email', 'delivered'],
  ['https://hooks.example.com/status', 'webhook', 'delivered'],
  ['old@example.com', 'email', 'bounced'],
];

/** The operator Settings screen's first two public page fields, in the product's order. */
export const SETTINGS = [['Host name', HOST], ['Accent colour', '#18221b']];

/** In, live and out, in the owner's own terminal: setup (scripts/setup.mjs; the worker's name from resourceNames in
 * scripts/ops-config.mjs), deploy (scripts/deploy.mjs, on an RFC 2606 app host) and the export (OPERATIONS.md), with the
 * entity count a real local export printed (41 tables). */
export const TERMINAL = [
  { command: 'pnpm run setup', output: ['Provisioned lamp-production; migrations, setup operator, and initial page settings are initialized.'] },
  { command: 'pnpm run deploy', output: ['Deployment smoke check passed for lamp.example.com.'] },
  { command: 'pnpm run export -- --remote --environment production --out ./lamp-backup', output: ['Exported 41 database entities and 186 stored files to ./lamp-backup.'] },
  { command: 'ls ./lamp-backup', output: ['entities.json  manifest.json  objects'] },
];
