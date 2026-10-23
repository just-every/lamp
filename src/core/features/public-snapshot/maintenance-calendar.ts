import type { PublicSnapshotModel } from "./renderer";

// RFC 5545 TEXT escaping and UTF-8 octet folding. Continuations include their
// leading space in the 75-octet limit and never split a Unicode code point.
function text(value: string) {
  return value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}
function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "", current = "", size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > 75) { result += current + "\r\n"; current = " "; size = 1; }
    current += character; size += bytes;
  }
  return result + current;
}
function instant(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Calendar bytes are part of the same retained public generation as the page.
 * Model maintenance already excludes records attached only to internal components.
 * The immutable maintenance id survives rescheduling and hostname changes; the
 * retained notices provide a durable revision counter without rewriting history.
 */
export function renderMaintenanceCalendar(model: PublicSnapshotModel) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lamp//Maintenance calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const item of model.maintenance.filter(item => ["Scheduled", "In progress", "Cancelled"].includes(item.state))) {
    const revisions = item.notices.filter(notice => ["rescheduled", "cancelled"].includes(notice.kind)).length;
    lines.push("BEGIN:VEVENT", `UID:lamp-maintenance-${item.id}@lamp`, `DTSTAMP:${instant(model.generatedAt)}`, `DTSTART:${instant(item.startsAt)}`, `DTEND:${instant(item.endsAt)}`, `SEQUENCE:${revisions}`, `STATUS:${item.state === "Cancelled" ? "CANCELLED" : "CONFIRMED"}`, `SUMMARY:${text(item.title)}`, `DESCRIPTION:${text([item.title, ...item.components].join("\n"))}`, `URL:${model.origin}/maintenance/${encodeURIComponent(item.reference)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
