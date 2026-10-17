import { wordingText, type NoticeSnapshot } from "../maintenance/wording";

/** RFC 5545 text escaping precedes octet folding. Continuation whitespace counts
 * toward the 75-octet limit and no Unicode code point is split. */
function text(value: string) { return value.replaceAll("\\","\\\\").replace(/\r\n|\r|\n/g,"\\n").replaceAll(";","\\;").replaceAll(",","\\,"); }
function fold(line: string) {
  const lines: string[]=[]; let part=""; let bytes=0;
  for(const character of line) { const size=new TextEncoder().encode(character).length; if(bytes+size>75) {lines.push(part);part=" ";bytes=1;} part+=character;bytes+=size; }
  lines.push(part); return lines.join("\r\n");
}
function instant(value: string) { return new Date(value).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"); }
export interface CalendarMaintenance extends Partial<NoticeSnapshot> { id:string;title:string;state:string;startsAt:string;endsAt:string;updatedAt?:string;calendarSequence?:number }
export function maintenanceCalendar(items: CalendarMaintenance[], origin: string, generatedAt: string, method: "PUBLISH" | "CANCEL" = "PUBLISH") {
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Lamp//Maintenance//EN","CALSCALE:GREGORIAN",`METHOD:${method}`];
  for(const item of items) lines.push("BEGIN:VEVENT",`UID:lamp-maintenance-${item.id}@lamp`,`SEQUENCE:${item.calendarSequence ?? 0}`,`DTSTAMP:${instant(item.updatedAt ?? generatedAt)}`,`DTSTART:${instant(item.startsAt)}`,`DTEND:${instant(item.endsAt)}`,`SUMMARY:${text(item.title)}`,`DESCRIPTION:${text([item.state,wordingText(item)].filter(Boolean).join("\n\n"))}`,`URL:${origin}/maintenance/${encodeURIComponent(item.reference ?? item.id)}`,`STATUS:${item.state === "Cancelled" ? "CANCELLED" : "CONFIRMED"}`,"END:VEVENT");
  return [...lines,"END:VCALENDAR"].map(fold).join("\r\n")+"\r\n";
}
