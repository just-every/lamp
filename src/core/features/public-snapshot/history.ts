import type { PublicIncident, PublicMaintenance } from "./record-markup";
import { noticeMarkup, recordHead, updateMarkup } from "./record-markup";
import { DAY, durationText, escapeHtml, timestamp } from "./format";

interface HistoryModel {
  incidents: PublicIncident[];
  maintenance: PublicMaintenance[];
  generatedAt: string;
  settings: { timezone: string };
}

interface HistoryRecord { timestamp: string; html: () => string }

function historyRecords(model: HistoryModel): HistoryRecord[] {
  const timezone = model.settings.timezone;
  return [
    ...model.incidents.filter(incident => incident.lifecycle === "Resolved" && incident.resolvedAt).map(incident => ({
      timestamp: incident.resolvedAt!,
      html: () => `<article class="history-item">${recordHead("Incident", incident.reference, `<a href="/incidents/${encodeURIComponent(incident.reference)}">${escapeHtml(incident.title)}</a>`, "h3", incident.lifecycle)}<p class="incident-meta">Resolved ${timestamp(incident.resolvedAt!, timezone)} · ${escapeHtml(durationText(incident.openedAt, incident.resolvedAt!))}${incident.components.length ? ` · affected ${escapeHtml(incident.components.join(", "))}` : ""}</p><div class="updates">${incident.updates.map(update => updateMarkup(incident, update, timezone)).join("")}</div></article>`,
    })),
    ...model.maintenance.filter(item => item.state === "Completed" || item.state === "Cancelled").map(item => ({
      timestamp: item.completedAt ?? item.endsAt,
      html: () => `<article class="history-item">${recordHead("Maintenance", item.reference, `<a href="/maintenance/${encodeURIComponent(item.reference)}">${escapeHtml(item.title)}</a>`, "h3", item.state)}<p class="incident-meta">${timestamp(item.startsAt, timezone)} – ${timestamp(item.endsAt, timezone)} · ${escapeHtml(durationText(item.startsAt, item.endsAt))}${item.components.length ? ` · affected ${escapeHtml(item.components.join(", "))}` : ""}</p><div class="updates">${[...item.notices, ...(item.importedUpdates ?? []).map(update => ({ ...update, kind: "Imported update" }))].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).map(notice => noticeMarkup(notice, timezone)).join("")}</div></article>`,
    })),
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

function monthKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}`;
}

function monthLabel(key: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${key}-15T12:00:00Z`));
}

/** Newest first, skipping empty calendar months. Month boundaries use the page timezone. */
export function historyMonths(model: HistoryModel) {
  return [...new Set(historyRecords(model).map(record => monthKey(record.timestamp, model.settings.timezone)))].sort().reverse();
}

export function renderHistoryContent(model: HistoryModel, selectedMonth?: string) {
  const records = historyRecords(model);
  const cutoff = Date.parse(model.generatedAt) - 365 * DAY;
  const months = [...new Set(records.map(record => monthKey(record.timestamp, model.settings.timezone)))].sort().reverse();
  const shown = selectedMonth ? records.filter(record => monthKey(record.timestamp, model.settings.timezone) === selectedMonth) : records.filter(record => Date.parse(record.timestamp) >= cutoff);
  const groups = new Map<string, string[]>();
  for (const record of shown) {
    const key = monthKey(record.timestamp, model.settings.timezone);
    groups.set(key, [...(groups.get(key) ?? []), record.html()]);
  }
  const index = selectedMonth ? months.indexOf(selectedMonth) : -1;
  const previous = index >= 0 ? months[index + 1] : undefined;
  const next = index > 0 ? months[index - 1] : undefined;
  const navigation = selectedMonth ? `<nav class="not-found-links" aria-label="History months">${previous ? `<a class="text-link" rel="prev" href="/history/${previous}">Previous month: ${escapeHtml(monthLabel(previous))}</a>` : ""}<a class="text-link" href="/history">Last 12 months</a>${next ? `<a class="text-link" rel="next" href="/history/${next}">Next month: ${escapeHtml(monthLabel(next))}</a>` : ""}</nav>` : "";
  const older = [...new Set(records.filter(record => Date.parse(record.timestamp) < cutoff).map(record => monthKey(record.timestamp, model.settings.timezone)))].sort().reverse();
  const archive = !selectedMonth && older.length ? `<section class="history-month"><h2>Earlier history</h2><ul>${older.map(month => `<li><a class="text-link" href="/history/${month}">${escapeHtml(monthLabel(month))}</a></li>`).join("")}</ul></section>` : "";
  const introduction = selectedMonth ? `Resolved incidents and completed or cancelled maintenance in ${monthLabel(selectedMonth)}.` : "Resolved incidents and completed or cancelled maintenance from the last 12 months. For active incidents and upcoming maintenance, return to current status.";
  return `<section class="history"><header class="history-intro"><h1>${selectedMonth ? escapeHtml(monthLabel(selectedMonth)) : "Resolved history"}</h1><p>${escapeHtml(introduction)}</p></header>${navigation}${[...groups].map(([month, entries]) => `<section class="history-month"><h2>${escapeHtml(monthLabel(month))}</h2>${entries.join("")}</section>`).join("") || '<p class="empty-state">No past incidents or maintenance in the last 12 months.</p>'}${archive}${navigation}</section>`;
}
