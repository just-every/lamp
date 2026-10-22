import { pageComponentName } from "./names.ts";
import { object, time } from "./statuspage.ts";
import type { StatusFeedComponent, StatusFeedGroup, StatusFeedIncident, StatusFeedUpdate } from "./types.ts";
import { feedEntries, htmlText } from "./xml.ts";

const text = (value: unknown) => typeof value === "string" ? value : "";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LIFECYCLES = new Set(["investigating", "identified", "monitoring", "resolved"]);
// "Apr <var data-var='date'> 20</var>, <var data-var='time'>09:59:06</var> GMT+0</small><br /><strong>Resolved</strong> - "
const UPDATE = /<small>\s*([A-Za-z]{3,9})\.?\s*(?:<var[^>]*>)?\s*(\d{1,2})\s*(?:<\/var>)?\s*,\s*(?:<var[^>]*>)?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:<\/var>)?\s*(GMT[^<]*)?<\/small>\s*(?:<br\s*\/?>)?\s*<strong>([^<]+)<\/strong>\s*-\s*/gi;

/** Instatus's /summary.json: the page's name and address, and what is open on it now. */
export function instatusSummary(value: unknown) {
  const body = object(value), page = object(body.page);
  if (typeof page.name !== "string" || typeof page.url !== "string") throw new Error("Not an Instatus summary.");
  const open = [...(Array.isArray(body.activeIncidents) ? body.activeIncidents : []), ...(Array.isArray(body.activeMaintenances) ? body.activeMaintenances : [])];
  return { name: page.name.trim() || null, address: page.url.trim() || null, active: new Set(open.map((row) => String(object(row).id))) };
}

/** Instatus's /v2/components.json, in page order. A component the others name as their group is that group. */
export function instatusComponents(value: unknown) {
  const rows = object(value).components;
  if (!Array.isArray(rows)) throw new Error("Not an Instatus component list.");
  const entries = rows.map(object).filter((row) => typeof row.id === "string" && pageComponentName(text(row.name)));
  const parentOf = (row: Record<string, unknown>) => row.group && typeof row.group === "object" ? String(object(row.group).id) : null;
  const parents = new Set(entries.map(parentOf).filter((id): id is string => Boolean(id)));
  const groups: StatusFeedGroup[] = [], components: StatusFeedComponent[] = [];
  for (const row of entries) {
    const id = String(row.id), parent = parentOf(row);
    if (parents.has(id)) continue;
    if (parent && !groups.some((group) => group.id === parent)) {
      const listed = entries.find((entry) => String(entry.id) === parent) ?? object(row.group);
      groups.push({ id: parent, name: pageComponentName(text(listed.name)), raw: listed });
    }
    components.push({ id, name: pageComponentName(text(row.name)), groupId: parent, description: text(row.description).trim(), onlyShowIfDegraded: false, createdAt: null, raw: row });
  }
  return { groups: groups.filter((group) => group.name), components };
}

/** The feed gives an update's month, day, time and offset, never its year: the year is the one that puts the
 * update nearest the entry's own published and updated times. */
function updateTime(month: string, day: string, clock: string, offset: string, around: number[]) {
  const [hours, minutes, seconds = "0"] = clock.split(":");
  const zone = offset.match(/([+-])(\d{1,2})(?::?(\d{2}))?/);
  const shift = zone ? (zone[1] === "-" ? -1 : 1) * (Number(zone[2]) * 60 + Number(zone[3] ?? 0)) : 0;
  const index = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  if (index < 0 || !around.length) return null;
  const year = new Date(around[0]).getUTCFullYear();
  const distance = (instant: number) => Math.min(...around.map((anchor) => Math.abs(anchor - instant)));
  const best = [year - 1, year, year + 1].map((candidate) => Date.UTC(candidate, index, Number(day), Number(hours), Number(minutes), Number(seconds)) - shift * 60_000)
    .filter(Number.isFinite).sort((a, b) => distance(a) - distance(b))[0];
  return best === undefined ? null : new Date(best).toISOString();
}

/** Instatus's /history.atom: each past incident, its updates and the components it names. The feed states no
 * component states, so its updates carry none. Maintenance and anything still open on the page are left out. */
export function instatusIncidents(atom: string, components: StatusFeedComponent[], active: Set<string>): StatusFeedIncident[] {
  if (!/<feed\b/i.test(atom)) throw new Error("Not an Atom feed.");
  return feedEntries(atom).flatMap(({ fields, links }): StatusFeedIncident[] => {
    const id = (fields.id ?? "").match(/Incident\/([A-Za-z0-9_-]+)$/)?.[1];
    const content = fields.content ?? "";
    if (!id || content.match(/<strong>\s*Type:\s*<\/strong>\s*([^<]+)/i)?.[1].trim().toLowerCase() !== "incident" || active.has(id)) return [];
    const around = [Date.parse(fields.published ?? ""), Date.parse(fields.updated ?? "")].filter(Number.isFinite);
    const marks = [...content.matchAll(UPDATE)];
    const seen = new Map<string, number>();
    const updates = marks.flatMap((mark, index): Omit<StatusFeedUpdate, "id">[] => {
      const at = updateTime(mark[1], mark[2], mark[3], mark[4] ?? "", around);
      if (!at) return [];
      const end = marks[index + 1]?.index ?? content.length;
      // The feed ends every message with a full stop of its own: "resolved.." for "resolved.".
      const body = htmlText(content.slice(mark.index + mark[0].length, end).replace(/<\/p>\s*(?:<p>\s*)?$/i, "")).replace(/([.!?…])\.$/u, "$1");
      const status = mark[5].trim().toLowerCase();
      return [{ status: (LIFECYCLES.has(status) ? status : "update") as StatusFeedUpdate["status"], body, at, states: [] }];
    }).sort((a, b) => a.at.localeCompare(b.at)).map((update): StatusFeedUpdate => {
      const count = (seen.get(update.at) ?? 0) + 1;
      seen.set(update.at, count);
      return { id: `${id}:${update.at}${count > 1 ? `:${count}` : ""}`, ...update };
    });
    if (!updates.length || updates.at(-1)!.status !== "resolved") return [];
    // Names are matched whole between the list's commas, so one name never matches inside another.
    let rest = `, ${htmlText(content.match(/<strong>\s*Affected Components:\s*<\/strong>([\s\S]*?)<\/p>/i)?.[1] ?? "")}, `;
    const listed = new Set<string>();
    for (const component of [...components].sort((a, b) => b.name.length - a.name.length)) {
      if (!rest.includes(`, ${component.name}, `)) continue;
      listed.add(component.id);
      rest = rest.replace(`, ${component.name}, `, ", ");
    }
    const url = links.find((link) => (link.rel ?? "alternate") === "alternate" && link.href)?.href ?? null;
    return [{
      id, title: (fields.title ?? "").trim(), url, shortlink: null, impact: null,
      // An entry can be published after its first update; the incident began by then.
      startedAt: [time(fields.published), updates[0].at].filter((value): value is string => Boolean(value)).sort()[0], resolvedAt: updates.at(-1)!.at,
      components: components.filter((component) => listed.has(component.id)).map((component) => component.id),
      updates, raw: { id: fields.id, title: fields.title, link: url, published: fields.published, updated: fields.updated, content },
    }];
  });
}
