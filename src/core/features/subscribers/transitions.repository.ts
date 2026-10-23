import type { SubscriberPreferences } from "./preferences";
import { createUlid } from "../../shared/ids";
import type { WebhookFormat } from "./webhook-format";

interface SubscriberPermission {
  subscriberId: string;
  tokenHash: string;
}

export interface SubscriberTransitions {
  confirmSubscriber(permission: SubscriberPermission, now: string): Promise<boolean>;
  updateManagedSelection(permission: SubscriberPermission, componentIds: string[], now: string,webhookFormat?:WebhookFormat, preferences?: SubscriberPreferences): Promise<boolean>;
  /** confirmationAllowance, when given, is the address's anti-bomb key; it is cleared in the same transaction. */
  unsubscribeSubscriber(permission: SubscriberPermission, now: string, confirmationAllowance?: string | null): Promise<boolean>;
}

export function createSubscriberTransitions(binding: D1Database): SubscriberTransitions {
  async function transition(
    permission: SubscriberPermission,
    scope: "confirm" | "manage" | "unsubscribe",
    state: "pending" | "active" | "subscribed",
    statements: D1PreparedStatement[],
  ) {
    // D1 batch is one transaction. A failed assertion rolls back the whole
    // batch, including every dependent write. Check database time here, not
    // the service's earlier lookup time. Checking expiry separately on each
    // write could apply only part of a selection as its permission expires.
    const allowedState = state === "subscribed" ? "subscribers.state IN ('pending', 'active')" : "subscribers.state = ?";
    const guard = binding.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM subscriber_tokens AS permission
      JOIN subscribers ON subscribers.id = permission.subscriber_id
      WHERE subscribers.id = ? AND permission.token_hash = ?
        AND permission.scope = ? AND permission.revoked_at IS NULL
        AND (permission.expires_at IS NULL OR permission.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        AND ${allowedState}
    ) THEN 1 ELSE json('Subscriber permission is no longer current.') END`)
      .bind(permission.subscriberId, permission.tokenHash, scope, ...(state === "subscribed" ? [] : [state]));
    try {
      await binding.batch([guard, ...statements]);
      return true;
    } catch (cause) {
      // Only the authorization assertion parses JSON in these batches. Other
      // storage failures must propagate instead of becoming a denied token.
      if (cause instanceof Error && cause.message.includes("malformed JSON")) return false;
      throw cause;
    }
  }

  return {
    async confirmSubscriber(permission, now) {
      return transition(permission, "confirm", "pending", [
        binding.prepare("UPDATE subscribers SET state = 'active', deactivation_reason = NULL, deactivated_at = NULL, updated_at = ? WHERE id = ?")
          .bind(now, permission.subscriberId),
        binding.prepare("UPDATE subscriber_intake SET confirmed_at=? WHERE subscriber_id=?").bind(now,permission.subscriberId),
        binding.prepare("UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND scope = 'confirm' AND revoked_at IS NULL")
          .bind(now, now, permission.subscriberId),
      ]);
    },
    async updateManagedSelection(permission, componentIds, now,webhookFormat, preferences) {
      return transition(permission, "manage", "active", [
        binding.prepare("DELETE FROM subscriber_components WHERE subscriber_id = ?").bind(permission.subscriberId),
        ...componentIds.map(componentId => binding.prepare("INSERT INTO subscriber_components (id, subscriber_id, component_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
          .bind(createUlid(), permission.subscriberId, componentId, now, now)),
        binding.prepare("UPDATE subscribers SET selection_mode = ?, updated_at = ? WHERE id = ?")
          .bind(componentIds.length ? "selected" : "all", now, permission.subscriberId),
        ...(preferences ? [binding.prepare("UPDATE subscribers SET event_kinds_json = ?, minimum_impact = ? WHERE id = ?").bind(JSON.stringify(preferences.eventKinds), preferences.minimumImpact, permission.subscriberId)] : []),
        ...(webhookFormat?[binding.prepare("UPDATE subscribers SET webhook_format=? WHERE id=? AND channel='webhook'").bind(webhookFormat,permission.subscriberId)]:[]),
      ]);
    },
    async unsubscribeSubscriber(permission, now, confirmationAllowance = null) {
      return transition(permission, "unsubscribe", "subscribed", [
        ...(confirmationAllowance ? [binding.prepare("DELETE FROM subscriber_confirmation_attempts WHERE email_hash = ?").bind(confirmationAllowance)] : []),
        binding.prepare("UPDATE subscribers SET state = 'deactivated', deactivation_reason = 'unsubscribed', deactivated_at = ?, updated_at = ? WHERE id = ?")
          .bind(now, now, permission.subscriberId),
        binding.prepare("UPDATE subscriber_tokens SET revoked_at = ?, updated_at = ? WHERE subscriber_id = ? AND revoked_at IS NULL")
          .bind(now, now, permission.subscriberId),
      ]);
    },
  };
}
