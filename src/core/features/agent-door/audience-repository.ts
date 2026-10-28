import { createSubscriberRepository } from '../subscribers/repository';
import { createFollowUpsRepository } from '../overview/follow-ups/repository';
import { createFollowUpRetryRepository } from '../overview/follow-ups/retry.repository';
import { createFollowUpsService } from '../overview/follow-ups/service';
import { createSocialRepository } from '../social/repository';
import { createDeliveryRepository } from '../deliveries/repository';
import type { SubscriberView } from '../subscribers/service';

/** The agent door uses the native directory and outboxes, never confirmation or webhook credentials. */
export function subscriberProjection(row: SubscriberView) {
  return {
    id: row.id, channel: row.channel,
    destination: row.channel === 'email' || row.channel === 'sms' ? row.destination : null,
    contactEmail: row.contactEmail, state: row.state, selectionMode: row.selectionMode,
    componentIds: row.componentSelections.map(item => item.componentId), preferences: row.preferences,
    createdAt: row.createdAt, updatedAt: row.updatedAt, addedBy: row.addedBy,
    deactivatedAt: row.deactivatedAt, deactivationReason: row.deactivationReason,
  };
}

export function createAudienceRepository(db: D1Database) {
  const subscribers = createSubscriberRepository(db), social = createSocialRepository(db);
  return {
    subscribers,
    deliveries: createDeliveryRepository(db),
    followUps: createFollowUpsService(createFollowUpsRepository(db),createFollowUpRetryRepository(db)),
    async activeOwner(id: string) {
      return Boolean(await db.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role='owner'").bind(id).first());
    },
    async deliveryOutcome(id:string) {
      return db.prepare("SELECT id,outcome,queued_at AS queuedAt,outcome_at AS outcomeAt FROM notification_delivery_records WHERE id=?").bind(id).first<{id:string;outcome:string;queuedAt:string;outcomeAt:string|null}>();
    },
    async invitationPlan(batchId: string) {
      if(!await subscribers.intake.batchExists(batchId)) return null;
      const ids=await subscribers.intake.pending(batchId);
      const rows=await Promise.all(ids.map(id=>subscribers.findSubscriber(id)));
      return rows.flatMap(row=>row ? [{id:row.id,channel:row.channel,recipient:row.channel==='email'||row.channel==='sms'?row.destination:row.contactEmail,state:row.state,createdAt:row.createdAt,updatedAt:row.updatedAt}] : []);
    },
    async retryRecipients(id: string) {
      if(!id.startsWith('notification-dispatch:'))return [];
      return (await db.prepare(`SELECT d.id,s.id AS subscriberId,s.channel,s.destination,s.contact_email AS contactEmail
        FROM notification_outbox n JOIN notification_delivery_records d ON d.notification_event_id=n.aggregate_id
        JOIN subscriber_directory s ON s.id=d.subscriber_id
        WHERE n.id=? AND n.kind='delivery-dispatch' AND n.completed_at IS NULL
          AND d.outcome='queued' AND s.state='active'
          AND NOT EXISTS(SELECT 1 FROM notification_attempt_records a WHERE a.delivery_id=d.id AND (a.provider_message_id IS NOT NULL OR a.local_capture_id IS NOT NULL))
        ORDER BY d.id`).bind(id.slice('notification-dispatch:'.length)).all<{id:string;subscriberId:string;channel:string;destination:string;contactEmail:string|null}>()).results.map(row=>({id:row.id,channel:row.channel,recipient:row.channel==='email'||row.channel==='sms'?row.destination:`${row.channel}:${row.subscriberId}`}));
    },
    socialCustody: social.post,
    async socialPost(id:string) {
      const row=await social.post(id);
      if(!row)return null;
      const account=await social.account(row.accountId);
      if(!account)return null;
      const delivery=await db.prepare("SELECT state,attempts FROM integration_deliveries WHERE namespace='lamp-social' AND id=?").bind(id).first<{state:string;attempts:number}>();
      return {id:row.id,incidentId:row.incidentId,maintenanceId:row.maintenanceId,eventId:row.eventId,accountId:row.accountId,accountName:account.name,network:account.network,host:account.host,reference:row.reference,lifecycle:row.lifecycle,customerImpact:row.customerImpact,prefix:row.prefix,queuedAt:row.queuedAt,text:row.text,bodyFrozen:row.body!==null,postId:row.postId,state:delivery?.state??'queued',attempts:delivery?.attempts??0};
    },
  };
}
