import { drizzle } from 'drizzle-orm/d1';
import { componentGroups, components, componentStandingClaims, componentClaimEvents, incidents, incidentComponents, incidentUpdates, maintenance, maintenanceComponents, pageSettings, subscribers } from '../../shared/schema';

// Fixed product IDs, real product tables, and conflict-safe inserts make retrying
// a partially completed demo seed harmless. Owner identity remains Base's.
const id = (suffix: string) => '01KDM'.padEnd(21, '0') + suffix.padStart(5, '0');
// readiness: the evidence keys a configured workspace's own setup checks recorded
// (sender check, public page opened, subscribe form checked, address accepted).
export async function seedDemoRecords(binding: D1Database, input: { ownerEmail: string; now: Date; pageHost: string; from: string; readiness?: { sender: string; publicOrigin: string } }) {
  const owner = await binding.prepare("SELECT id FROM oa_operators WHERE email=? AND role='owner' AND status='active'").bind(input.ownerEmail).first<{ id: string }>();
  if (!owner) throw new Error('Demo data requires the existing active owner.');
  const db = drizzle(binding), at = input.now.toISOString();
  const time = (minutes: number) => new Date(input.now.getTime() + minutes * 60000).toISOString();
  const stamp = { createdAt: at, updatedAt: at };
  await db.insert(pageSettings).values({ id: 'default', pageName: 'Northstar Status', tagline: 'Current availability of Northstar services', accentColor: '#2563eb', timezone: 'UTC', hostname: input.pageHost, mailFromAddress: input.from, feedId: 'urn:lamp:demo:northstar', ...stamp }).onConflictDoNothing();
  await db.insert(componentGroups).values([{ id: id('1'), name: 'Platform', displayOrder: 0, ...stamp }, { id: id('2'), name: 'Customer experience', displayOrder: 1, ...stamp }]).onConflictDoNothing();
  const services = [
    { id: id('11'), groupId: id('1'), name: 'API', description: 'Requests, authentication and integrations', displayOrder: 0 },
    { id: id('12'), groupId: id('1'), name: 'Background jobs', description: 'Imports, exports and scheduled processing', displayOrder: 1 },
    { id: id('13'), groupId: id('2'), name: 'Dashboard', description: 'The Northstar web application', displayOrder: 0 },
    { id: id('14'), groupId: id('2'), name: 'File delivery', description: 'Uploads and downloadable files', displayOrder: 1 },
  ];
  await db.insert(components).values(services.map(service => ({ ...service, ...stamp }))).onConflictDoNothing();
  await db.insert(componentStandingClaims).values(services.map((service, index) => ({ id: id(String(21 + index)), componentId: service.id, state: 'Operational' as const, operatorId: owner.id, ...stamp }))).onConflictDoNothing();
  await db.insert(componentClaimEvents).values(services.map((service, index) => ({ id: id(String(31 + index)), componentId: service.id, causeType: 'standing-claim' as const, causeId: id(String(21 + index)), state: 'Operational' as const, changedAt: time(-14 * 1440), ...stamp }))).onConflictDoNothing();
  await db.insert(incidents).values([
    { id: id('101'), reference: 'INC-1', title: 'Delayed background processing', lifecycle: 'Identified', openedAt: time(-50), createdByOperatorId: owner.id, ...stamp },
    { id: id('102'), reference: 'INC-2', title: 'Dashboard sign-in errors', lifecycle: 'Resolved', openedAt: time(-2880), resolvedAt: time(-2820), createdByOperatorId: owner.id, ...stamp },
  ]).onConflictDoNothing();
  await db.insert(incidentComponents).values([
    { id: id('111'), incidentId: id('101'), componentId: id('12'), componentName: 'Background jobs', state: 'Degraded performance', publishedAt: time(-50), ...stamp },
    { id: id('112'), incidentId: id('102'), componentId: id('13'), componentName: 'Dashboard', state: 'Partially unavailable', publishedAt: time(-2880), ...stamp },
  ]).onConflictDoNothing();
  await db.insert(incidentUpdates).values([
    { id: id('121'), incidentId: id('101'), lifecycle: 'Investigating', affectedAudience: 'Customers running imports and exports', customerImpact: 'Background jobs are taking longer than usual to finish.', whatStillWorks: 'The API and dashboard remain available.', details: 'We are investigating a queue backlog. Your queued work is retained.', publishedAt: time(-50), nextUpdateAt: time(-20), authorOperatorId: owner.id, ...stamp },
    { id: id('122'), incidentId: id('101'), lifecycle: 'Identified', affectedAudience: 'Customers running imports and exports', customerImpact: 'Some background jobs are delayed by up to ten minutes.', whatStillWorks: 'Interactive requests, uploads and existing files are unaffected.', details: 'We identified a slow worker pool and are draining the backlog with additional capacity.', publishedAt: time(-15), nextUpdateAt: time(30), authorOperatorId: owner.id, ...stamp },
    { id: id('123'), incidentId: id('102'), lifecycle: 'Resolved', affectedAudience: 'Customers signing in to the dashboard', customerImpact: 'Dashboard sign-in is working normally again.', whatStillWorks: 'Existing sessions and API requests were unaffected throughout.', details: 'We rolled back a configuration change and confirmed recovery.', publishedAt: time(-2820), authorOperatorId: owner.id, ...stamp },
  ]).onConflictDoNothing();
  await db.insert(maintenance).values({ id: id('201'), reference: 'SCH-1', title: 'File delivery infrastructure upgrade', state: 'Scheduled', startsAt: time(1440), endsAt: time(1500), createdByOperatorId: owner.id, ...stamp }).onConflictDoNothing();
  await db.insert(maintenanceComponents).values({ id: id('211'), maintenanceId: id('201'), componentId: id('14'), componentName: 'File delivery', ...stamp }).onConflictDoNothing();
  await db.insert(subscribers).values([
    { id: id('301'), channel: 'email', destination: 'alex@example.invalid', state: 'active', tokenHash: 'demo-email-unusable-token-hash', ...stamp },
    { id: id('302'), channel: 'webhook', destination: 'https://hooks.example.invalid/lamp', contactEmail: 'ops@example.invalid', state: 'active', tokenHash: 'demo-webhook-unusable-token-hash', ...stamp },
  ]).onConflictDoNothing();
  await binding.batch([
    binding.prepare("INSERT INTO maintenance_notices(id,maintenance_id,kind,body,published_at,author_operator_id,created_at,updated_at) VALUES(?,?,'scheduled',?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id('221'), id('201'), 'File downloads may pause briefly while we upgrade storage. Existing files are retained.', at, owner.id, at, at),
    ...[['first-run', 'complete'], ...(input.readiness ? [['sender', input.readiness.sender], ...['public', 'subscribe', 'domain'].map(step => [step, input.readiness!.publicOrigin])] : [])]
      .map(([step, key]) => binding.prepare('INSERT INTO setup_readiness(step,evidence_key,checked_at) VALUES(?,?,?) ON CONFLICT(step) DO NOTHING').bind(step, key, at)),
    // The notifications those published updates and the notice already sent: email
    // accepted by the provider, webhook delivered. No outbox row, so nothing dispatches.
    ...([[id('121'), 'incident-update', time(-50)], [id('122'), 'incident-update', time(-15)], [id('123'), 'incident-update', time(-2820)], [id('221'), 'maintenance-notice', at]] as const).flatMap(([event, type, sentAt], index) => {
      const email = id(String(401 + index * 2)), webhook = id(String(402 + index * 2));
      const update = type === 'incident-update' ? event : null, maintenanceId = type === 'maintenance-notice' ? id('201') : null;
      const delivery = (deliveryId: string, subscriberId: string, channel: string, outcome: string) => binding.prepare("INSERT INTO notification_deliveries(id,subscriber_id,incident_update_id,maintenance_id,channel,outcome,queued_at,outcome_at,created_at,updated_at,notification_event_id,notification_event_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING")
        .bind(deliveryId, subscriberId, update, maintenanceId, channel, outcome, sentAt, outcome === 'delivered' ? sentAt : null, sentAt, sentAt, event, type);
      return [delivery(email, id('301'), 'email', 'queued'), delivery(webhook, id('302'), 'webhook', 'delivered'),
        binding.prepare('INSERT INTO notification_delivery_attempts(id,delivery_id,attempt_number,attempted_at,provider_message_id,error,created_at) VALUES(?,?,1,?,?,NULL,?) ON CONFLICT DO NOTHING').bind(id(String(501 + index)), email, sentAt, `demo-${email}`, sentAt)];
    }),
    ...[['INC', 'INC-1'], ['INC', 'INC-2'], ['SCH', 'SCH-1']].map(([namespace, reference]) => binding.prepare('INSERT INTO reference_allocations(namespace,reference) VALUES(?,?) ON CONFLICT DO NOTHING').bind(namespace, reference)),
  ]);
}
