import type { SubscriberPreferences } from "./preferences";
export function createSubscriberPreferencesRepository(binding: D1Database) {
  return {
    async set(subscriberId: string, preferences: SubscriberPreferences) {
      await binding.prepare("UPDATE subscribers SET preferences_set = 1, event_kinds_json = ?, minimum_impact = ? WHERE id = ?")
        .bind(JSON.stringify(preferences.eventKinds), preferences.minimumImpact, subscriberId).run();
    },
  };
}
