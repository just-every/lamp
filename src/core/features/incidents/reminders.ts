import type { UpdateDuePolicy } from "./policies";

export type UpdateReminderKind = "due-soon" | "overdue";

export interface UpdateReminderEvent {
  kind: UpdateReminderKind;
  incidentId: string;
  reference: string;
  title: string;
  updateId: string;
  nextUpdateAt: string;
}

/** An open incident's latest published commitment that may still need a reminder. */
interface OpenCommitment { incidentId: string; reference: string; title: string; updateId: string; nextUpdateAt: string }

export interface UpdateReminders {
  /** Sends what is due at `now`, the scheduled trigger's time; returns the events sent. */
  remindDue(now: string): Promise<UpdateReminderEvent[]>;
}

export function createUpdateReminders(binding: D1Database, policy: UpdateDuePolicy, send: (event: UpdateReminderEvent) => Promise<void>): UpdateReminders {
  return {
    async remindDue(now) {
      // Only an incident's newest update carries its live commitment. A resolved
      // incident, a resolving update and retroactive history have none.
      const open = await binding.prepare(`SELECT i.id AS incidentId, i.reference, i.title, u.id AS updateId, u.next_update_at AS nextUpdateAt
        FROM incidents i
        JOIN incident_updates u ON u.id = (SELECT id FROM incident_updates WHERE incident_id = i.id ORDER BY published_at DESC, id DESC LIMIT 1)
        WHERE i.deleted_at IS NULL AND i.lifecycle <> 'Resolved' AND u.lifecycle <> 'Resolved' AND u.is_retroactive = 0 AND u.next_update_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM incident_update_reminders r WHERE r.update_id = u.id AND r.kind = 'overdue')`).all<OpenCommitment>();
      const instant = Date.parse(now);
      const lead = policy.leadMinutes() * 60_000;
      const sent: UpdateReminderEvent[] = [];
      for (const commitment of open.results) {
        const due = Date.parse(commitment.nextUpdateAt);
        const kind: UpdateReminderKind | null = instant > due ? "overdue" : instant >= due - lead ? "due-soon" : null;
        if (!kind) continue;
        const recorded = await binding.prepare(`SELECT 1 AS sent FROM incident_update_reminders WHERE update_id = ? AND kind = ?`).bind(commitment.updateId, kind).first();
        if (recorded) continue;
        // The alert queue is idempotent per event, so a run interrupted between
        // these two writes repeats the queueing harmlessly and records it next time.
        const event = { kind, ...commitment };
        await send(event);
        await binding.prepare(`INSERT OR IGNORE INTO incident_update_reminders (update_id, kind, recorded_at) VALUES (?, ?, ?)`).bind(commitment.updateId, kind, now).run();
        sent.push(event);
      }
      return sent;
    },
  };
}

/** The operator app's view of an incident's live commitment under the policy. */
export function updateDueState(input: { lifecycle: string; nextUpdateAt: string | null; leadMinutes: number; now: number }) {
  if (input.lifecycle === "Resolved" || !input.nextUpdateAt) return { updateDueAt: null, updateDue: false, overdue: false };
  const due = Date.parse(input.nextUpdateAt);
  const overdue = due < input.now;
  const updateDue = !overdue && input.now >= due - input.leadMinutes * 60_000;
  return { updateDueAt: overdue || updateDue ? input.nextUpdateAt : null, updateDue, overdue };
}
