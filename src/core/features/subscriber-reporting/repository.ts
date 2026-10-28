import type { BaselineCount, ComponentCount, CurrentCount, DailyFact, ReasonCount, ReportingFacts, ReportingRange } from "./types";

export interface SubscriberReportingRepository { read(range: ReportingRange): Promise<ReportingFacts> }

export function createSubscriberReportingRepository(db: D1Database): SubscriberReportingRepository {
  return {
    async read(range) {
      // An empty installation keeps deterministic migration seeds until this
      // first observation; subscriber mutations start tracking in their trigger.
      await db.prepare("UPDATE subscriber_reporting_tracking SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1 AND started_at = ''").run();
      // Existing email/webhook reports retain their empty-installation shape.
      // Once SMS has inventory or recorded growth, its own partition joins the
      // same report rather than appearing as ordinary webhook traffic.
      const sms=Boolean(await db.prepare("SELECT 1 FROM sms_reporting_daily UNION ALL SELECT 1 FROM subscribers WHERE sms_kind=1 LIMIT 1").first());
      const channels = range.channel ? [range.channel] : ["email", "webhook", ...(sms ? ["sms"] : [])];
      const placeholders = channels.map(() => "?").join(",");
      const current = `s.destination NOT LIKE 'deleted:%' AND s.channel IN (${placeholders})`;
      // A single D1 batch gives the live counts and durable trend one read snapshot.
      const result = await db.batch([
        db.prepare("SELECT started_at AS trackingStartedAt, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS measuredAt FROM subscriber_reporting_tracking WHERE id = 1"),
        db.prepare(`SELECT channel, eligible FROM subscriber_reporting_all_baseline WHERE channel IN (${placeholders}) ORDER BY channel`).bind(...channels),
        db.prepare(`SELECT b.channel, b.eligible + COALESCE((SELECT SUM(d.joined - d.left_count) FROM subscriber_reporting_all_daily d WHERE d.channel = b.channel AND d.day < ?), 0) AS eligible FROM subscriber_reporting_all_baseline b WHERE b.channel IN (${placeholders}) ORDER BY b.channel`).bind(range.from, ...channels),
        db.prepare(`SELECT s.channel, s.state, COUNT(*) AS count FROM subscriber_directory s WHERE ${current} GROUP BY s.channel, s.state ORDER BY s.channel, s.state`).bind(...channels),
        db.prepare(`SELECT c.id AS componentId, c.name AS componentName, g.name AS groupName, s.channel, s.state, COUNT(*) AS count
          FROM components c LEFT JOIN component_groups g ON g.id = c.group_id
          JOIN subscriber_directory s ON s.selection_mode = 'all' OR EXISTS (SELECT 1 FROM subscriber_components sc WHERE sc.component_id = c.id AND sc.subscriber_id = s.id)
          WHERE c.internal = 0 AND ${current}
          GROUP BY c.id, s.channel, s.state ORDER BY c.display_order, c.id, s.channel, s.state`).bind(...channels),
        db.prepare(`SELECT s.channel, s.deactivation_reason AS reason, COUNT(*) AS count FROM subscriber_directory s WHERE ${current} AND s.state = 'deactivated' GROUP BY s.channel, s.deactivation_reason ORDER BY s.channel, s.deactivation_reason`).bind(...channels),
        db.prepare(`SELECT day, channel, joined, left_count AS "left" FROM subscriber_reporting_all_daily WHERE day >= ? AND day < ? AND channel IN (${placeholders}) ORDER BY day, channel`).bind(range.from, range.to, ...channels),
      ]);
      const tracking = result[0].results[0] as { trackingStartedAt: string; measuredAt: string } | undefined;
      if (!tracking || result[1].results.length !== channels.length) throw new Error("Subscriber reporting baseline is not configured.");
      return { ...tracking, baseline: result[1].results as unknown as BaselineCount[], opening: result[2].results as unknown as BaselineCount[], counts: result[3].results as unknown as CurrentCount[], components: result[4].results as unknown as ComponentCount[], deactivationReasons: result[5].results as unknown as ReasonCount[], daily: result[6].results as unknown as DailyFact[] };
    },
  };
}
