import { pageComponentName } from "./names.ts";
import { object, time } from "./statuspage.ts";
import type { StatusFeedComponent, StatusFeedGroup, StatusFeedIncident, StatusFeedState, StatusFeedUpdate } from "./types.ts";
import { feedEntries } from "./xml.ts";

type Raw = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value : "";
const attributes = (row: Raw) => object(row.attributes);
const number = (value: unknown) => typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
const STATES: Record<string, StatusFeedState> = { operational: "operational", resolved: "operational", degraded: "degraded_performance", downtime: "major_outage", maintenance: "under_maintenance" };

/** Better Stack's /index.json: the page, its sections and the resources it shows in them. A named section is a group;
 * resources in an unnamed one are ungrouped, and so are a page's whose only section holds them all: every Better Stack
 * resource sits in a section, so one section ("Current status by service") is the page's list, not a grouping. */
export function betterstackIndex(value: unknown) {
  const body = object(value), page = object(body.data);
  if (page.type !== "status_page" || typeof page.id !== "string" || !Array.isArray(body.included)) throw new Error("Not a Better Stack status page.");
  const included = body.included.map(object);
  const of = (type: string) => included.filter((row) => row.type === type && typeof row.id === "string");
  const sections = of("status_page_section").sort((a, b) => number(attributes(a).position) - number(attributes(b).position));
  const sectionOrder = new Map(sections.map((section, index) => [String(section.id), index]));
  const groups: StatusFeedGroup[] = sections.length < 2 ? [] : sections.filter((section) => pageComponentName(text(attributes(section).name))).map((section) => ({ id: String(section.id), name: pageComponentName(text(attributes(section).name)), raw: section }));
  const resources = of("status_page_resource").filter((row) => pageComponentName(text(attributes(row).public_name)))
    .sort((a, b) => (sectionOrder.get(String(attributes(a).status_page_section_id)) ?? -1) - (sectionOrder.get(String(attributes(b).status_page_section_id)) ?? -1) || number(attributes(a).position) - number(attributes(b).position));
  const components: StatusFeedComponent[] = resources.map((row) => {
    const section = String(attributes(row).status_page_section_id);
    return { id: String(row.id), name: pageComponentName(text(attributes(row).public_name)), groupId: groups.some((group) => group.id === section) ? section : null, description: text(attributes(row).explanation).trim(), onlyShowIfDegraded: false, createdAt: null, raw: row };
  });
  const about = attributes(page);
  // The page's own addresses: its custom domain, or its Better Stack subdomain.
  const hosts = [about.custom_domain, typeof about.subdomain === "string" ? `${about.subdomain}.betteruptime.com` : null].filter((host): host is string => typeof host === "string" && host.length > 0);
  return { pageId: /^\d{1,40}$/.test(page.id) ? page.id : null, hosts, name: text(about.company_name).trim() || null, groups, components, included };
}

/** Better Stack's history: the reports /index.json shows (with each update's resource states), and older ones from its
 * /feed RSS, where only messages and times remain. A report still open on the page, and maintenance, are left out. */
export function betterstackIncidents(index: ReturnType<typeof betterstackIndex>, rss: string | null): StatusFeedIncident[] {
  if (rss !== null && !/<rss\b/i.test(rss)) throw new Error("Not an RSS feed.");
  // The feed holds one item per update, each linking its report's own page.
  const items = rss === null ? [] : feedEntries(rss).map(({ fields }) => ({ fields, id: (fields.link ?? "").match(/\/incident\/([0-9]{1,40})\/?$/)?.[1] }));
  const links = new Map(items.flatMap(({ fields, id }) => id && fields.link ? [[id, fields.link] as const] : []));
  const known = new Set(index.components.map((component) => component.id));
  const updates = new Map(index.included.filter((row) => row.type === "status_update").map((row) => [String(row.id), row]));
  const reports = index.included.filter((row) => row.type === "status_report" && typeof row.id === "string");
  const shown = new Set(reports.map((row) => String(row.id)));
  const states = (row: Raw) => (Array.isArray(attributes(row).affected_resources) ? attributes(row).affected_resources as unknown[] : []).map(object)
    .filter((affected) => known.has(String(affected.status_page_resource_id)) && STATES[text(affected.status).toLowerCase()])
    .map((affected) => ({ componentId: String(affected.status_page_resource_id), state: STATES[text(affected.status).toLowerCase()] }));
  const fromIndex = reports.flatMap((report): StatusFeedIncident[] => {
    const a = attributes(report);
    if (a.report_type === "maintenance" || text(a.aggregate_state).toLowerCase() !== "resolved") return [];
    const related = Array.isArray(object(object(report.relationships).status_updates).data) ? object(object(report.relationships).status_updates).data as unknown[] : [];
    // Better Stack has no lifecycle: an update whose resources are all back, or the report's last (the page shows
    // it resolved), resolves it; any other investigates, as Move in reads Better Stack.
    const timeline = related.map((ref) => updates.get(String(object(ref).id))).filter((row): row is Raw => Boolean(row)).flatMap((row): StatusFeedUpdate[] => {
      const at = time(attributes(row).published_at);
      const stated = states(row);
      return at ? [{ id: String(row.id), status: stated.length && stated.every((state) => state.state === "operational") ? "resolved" : "investigating", body: text(attributes(row).message).trim(), at, states: stated }] : [];
    }).sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
    const startedAt = time(a.starts_at) ?? timeline[0]?.at;
    if (!timeline.length || !startedAt) return [];
    timeline[timeline.length - 1] = { ...timeline.at(-1)!, status: "resolved" };
    return [{ id: String(report.id), title: text(a.title).trim(), url: links.get(String(report.id)) ?? null, shortlink: null, impact: null, startedAt, resolvedAt: time(a.ends_at) ?? timeline.at(-1)!.at, components: [...new Set(states(report).map((state) => state.componentId))], updates: timeline, raw: { report, updates: timeline.map((update) => updates.get(update.id)) } }];
  });
  // Older reports appear only in the feed. The page no longer shows them, so each is over.
  const byReport = new Map<string, Array<(typeof items)[number]["fields"]>>();
  for (const { fields, id } of items) {
    if (!id || shown.has(id) || (fields.category ?? "").toLowerCase() === "maintenance") continue;
    byReport.set(id, [...byReport.get(id) ?? [], fields]);
  }
  // A report names its resources in its title ("Val Town Website is down"); the longest whole names are read first.
  const named = [...index.components].sort((a, b) => b.name.length - a.name.length);
  const fromFeed = [...byReport].flatMap(([id, items]): StatusFeedIncident[] => {
    const timeline = items.flatMap((fields): StatusFeedUpdate[] => {
      const at = time(fields.pubdate);
      const hash = (fields.guid ?? "").split("#")[1];
      return at ? [{ id: `${id}#${hash || at}`, status: "investigating", body: (fields.description ?? "").trim(), at, states: [] }] : [];
    }).sort((x, y) => x.at.localeCompare(y.at) || x.id.localeCompare(y.id));
    if (!timeline.length) return [];
    timeline[timeline.length - 1] = { ...timeline.at(-1)!, status: "resolved" };
    const title = (items.find((fields) => fields.title)?.title ?? "").trim();
    let rest = ` ${title} `;
    const listed: string[] = [];
    for (const component of named) {
      const match = rest.match(new RegExp(`(?<![\\p{L}\\p{N}])${component.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u"));
      if (!match) continue;
      listed.push(component.id);
      rest = `${rest.slice(0, match.index)} ${rest.slice(match.index! + match[0].length)}`;
    }
    return [{ id, title, url: items[0].link ?? null, shortlink: null, impact: null, startedAt: timeline[0].at, resolvedAt: timeline.at(-1)!.at, components: listed, updates: timeline, raw: { link: items[0].link, items } }];
  });
  return [...fromIndex, ...fromFeed].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
