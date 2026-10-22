import { pageComponentName } from "./names.ts";
import type { StatusFeedComponent, StatusFeedGroup, StatusFeedIncident, StatusFeedState, StatusFeedUpdate } from "./types.ts";

type Raw = Record<string, unknown>;
export const object = (value: unknown): Raw => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Not a status page response.");
  return value as Raw;
};
export const time = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const text = (value: unknown) => typeof value === "string" ? value : "";
const position = (row: Raw) => typeof row.position === "number" ? row.position : Number.MAX_SAFE_INTEGER;
const STATES = new Set<StatusFeedState>(["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"]);
const LIFECYCLES = new Set(["investigating", "identified", "monitoring", "resolved", "postmortem"]);

/** Statuspage's /api/v2/summary.json: the page, its groups (components marked `group`) and their components, in page order. */
export function statuspageSummary(value: unknown) {
  const body = object(value), page = object(body.page);
  if (typeof page.id !== "string" || !/^[a-z0-9]{6,32}$/.test(page.id) || typeof object(body.status).indicator !== "string" || !Array.isArray(body.components)) throw new Error("Not a Statuspage summary.");
  const rows = body.components.map(object).filter((row) => typeof row.id === "string" && pageComponentName(text(row.name)));
  const order = (a: Raw, b: Raw) => position(a) - position(b);
  const groups: StatusFeedGroup[] = [], components: StatusFeedComponent[] = [];
  const component = (row: Raw, groupId: string | null): StatusFeedComponent => ({
    id: String(row.id), name: pageComponentName(text(row.name)), groupId, description: text(row.description).trim(),
    onlyShowIfDegraded: row.only_show_if_degraded === true, createdAt: time(row.created_at), raw: row,
  });
  const groupIds = new Set(rows.filter((row) => row.group === true).map((row) => String(row.id)));
  // Groups and ungrouped components share the page's top level; each group lists its own in their order.
  for (const row of rows.filter((entry) => !entry.group_id || !groupIds.has(String(entry.group_id))).sort(order)) {
    if (row.group !== true) { components.push(component(row, null)); continue; }
    const id = String(row.id);
    const members = rows.filter((entry) => entry.group !== true && String(entry.group_id) === id).sort(order);
    if (!members.length) continue;
    groups.push({ id, name: pageComponentName(text(row.name)), raw: row });
    components.push(...members.map((member) => component(member, id)));
  }
  return { pageId: page.id, name: text(page.name).trim() || null, groups, components };
}

/** Statuspage's /api/v2/incidents.json (its 50 newest incidents): the resolved ones, with every update and the
 * component states each update states. Open incidents and maintenance are left out. */
export function statuspageIncidents(value: unknown, known: Set<string>): StatusFeedIncident[] {
  const body = object(value);
  if (!Array.isArray(body.incidents)) throw new Error("Not a Statuspage incident list.");
  return body.incidents.map(object).flatMap((row): StatusFeedIncident[] => {
    if (typeof row.id !== "string" || !["resolved", "postmortem"].includes(text(row.status)) || row.scheduled_for || row.impact === "maintenance" || !Array.isArray(row.incident_updates)) return [];
    const updates = row.incident_updates.map(object).flatMap((update): StatusFeedUpdate[] => {
      const at = time(update.display_at) ?? time(update.created_at);
      if (typeof update.id !== "string" || !at) return [];
      const states = (Array.isArray(update.affected_components) ? update.affected_components : []).map(object)
        .filter((affected) => known.has(String(affected.code)) && STATES.has(affected.new_status as StatusFeedState))
        .map((affected) => ({ componentId: String(affected.code), state: affected.new_status as StatusFeedState }));
      const status = text(update.status);
      return [{ id: update.id, status: (LIFECYCLES.has(status) ? status : "update") as StatusFeedUpdate["status"], body: text(update.body).trim(), at, states }];
    }).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    // A backdated incident starts at its created time, before it was posted (started_at): it began at the earliest.
    const startedAt = [time(row.created_at), time(row.started_at), updates[0]?.at].filter((value): value is string => Boolean(value)).sort()[0];
    if (!updates.length || !startedAt) return [];
    const impact = text(row.impact);
    return [{
      id: row.id, title: text(row.name).trim(), url: null, shortlink: typeof row.shortlink === "string" ? row.shortlink : null,
      impact: (["none", "minor", "major", "critical"].includes(impact) ? impact : null) as StatusFeedIncident["impact"],
      startedAt, resolvedAt: time(row.resolved_at) ?? updates.at(-1)!.at,
      components: (Array.isArray(row.components) ? row.components : []).map(object).map((listed) => String(listed.id)).filter((id) => known.has(id)),
      updates, raw: row,
    }];
  });
}
