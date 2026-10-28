import { createSubscriberRepository } from '../subscribers/repository';
import { createSubscriberIntakeRepository } from '../subscribers/intake.repository';
import { createDeliveryRepository } from '../deliveries/repository';
import { hashOpaqueToken } from '../../platform/security/opaque-tokens';

/** Native reads used to bind summaries and revisions. No credential material is
 * selected for a door result or a witness. */
export function createCommunicationRepository(db: D1Database) {
  const subscribers = createSubscriberRepository(db);
  const intake = createSubscriberIntakeRepository(db);
  const deliveries = createDeliveryRepository(db);
  return {
    subscribers,
    deliveries,
    async activeOperator(id: string) {
      return Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(id).first());
    },
    async confirmationAllowed(recipient: string, channel: string) {
      const key=await hashOpaqueToken(channel==='sms'?`sms-confirmation:${recipient}`:`confirmation-address:${recipient.trim().toLowerCase()}`);
      const row=await db.prepare('SELECT last_sent_at AS lastSentAt FROM subscriber_confirmation_attempts WHERE email_hash=?').bind(key).first<{lastSentAt:string}>();
      return !row || Date.parse(row.lastSentAt)<Date.now()-24*60*60_000;
    },
    async invitationPlan(batchId: string) {
      if (!await intake.batchExists(batchId)) return null;
      const ids = await intake.pending(batchId);
      const rows = (await Promise.all(ids.map(id => subscribers.findSubscriber(id)))).filter(row => row !== null);
      const recipients: string[] = [], subscriberIds: string[] = [], allowances: Array<{id:string; lastSentAt:string|null}> = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const recipient = row.channel === 'email' || row.channel === 'sms' ? row.destination : row.contactEmail;
        if (!recipient) continue;
        const key = await hashOpaqueToken(row.channel === 'sms' ? `sms-confirmation:${recipient}` : `confirmation-address:${recipient.trim().toLowerCase()}`);
        const allowance = await db.prepare('SELECT last_sent_at AS lastSentAt FROM subscriber_confirmation_attempts WHERE email_hash=?').bind(key).first<{lastSentAt:string}>();
        allowances.push({id:row.id,lastSentAt:allowance?.lastSentAt??null});
        if (seen.has(key) || (allowance && Date.parse(allowance.lastSentAt) >= Date.now()-24*60*60_000)) continue;
        seen.add(key); recipients.push(recipient); subscriberIds.push(row.id);
      }
      const snapshot = rows.map(row => ({id: row.id, channel: row.channel, recipient: row.channel === 'email' || row.channel === 'sms' ? row.destination : row.contactEmail, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt}));
      return { batchId, recipients, subscriberIds, revision: await hashOpaqueToken(JSON.stringify({snapshot,allowances,subscriberIds})) };
    },
    async retryRecipients(followUpId: string) {
      if (!followUpId.startsWith('notification-dispatch:')) return [];
      const id = followUpId.slice('notification-dispatch:'.length);
      return (await db.prepare(`SELECT d.id,s.channel,s.destination
        FROM notification_outbox o JOIN notification_delivery_records d ON d.notification_event_id=o.aggregate_id
        JOIN subscriber_directory s ON s.id=d.subscriber_id
        WHERE o.id=? AND o.completed_at IS NULL AND d.outcome='queued' AND s.state='active'
          AND NOT EXISTS(SELECT 1 FROM notification_attempt_records a WHERE a.delivery_id=d.id AND (a.provider_message_id IS NOT NULL OR a.local_capture_id IS NOT NULL))
        ORDER BY d.id`).bind(id).all<{id:string;channel:string;destination:string}>()).results.map(row=>{if(row.channel!=='webhook')return row.destination;try{return new URL(row.destination).origin;}catch{return '[webhook destination]';}});
    },
  };
}
