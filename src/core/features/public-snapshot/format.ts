export const MINUTE = 60_000;

export const DAY = 86_400_000;
export const REPORTING_DAYS = 90;

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function xmlSafe(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // XML 1.0 excludes these controls. Preserve valid surrogate pairs and
    // drop unpaired code units so operator prose cannot corrupt Atom.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following < 0xdc00 || following > 0xdfff) continue;
      result += value[index] + value[index + 1];
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    result += value[index];
  }
  return result;
}

export function escapeXml(value: string) {
  return escapeHtml(xmlSafe(value));
}

function validDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("A public timestamp is invalid.");
  return date;
}

function dateFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function formatTime(value: string, timezone: string) {
  const date = validDate(value);
  const zoneName = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  if (zoneName === "GMT") return `${dateFormatter(timezone).format(date)} UTC+00:00`;
  const offset = /^GMT([+-]\d{2}:\d{2})$/.exec(zoneName ?? "")?.[1];
  if (!offset) throw new Error("A public timezone offset is invalid.");
  return `${dateFormatter(timezone).format(date)} UTC${offset}`;
}

export function timestamp(value: string, timezone: string) {
  return `<time datetime="${escapeHtml(value)}" data-local-time>${escapeHtml(formatTime(value, timezone))}</time>`;
}

export function dateLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(validDate(value));
}

export function durationText(startsAt: string, endsAt: string) {
  const minutes = Math.max(0, Math.round((validDate(endsAt).getTime() - validDate(startsAt).getTime()) / MINUTE));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function stateClass(state: string) {
  return state.toLowerCase().replaceAll(" ", "-");
}

export function dayKey(value: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (kind: string) => parts.find((entry) => entry.type === kind)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export function localMidnight(day: string, timezone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const approximate = Date.UTC(year, month - 1, date);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(approximate));
  const part = (kind: string) => Number(parts.find((entry) => entry.type === kind)?.value ?? 0);
  return approximate + (approximate - Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")));
}
