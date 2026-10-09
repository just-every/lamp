/** D1-backed, fixed-window rate limiter for public write paths only. */
export interface PublicWriteRateLimiter {
  allow(input: { scope: string; subject: string; limit: number; now?: Date }): Promise<boolean>;
}

function minuteStart(now: Date) {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
}

export function requestNetworkSubject(request: Request) {
  const forwarded = request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded || "unknown-network";
}

export function createPublicWriteRateLimiter(binding: D1Database): PublicWriteRateLimiter {
  return {
    async allow({ scope, subject, limit, now = new Date() }) {
      const start = minuteStart(now);
      const expires = new Date(now.getTime() + 2 * 60_000).toISOString();
      const key = `${scope}:${subject}`;
      // Expiry is storage hygiene, not the enforcement mechanism: the UPSERT
      // below owns the concurrent decision for the current fixed window.
      await binding.prepare("DELETE FROM request_rate_windows WHERE expires_at < ?").bind(now.toISOString()).run();
      const result = await binding.prepare(`
        INSERT INTO request_rate_windows (rate_key, window_started_at, request_count, expires_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(rate_key) DO UPDATE SET
          window_started_at = CASE WHEN request_rate_windows.window_started_at < excluded.window_started_at THEN excluded.window_started_at ELSE request_rate_windows.window_started_at END,
          request_count = CASE WHEN request_rate_windows.window_started_at < excluded.window_started_at THEN 1 ELSE request_rate_windows.request_count + 1 END,
          expires_at = excluded.expires_at
        WHERE request_rate_windows.window_started_at < excluded.window_started_at OR request_rate_windows.request_count < ?
      `).bind(key, start, expires, limit).run();
      return result.meta.changes === 1;
    },
  };
}
