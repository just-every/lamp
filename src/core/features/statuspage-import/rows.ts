import { attachPostmortem } from "./postmortems";
import { mapTemplates } from "./templates";
import { mostSevereState, type ComponentState, type IncidentLifecycle } from "../../shared/domain";
import { sha256 } from "../../../../modules/import-kit/src/d1/index.ts";
import type { SourceData, SourceIncident, SourceSubscriber } from "./source";

export type Row = Record<string, string | number | null>;
export type EntityKind = "group" | "component" | "incident" | "maintenance" | "subscriber" | "template";
export interface NativeValue { tables: Record<string, Row[]> }
export interface Accounting { kind: string; sourceId: string; name: string; outcome: "imported" | "changed" | "skipped" | "rejected" | "kept-private"; reason: string }
export interface Snapshot {
  maxGroupOrder: number;
  maxComponentOrder: number;
  lastReference: { INC: number; SCH: number };
  allocated: Set<string>;
  /** The public reference of each incident and maintenance window already here. */
  references: Map<string, string>;
  /** The display order of each component and group already here. */
  orders: Map<string, number>;
  /** Each subscribed address, with its subscriber when an active import created it. */
  destinations: Map<string, string | null>;
  /** Each template name, with its template when an active import created it. */
  templateNames?: Map<string, string | null>;
}
export interface Mapped { kind: EntityKind; sourceId: string; value?: NativeValue; accounting: Accounting[] }

/** Each native table group an imported entity owns, keyed by its owning column. */
export const entityTables: Record<EntityKind, Record<string, string>> = {
  group: { component_groups: "id" },
  component: { components: "id", component_claim_events: "component_id", component_state_history: "component_id" },
  incident: { incidents: "id", incident_components: "incident_id", incident_updates: "incident_id", incident_reports: "incident_id" },
  maintenance: { maintenance: "id", maintenance_components: "maintenance_id" },
  template: { incident_templates: "id", incident_template_components: "template_id" },
  subscriber: { subscribers: "id", subscriber_components: "subscriber_id" },
};

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A canonical ULID whose time part is the source record's own time and whose
 * random part is derived from its source identity, so a re-plan names the
 * same native records. */
export function stableId(key: string, at: string, namespace = "statuspage") {
  let time = Math.max(0, Date.parse(at) || 0), prefix = "";
  for (let index = 0; index < 10; index += 1) { prefix = CROCKFORD[time % 32] + prefix; time = Math.floor(time / 32); }
  const digest = sha256(`${namespace}:${key}`);
  let suffix = "";
  for (let index = 0; index < 16; index += 1) suffix += CROCKFORD[parseInt(digest.slice(index * 2, index * 2 + 2), 16) % 32];
  return prefix + suffix;
}

const componentStates: Record<string, ComponentState> = { "": "Operational", operational: "Operational", degraded_performance: "Degraded performance", partial_outage: "Partially unavailable", major_outage: "Major outage", under_maintenance: "Under maintenance" };
const impactStates: Record<string, ComponentState> = { none: "Operational", minor: "Degraded performance", major: "Partially unavailable", critical: "Major outage", maintenance: "Under maintenance" };
const lifecycles: Record<string, IncidentLifecycle> = { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved", postmortem: "Resolved" };
// Cut by code points, as the schema's length() checks count, so a cut never
// splits a surrogate pair into text that D1 cannot store and read back.
const clip = (value: string, limit: number) => { const points = Array.from(value); return points.length > limit ? `${points.slice(0, limit - 1).join("")}…` : value; };
const at = (update: { display_at?: string | null; created_at: string }) => new Date(update.display_at ?? update.created_at).toISOString();
const iso = (value: string) => new Date(value).toISOString();

interface Claim { componentId: string; causeType: "standing-claim" | "incident" | "maintenance"; causeId: string | null; state: ComponentState | null; changedAt: string }

/** Plans every native record of one move-in. Retroactive: published times are
 * the source's times, state history is derived from those claims, and nothing
 * here queues a notification. */
export function mapSource(data: SourceData, snapshot: Snapshot, operatorId: string, asOf: string, namespace = "statuspage"): Mapped[] {
  const identify = (key: string, at: string) => stableId(key, at, namespace);
  const results: Mapped[] = [];
  const groupIds = new Map<string, string>();
  [...data.groups].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).forEach((group, index) => {
    const id = identify(`group:${group.id}`, group.created_at);
    groupIds.set(group.id, id);
    const name = clip(group.name, 120);
    results.push({ kind: "group", sourceId: group.id, value: { tables: { component_groups: [{ id, name, display_order: snapshot.orders.get(id) ?? snapshot.maxGroupOrder + index + 1, created_at: asOf, updated_at: asOf }] } },
      accounting: [{ kind: "group", sourceId: group.id, name: group.name, outcome: name === group.name ? "imported" : "changed", reason: name === group.name ? "Group and its order carried over." : "Group name shortened to 120 characters." }] });
  });

  const components = new Map<string, { id: string; name: string; created: string }>();
  const componentAccounting = new Map<string, Accounting[]>();
  [...data.components].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).forEach((component) => {
    components.set(component.id, { id: identify(`component:${component.id}`, component.created_at), name: clip(component.name, 120), created: iso(component.created_at) });
    const notes: string[] = [];
    if (component.group_id && !groupIds.has(component.group_id)) notes.push("its group was not in the saved responses, so it is ungrouped");
    if (namespace === "statuspage" && component.status && component.status !== "operational") notes.push(`its current '${component.status}' status is set by open incidents and maintenance here, not carried as a manual status`);
    componentAccounting.set(component.id, [{ kind: "component", sourceId: component.id, name: component.name, outcome: notes.length ? "changed" : "imported", reason: notes.length ? `Imported; ${notes.join("; ")}.` : "Component, description and order carried over." }]);
  });
  const claims: Claim[] = [];

  // A record this source already imported keeps its public reference when a
  // catch-up replaces it; only new records take the next free number.
  const references = (namespace: "INC" | "SCH") => {
    let next = snapshot.lastReference[namespace];
    return (id: string) => {
      const existing = snapshot.references.get(id);
      if (existing) return existing;
      do next += 1; while (snapshot.allocated.has(`${namespace}-${next}`));
      return `${namespace}-${next}`;
    };
  };
  const nextIncident = references("INC"), nextMaintenance = references("SCH");

  for (const incident of [...data.incidents].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    const mapped = mapIncident(incident, components, claims, operatorId, asOf, nextIncident, identify, ["betterstack", "sorry"].includes(namespace) ? incident.resolved_at : undefined, namespace === "sorry" && incident.impact === "none", namespace === "statuspage");
    attachPostmortem(mapped, incident, operatorId, asOf, identify);
    results.push(mapped);
  }
  for (const window of [...data.maintenance].sort((a, b) => (a.scheduled_for ?? a.created_at).localeCompare(b.scheduled_for ?? b.created_at) || a.id.localeCompare(b.id))) {
    results.push(mapMaintenance(window, components, claims, operatorId, asOf, nextMaintenance, identify, namespace !== "statuspage"));
  }

  // Components carry their whole derived history, so they are planned after
  // every claim is known; the plan still applies them before what cites them.
  const componentResults: Mapped[] = [];
  [...data.components].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).forEach((component, index) => {
    const native = components.get(component.id)!;
    const own = claims.filter((claim) => claim.componentId === native.id).sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    if (namespace !== "statuspage" && component.status && component.status !== "operational") own.push({ componentId: native.id, causeType: "standing-claim", causeId: null, state: componentStates[component.status], changedAt: asOf });
    const created = [native.created, ...own.map((claim) => claim.changedAt)].sort()[0];
    const history = deriveHistory(native.id, created, own, operatorId, asOf, identify);
    componentResults.push({ kind: "component", sourceId: component.id, accounting: componentAccounting.get(component.id)!, value: { tables: {
      components: [{ id: native.id, group_id: component.group_id ? groupIds.get(component.group_id) ?? null : null, name: native.name, description: clip(component.description ?? "", 500), internal: 0, ...(component.only_show_if_degraded ? { only_show_if_degraded: 1 } : {}), display_order: snapshot.orders.get(native.id) ?? snapshot.maxComponentOrder + index + 1, note: "", created_at: created, updated_at: asOf }],
      ...(namespace !== "statuspage" && component.status && component.status !== "operational" ? { component_standing_claims: [{ id: identify(`standing:${component.id}`, asOf), component_id: native.id, state: componentStates[component.status], operator_id: operatorId, created_at: asOf, updated_at: asOf }] } : {}),
      component_claim_events: history.events,
      component_state_history: history.history,
    } } });
  });

  const subscriberResults = data.subscribers.map((subscriber) => mapSubscriber(subscriber, components, snapshot, asOf, identify, namespace));
  const templates = mapTemplates(data, components, snapshot, operatorId, asOf, identify);
  const order: EntityKind[] = ["group", "component", "incident", "maintenance", "template", "subscriber"];
  return [...results, ...componentResults, ...templates, ...subscriberResults].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

function mapIncident(incident: SourceIncident, components: Map<string, { id: string; name: string }>, claims: Claim[], operatorId: string, asOf: string, reference: (id: string) => string, identify: typeof stableId, sourceEndedAt?: string | null, allowUnattached = false, independentImpact = false): Mapped {
  const name = incident.name;
  const updates = [...incident.incident_updates].sort((a, b) => at(a).localeCompare(at(b)) || a.id.localeCompare(b.id));
  if (!updates.length) return { kind: "incident", sourceId: incident.id, accounting: [{ kind: "incident", sourceId: incident.id, name, outcome: "rejected", reason: "No published updates to carry." }] };
  const id = identify(`incident:${incident.id}`, incident.created_at);
  const claimEndsAt = sourceEndedAt ? iso(sourceEndedAt) : null;
  const notes = new Set<string>();
  const current = new Map<string, ComponentState>();
  const peak: ComponentState[] = [];
  // Statuspage impact is the recorded incident severity, not component evidence.
  for (const listed of independentImpact ? [] : incident.components ?? []) if (components.has(listed.id)) current.set(listed.id, impactStates[incident.impact ?? "minor"] ?? "Degraded performance");
  const rows: Row[] = [];
  let lifecycle: IncidentLifecycle = "Investigating";
  let resolvedAt: string | null = null;
  for (const update of updates) {
    for (const affected of update.affected_components ?? []) {
      if (components.has(affected.code)) current.set(affected.code, componentStates[affected.new_status]);
      else notes.add("an affected component was not in the saved responses");
    }
    lifecycle = lifecycles[update.status] ?? lifecycle;
    const publishedAt = at(update);
    for (const [code, state] of current) {
      peak.push(state);
      // Better Stack's report end and message publication are independent.
      // Preserve its explicit affected states until the report ends, without
      // inventing a resolution message or moving a source message's timestamp.
      if (!claimEndsAt || publishedAt < claimEndsAt) claims.push({ componentId: components.get(code)!.id, causeType: "incident", causeId: id, state: !claimEndsAt && lifecycle === "Resolved" ? null : state, changedAt: publishedAt });
    }
    if (lifecycle === "Resolved") resolvedAt = publishedAt;
    const body = (update.body ?? "").trim() || name, points = Array.from(body);
    const impact = clip(body, 250);
    const details = points.length > 250 ? clip(points.slice(249).join(""), 500) : "";
    if (points.length > 749) notes.add("long update text was shortened to Lamp's update fields");
    const names = [...current.keys()].map((code) => components.get(code)!.name);
    rows.push({ id: identify(`incident-update:${update.id}`, publishedAt), incident_id: id, lifecycle, affected_audience: clip(names.length ? `Customers using ${names.join(", ")}` : "All customers", 250), customer_impact: impact, what_still_works: "", details, next_update_at: null, published_at: publishedAt, author_operator_id: operatorId, corrects_update_id: null, is_retroactive: 1, created_at: asOf, updated_at: asOf });
  }
  if (claimEndsAt) for (const code of current.keys()) claims.push({ componentId: components.get(code)!.id, causeType: "incident", causeId: id, state: null, changedAt: claimEndsAt });
  if (independentImpact && incident.components?.some(component => !current.has(component.id))) notes.add("a listed component has no explicit state in the saved updates; no component claim was invented from the incident impact");
  const firstPublished = at(updates[0]);
  const attached = [...current.entries()].map(([code, state]) => ({ id: identify(`incident-component:${incident.id}:${code}`, firstPublished), incident_id: id, component_id: components.get(code)!.id, component_name: components.get(code)!.name, state, relationship: "Primary", created_at: asOf, updated_at: asOf, published_at: firstPublished }));
  if (!attached.length && !allowUnattached) return { kind: "incident", sourceId: incident.id, accounting: [{ kind: "incident", sourceId: incident.id, name, outcome: "rejected", reason: independentImpact ? "No affected component with an explicit source state resolves in the saved responses; incident impact is not component-state evidence." : "It names no component in the saved responses; Lamp incidents attach at least one." }] };
  const title = clip(name, 250);
  if (title !== name) notes.add("the title was shortened to 250 characters");
  return { kind: "incident", sourceId: incident.id, value: { tables: {
    incidents: [{ id, reference: reference(id), title, lifecycle, opened_at: iso(incident.created_at), resolved_at: lifecycle === "Resolved" ? (incident.resolved_at ? iso(incident.resolved_at) : resolvedAt) : null, created_by_operator_id: operatorId, deleted_at: null, deletion_reason: null, created_at: asOf, updated_at: asOf, peak_impact: mostSevereState(peak), ...(independentImpact && ["none", "minor", "major", "critical"].includes(incident.impact ?? "") ? { impact_override: incident.impact! } : {}) }],
    incident_components: attached,
    incident_updates: rows,
  } }, accounting: [{ kind: "incident", sourceId: incident.id, name, outcome: notes.size ? "changed" : "imported", reason: `${updates.length} update${updates.length === 1 ? "" : "s"} at their original times, notifying no one${notes.size ? `; ${[...notes].join("; ")}` : ""}.` }] };
}

function mapMaintenance(window: SourceIncident, components: Map<string, { id: string; name: string }>, claims: Claim[], operatorId: string, asOf: string, reference: (id: string) => string, identify: typeof stableId, preserveUpdates: boolean): Mapped {
  const name = window.name;
  const startsAt = window.scheduled_for ? iso(window.scheduled_for) : null, endsAt = window.scheduled_until ? iso(window.scheduled_until) : null;
  if (!startsAt || !endsAt || endsAt <= startsAt) return { kind: "maintenance", sourceId: window.id, accounting: [{ kind: "maintenance", sourceId: window.id, name, outcome: "rejected", reason: "It has no valid scheduled window." }] };
  const id = identify(`maintenance:${window.id}`, startsAt);
  const attached = [...new Set([...(window.components ?? []).map((component) => component.id), ...window.incident_updates.flatMap((update) => (update.affected_components ?? []).map((affected) => affected.code))])].filter((code) => components.has(code));
  if (!attached.length) return { kind: "maintenance", sourceId: window.id, accounting: [{ kind: "maintenance", sourceId: window.id, name, outcome: "rejected", reason: "It names no component in the saved responses." }] };
  // A window already over is history, whatever its source status: importing it
  // as Scheduled would make Lamp announce its start and end now.
  const state = window.status === "cancelled" ? "Cancelled" : endsAt <= asOf || window.status === "completed" ? "Completed" : startsAt <= asOf ? "In progress" : "Scheduled";
  const completedAt = state === "Completed" ? (window.resolved_at ? iso(window.resolved_at) : endsAt) : null;
  for (const code of attached) {
    if (state === "Scheduled" || state === "Cancelled") continue;
    claims.push({ componentId: components.get(code)!.id, causeType: "maintenance", causeId: id, state: "Under maintenance", changedAt: startsAt });
    if (completedAt) claims.push({ componentId: components.get(code)!.id, causeType: "maintenance", causeId: id, state: null, changedAt: completedAt });
  }
  const sourceState = ({ scheduled: "Scheduled", in_progress: "In progress", verifying: "In progress", completed: "Completed", cancelled: "Cancelled" } as Record<string, string>)[window.status];
  return { kind: "maintenance", sourceId: window.id, value: { tables: {
    maintenance: [{ id, reference: reference(id), title: clip(name, 250), state, starts_at: startsAt, ends_at: endsAt, completed_at: completedAt, created_by_operator_id: operatorId, created_at: asOf, updated_at: asOf }],
    ...(preserveUpdates && window.incident_updates.length ? { import_maintenance_updates: window.incident_updates.map((update) => ({ id: identify(`maintenance-update:${update.id}`, at(update)), maintenance_id: id, body: update.body ?? "", published_at: at(update), source_states: JSON.stringify(update.affected_components ?? []) })).sort((a, b) => a.published_at.localeCompare(b.published_at) || a.id.localeCompare(b.id)) } : {}),
    maintenance_components: attached.map((code) => ({ id: identify(`maintenance-component:${window.id}:${code}`, startsAt), maintenance_id: id, component_id: components.get(code)!.id, component_name: components.get(code)!.name, state: "Under maintenance", created_at: asOf, updated_at: asOf })),
  } }, accounting: [{ kind: "maintenance", sourceId: window.id, name, outcome: sourceState === state ? "imported" : "changed", reason: sourceState === state ? `${state} window carried over; no notice is sent for it.` : `Imported as ${state} because its window is ${state === "Completed" ? "over" : "under way"}; no notice is sent for it.` }] };
}

function mapSubscriber(subscriber: SourceSubscriber, components: Map<string, { id: string }>, snapshot: Snapshot, asOf: string, identify: typeof stableId, namespace: string): Mapped {
  const skip = (reason: string): Mapped => ({ kind: "subscriber", sourceId: subscriber.id, accounting: [{ kind: "subscriber", sourceId: subscriber.id, name: subscriber.email ? "Email subscriber" : `${subscriber.mode} subscriber`, outcome: "skipped", reason }] });
  if (subscriber.mode !== "email") return skip(`Lamp carries email subscribers; ${subscriber.mode} subscribers subscribe again here.`);
  const email = subscriber.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) return skip("No valid email address.");
  if (subscriber.quarantined_at) return skip("Quarantined at the source after delivery failures.");
  // Keyed on the source record alone, so every plan of it names the same native
  // subscriber; the one this source already imported is not someone else's.
  const since = subscriber.created_at ?? "1970-01-01T00:00:00.000Z";
  const id = identify(`subscriber:${subscriber.id}`, since);
  if (snapshot.destinations.has(email) && snapshot.destinations.get(email) !== id) return skip("This address already has a subscription here.");
  snapshot.destinations.set(email, id);
  if (subscriber.components?.some((code) => !components.has(code))) return skip("A selected component is missing; preferences cannot be broadened.");
  const selected = subscriber.components ?? [];
  return { kind: "subscriber", sourceId: subscriber.id, value: { tables: {
    subscribers: [{ id, channel: "email", destination: email, contact_email: null, state: namespace === "sorry" ? "deactivated" : "pending", selection_mode: selected.length ? "selected" : "all", token_hash: sha256(`${namespace}-import-subscriber:${subscriber.id}:${email}`), deactivation_reason: namespace === "sorry" ? "held for Sorry cutover" : null, deactivated_at: null, created_at: asOf, updated_at: asOf }],
    subscriber_components: selected.map((code) => ({ id: identify(`subscriber-component:${subscriber.id}:${code}`, since), subscriber_id: id, component_id: components.get(code)!.id, created_at: asOf, updated_at: asOf })),
  } }, accounting: [{ kind: "subscriber", sourceId: subscriber.id, name: "Email subscriber", outcome: "imported", reason: namespace === "sorry" ? "Held without mail or confirmation expiry until you approve invitations after hostname cutover and the watch window. Each recipient must confirm in Lamp." : "Pending until they confirm one invitation; they are sent nothing about past incidents." }] };
}

/** The aggregate state timeline for one new component: an Operational
 * standing claim at creation, then each imported claim at its source time. */
function deriveHistory(componentId: string, created: string, claims: Claim[], operatorId: string, asOf: string, identify: typeof stableId) {
  const standing: Claim = { componentId, causeType: "standing-claim", causeId: null, state: "Operational", changedAt: created };
  const all = [standing, ...claims];
  const events: Row[] = all.map((claim, index) => ({ id: identify(`claim:${componentId}:${index}`, claim.changedAt), component_id: componentId, cause_type: claim.causeType, cause_id: claim.causeId, state: claim.state, changed_at: claim.changedAt, created_at: asOf, updated_at: asOf }));
  const history: Row[] = [{ id: identify(`history:${componentId}:0`, created), component_id: componentId, previous_state: "Operational", new_state: "Operational", cause_type: "standing-claim", cause_id: null, operator_id: operatorId, supersedes_history_id: null, changed_at: created, created_at: asOf, updated_at: asOf }];
  const active = new Map<string, ComponentState>();
  let previous: ComponentState = "Operational";
  const times = [...new Set(claims.map((claim) => claim.changedAt))].sort();
  for (const time of times) {
    const now = claims.filter((claim) => claim.changedAt === time);
    for (const claim of now) {
      const key = `${claim.causeType}:${claim.causeId}`;
      if (claim.state) active.set(key, claim.state); else active.delete(key);
    }
    const next = mostSevereState([...active.values()]);
    if (next !== previous) {
      const cause = now[now.length - 1];
      history.push({ id: identify(`history:${componentId}:${history.length}`, time), component_id: componentId, previous_state: previous, new_state: next, cause_type: cause.causeType, cause_id: cause.causeId, operator_id: operatorId, supersedes_history_id: null, changed_at: time, created_at: asOf, updated_at: asOf });
      previous = next;
    }
  }
  return { events, history };
}
