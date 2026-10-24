import { createUlid } from "../../shared/ids";

export interface ChatSubscriptionInput {
  id: string; kind: "slack" | "teams"; name: string; sealedUrl: string; host: string; destination: string;
  componentIds: string[]; state: "pending" | "active"; teamId?: string; channelId?: string; now: string;
  eventKinds?: string[]; minimumImpact?: "Partially unavailable" | null;
}

/** Subscriber-owned chat destinations retain the same encrypted address and
 * immutable delivery outbox as owner-managed channels. */
export function createChatSubscriptionRepository(db: D1Database) {
  return {
    async findDestination(destination: string) {
      return db.prepare("SELECT id, state FROM subscriber_directory AS subscribers WHERE destination = ?").bind(destination).first<{ id: string; state: "pending" | "active" | "deactivated" }>();
    },
    async create(input: ChatSubscriptionInput) {
      const selection = input.componentIds.length ? "selected" : "all", nonce=createUlid();
      await db.batch([
        db.prepare(`INSERT INTO subscribers (id,channel,chat_kind,destination,state,selection_mode,token_hash,created_at,updated_at,event_kinds_json,minimum_impact,preferences_set)
          VALUES (?,'webhook',?,?,?,?,?,?,?,?,?,1) ON CONFLICT(destination) DO UPDATE SET state = excluded.state,
          deactivation_reason = NULL, deactivated_at = NULL, selection_mode = excluded.selection_mode,
          created_at = CASE WHEN subscribers.state = 'deactivated' THEN excluded.created_at ELSE subscribers.created_at END,
          token_hash=excluded.token_hash,updated_at = excluded.updated_at,event_kinds_json=excluded.event_kinds_json,minimum_impact=excluded.minimum_impact,preferences_set=1
          WHERE subscribers.state <> 'active'`)
          .bind(input.id,input.kind,input.destination,input.state,selection,nonce,input.now,input.now,JSON.stringify(input.eventKinds ?? ["incidents","maintenance"]),input.minimumImpact ?? null),
        db.prepare(`INSERT INTO subscriber_chat_destinations (subscriber_id,kind,sealed_url,slack_team_id,slack_channel_id,name,host,selection_mode,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM subscribers WHERE id=? AND token_hash=?)
          ON CONFLICT(subscriber_id) DO UPDATE SET sealed_url=excluded.sealed_url,slack_team_id=excluded.slack_team_id,slack_channel_id=excluded.slack_channel_id,removed_at=NULL,updated_at=excluded.updated_at`)
          .bind(input.id,input.kind,input.sealedUrl,input.teamId ?? null,input.channelId ?? null,input.name,input.host,selection,input.now,input.now,input.id,nonce),
        db.prepare("DELETE FROM subscriber_components WHERE subscriber_id = ? AND EXISTS(SELECT 1 FROM subscriber_directory AS subscribers WHERE id=? AND token_hash=?)").bind(input.id,input.id,nonce),
        ...input.componentIds.map(componentId => db.prepare(`INSERT INTO subscriber_components (id,subscriber_id,component_id,created_at,updated_at)
          SELECT ?,?,id,?,? FROM components WHERE id=? AND internal=0 AND EXISTS(SELECT 1 FROM subscriber_directory AS subscribers WHERE id=? AND token_hash=?)`).bind(createUlid(),input.id,input.now,input.now,componentId,input.id,nonce)),
      ]);
    },
    async saveOAuthState(hash: string, componentIds: string[], eventKinds: string[], minimumImpact: string | null, now: string, expiresAt: string) {
      await db.batch([
        db.prepare("DELETE FROM subscriber_oauth_states WHERE expires_at < ?").bind(now),
        db.prepare("INSERT INTO subscriber_oauth_states(state_hash,component_ids_json,event_kinds_json,minimum_impact,expires_at,created_at) VALUES(?,?,?,?,?,?)")
          .bind(hash,JSON.stringify(componentIds),JSON.stringify(eventKinds),minimumImpact,expiresAt,now),
      ]);
    },
    async consumeOAuthState(hash: string, now: string) {
      return db.prepare("DELETE FROM subscriber_oauth_states WHERE state_hash=? AND expires_at>? RETURNING component_ids_json AS componentIdsJson,event_kinds_json AS eventKindsJson,minimum_impact AS minimumImpact")
        .bind(hash,now).first<{ componentIdsJson: string; eventKindsJson: string; minimumImpact: "Partially unavailable" | null }>();
    },
    async deactivateTeam(teamId: string, reason: "app_uninstalled" | "tokens_revoked", now: string) {
      await db.batch([
        db.prepare(`UPDATE subscribers SET state='deactivated',deactivation_reason=?,deactivated_at=?,updated_at=?
          WHERE state<>'deactivated' AND id IN (SELECT subscriber_id FROM subscriber_chat_destinations WHERE slack_team_id=?)`).bind(reason,now,now,teamId),
        db.prepare(`UPDATE subscriber_tokens SET revoked_at=?,updated_at=? WHERE revoked_at IS NULL AND subscriber_id IN
          (SELECT subscriber_id FROM subscriber_chat_destinations WHERE slack_team_id=?)`).bind(now,now,teamId),
      ]);
    },
    async deactivateFailing(now: string) {
      const ids=(await db.prepare(`SELECT s.id FROM subscriber_directory s WHERE s.channel IN ('slack','teams') AND s.state='active'
        AND (SELECT count(*) FROM (SELECT d.state FROM integration_deliveries d WHERE d.namespace='lamp-channels'
          AND json_extract(d.envelope,'$.destinationId')=s.id ORDER BY d.created_at DESC,d.id DESC LIMIT 10))=10
        AND NOT EXISTS(SELECT 1 FROM (SELECT d.state FROM integration_deliveries d WHERE d.namespace='lamp-channels'
          AND json_extract(d.envelope,'$.destinationId')=s.id ORDER BY d.created_at DESC,d.id DESC LIMIT 10) recent WHERE recent.state<>'rejected')`).all<{id:string}>()).results;
      for(const {id} of ids)await db.batch([
        db.prepare("UPDATE subscribers SET state='deactivated',deactivation_reason='10 consecutive webhook failures',deactivated_at=?,updated_at=? WHERE id=? AND state='active'").bind(now,now,id),
        db.prepare("UPDATE subscriber_tokens SET revoked_at=?,updated_at=? WHERE subscriber_id=? AND revoked_at IS NULL").bind(now,now,id),
      ]);
    },
    async deactivateArchived(id: string, now: string) {
      await db.batch([
        db.prepare("UPDATE subscribers SET state='deactivated',deactivation_reason='channel_is_archived',deactivated_at=?,updated_at=? WHERE id=? AND chat_kind='slack' AND state<>'deactivated'").bind(now,now,id),
        db.prepare("UPDATE subscriber_tokens SET revoked_at=?,updated_at=? WHERE subscriber_id=? AND revoked_at IS NULL").bind(now,now,id),
      ]);
    },
  };
}
