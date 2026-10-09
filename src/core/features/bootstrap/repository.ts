import { createUlid, nowIso } from "../../shared/ids";

export function createBootstrapRepository(binding: D1Database) {
  return {
    async initialized() {
      return Boolean(await binding.prepare("SELECT id FROM operators LIMIT 1").first());
    },
    async initialize(input: { email: string; displayName: string; pageName: string; tagline: string; timezone: string; hostname: string; mailFrom: string }) {
      const now = nowIso();
      // D1 batch is transactional. The conditional operator insertion serializes
      // competing bootstrap requests; an existing or erased owner closes setup.
      const results = await binding.batch([
        binding.prepare("INSERT INTO operators (id,email,display_name,is_setup_operator,created_at,updated_at) SELECT ?,?,?,1,?,? WHERE NOT EXISTS (SELECT 1 FROM operators)").bind(createUlid(), input.email, input.displayName, now, now),
        binding.prepare("INSERT INTO page_settings (id,page_name,tagline,accent_color,timezone,hostname,footer_credit_enabled,created_at,updated_at,mail_from_address,feed_id) SELECT 'default',?,?,'#2563eb',?,?,1,?,?,?,? WHERE changes() = 1 ON CONFLICT(id) DO NOTHING").bind(input.pageName, input.tagline, input.timezone, input.hostname, now, now, input.mailFrom, createUlid()),
      ]);
      return results[0].meta.changes === 1;
    },
  };
}
