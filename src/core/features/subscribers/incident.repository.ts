import { publicIncidentSubscriptionSql } from "./incident-visibility";
import { createUlid } from "../../shared/ids";
import { hashOpaqueToken } from "../../platform/security/opaque-tokens";
import { SubscriberLimitError } from "./limits";

export interface IncidentSubscription {
  id: string;
  reference: string;
  title: string;
  includeReport: boolean;
  endedAt: string | null;
}

export class IncidentSubscriptionUnavailableError extends Error {
  constructor() { super("This incident is unavailable."); }
}

/** Incident identity and lifetime belong to a subscription, not to an address.
 * Native subscriber rows retain all existing token, custody and erasure paths. */
export function createIncidentSubscriptionRepository(db: D1Database) {
  const publicIncident = publicIncidentSubscriptionSql("i");
  async function key(incidentId: string, channel: string, destination: string) {
    return `incident:${incidentId}:${channel}:${await hashOpaqueToken(destination)}`;
  }
  return {
    key,
    async available(incidentId: string) {
      return db.prepare(`SELECT i.id,i.reference,i.title FROM incidents i WHERE i.id=? AND ${publicIncident}`).bind(incidentId).first<{id:string;reference:string;title:string}>();
    },
    async get(subscriberId: string): Promise<IncidentSubscription | null> {
      const row = await db.prepare(`SELECT i.id,i.reference,i.title,f.include_report AS includeReport,f.ended_at AS endedAt
        FROM incident_subscriptions f JOIN incidents i ON i.id=f.incident_id WHERE f.subscriber_id=?`)
        .bind(subscriberId).first<{id:string;reference:string;title:string;includeReport:number;endedAt:string|null}>();
      return row ? {...row,includeReport:Boolean(row.includeReport)} : null;
    },
    async awaitsImportInvitation(subscriberId: string) {
      // Pending imported subscribers use the owner's explicit invitation door,
      // including after an invitation was sent. A public repeat neither bypasses
      // that action nor creates an extra confirmation during its 72-hour window.
      return Boolean(await db.prepare(`SELECT 1 FROM ik_provenance
        WHERE destination='lamp' AND target_kind='subscriber' AND target_id=? AND reversed=0 LIMIT 1`)
        .bind(subscriberId).first());
    },
    async find(incidentId: string, channel: string, destination: string) {
      return db.prepare("SELECT id,state FROM subscribers WHERE destination=?")
        .bind(await key(incidentId,channel,destination)).first<{id:string;state:"pending"|"active"|"deactivated"}>();
    },
    async listIds(incidentId: string, limit: number, offset: number) {
      return (await db.prepare(`SELECT f.subscriber_id AS id FROM incident_subscriptions f JOIN subscribers s ON s.id=f.subscriber_id
        WHERE f.incident_id=? ORDER BY s.created_at,s.id LIMIT ? OFFSET ?`).bind(incidentId,limit,offset).all<{id:string}>()).results.map(row=>row.id);
    },
    async create(input: {id:string;incidentId:string;destination:string;channel:"email"|"webhook"|"sms";contactEmail?:string|null;requiresConfirmation:boolean;tokenHash:string;now:string}) {
      const destinationKey=await key(input.incidentId,input.channel,input.destination);
      const state=input.requiresConfirmation?"pending":"active";
      try {
        await db.batch([
          db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM incidents i WHERE i.id=? AND ${publicIncident}) THEN 1 ELSE json('Incident subscription unavailable.') END`).bind(input.incidentId),
          db.prepare(`INSERT INTO subscribers(id,channel,sms_kind,destination,contact_email,state,selection_mode,token_hash,event_kinds_json,preferences_set,created_at,updated_at)
            VALUES(?,?,?,?,?,?,'all',?,'["incidents"]',1,?,?)
            ON CONFLICT(destination) DO UPDATE SET state=excluded.state,contact_email=excluded.contact_email,
            deactivation_reason=NULL,deactivated_at=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at
            WHERE subscribers.state='deactivated'`)
            .bind(input.id,input.channel==="email"?"email":"webhook",Number(input.channel==="sms"),destinationKey,input.contactEmail??null,state,input.tokenHash,input.now,input.now),
          db.prepare(`INSERT INTO incident_subscriptions(subscriber_id,incident_id,destination,include_report,created_at)
            SELECT s.id,?,?,settings.include_report,? FROM subscribers s JOIN incident_follow_settings settings ON settings.id=1
            WHERE s.destination=? AND s.created_at=?
            ON CONFLICT(subscriber_id) DO UPDATE SET destination=excluded.destination,include_report=excluded.include_report,
            resolution_at=NULL,resolution_delivered_at=NULL,ended_at=NULL,final_event_id=NULL,created_at=excluded.created_at`)
            .bind(input.incidentId,input.destination,input.now,destinationKey,input.now),
          ...(input.channel==="sms" ? [db.prepare("INSERT OR IGNORE INTO sms_subscriptions(subscriber_id) SELECT id FROM subscribers WHERE destination=?").bind(destinationKey)] : []),
          db.prepare(`INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at)
            SELECT ?,'subscriber',s.id,'incident-follow-requested',NULL,json_object('incidentId',?),?,?
            FROM subscribers s WHERE s.id=? AND s.created_at=?`)
            .bind(createUlid(),input.incidentId,input.now,input.now,input.id,input.now),
        ]);
      } catch(cause) {
        if(cause instanceof Error && cause.message.includes("over the subscriber limit"))throw new SubscriberLimitError();
        if(cause instanceof Error && cause.message.includes("malformed JSON"))throw new IncidentSubscriptionUnavailableError();
        throw cause;
      }
      const result=await this.find(input.incidentId,input.channel,input.destination);
      if(!result)throw new Error("Incident subscriber was not stored.");
      return result;
    },
  };
}
