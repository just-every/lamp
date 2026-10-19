import type { AvailabilityReport } from "./types";

/** Built-in Courier needs no remote font. Non-ASCII code points are shown
 * explicitly, rather than silently replacing names; ActualText retains Unicode
 * for accessible extraction. All emitted bytes are ASCII, so xref offsets agree. */
function visibleText(value: string): string {
  return Array.from(value).map(character => {
    const code = character.codePointAt(0)!;
    return code >= 32 && code <= 126 ? character : /\s/u.test(character) ? " " : `[U+${code.toString(16).toUpperCase().padStart(4, "0")}]`;
  }).join("");
}
const literal = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
function unicodeHex(value: string): string {
  return "FEFF" + Array.from({ length: value.length }, (_, index) => value.charCodeAt(index).toString(16).padStart(4, "0")).join("");
}
function wrap(value: string): string[] {
  const text = visibleText(value), lines: string[] = [];
  for (let offset = 0; offset < text.length; offset += 88) lines.push(text.slice(offset, offset + 88));
  return lines.length ? lines : [""];
}

export function availabilityPdf(report: AvailabilityReport): Uint8Array<ArrayBuffer> {
  const paragraphs = [
    "Availability report - claimed", `${report.component.name} (${report.component.id})`, `${report.period} - UTC`,
    `${report.startsAt} inclusive to ${report.endsAt} exclusive`, `Observed through ${report.observedUntil}; generated ${report.generatedAt}`,
    `Claimed uptime: ${report.uptime ?? "No data"}`, `Weighted downtime minutes: ${report.downtimeMinutes ?? "No data"}`,
    `Tracking since: ${report.trackingSince ?? "No data"}; ${report.coverageDays} whole days covered`, "", report.method, "",
    `Incidents (${report.incidents.length})`,
    ...report.incidents.flatMap(record => [`${record.reference} | ${record.title} | ${record.state}`, `${record.id} | ${record.startsAt} to ${record.endsAt ?? "ongoing"}`]),
    "", `Maintenance (${report.maintenance.length})`,
    ...report.maintenance.flatMap(record => [`${record.reference} | ${record.title} | ${record.state}`, `${record.id} | ${record.startsAt} to ${record.endsAt ?? "ongoing"}`]),
    "", "Characters outside ASCII are displayed as [U+code point]; Unicode text is retained for extraction.",
  ];
  const lines = paragraphs.flatMap(paragraph => wrap(paragraph).map((text, index) => ({ text, original: index === 0 ? paragraph : "" })));
  const pages = Array.from({ length: Math.ceil(lines.length / 48) }, (_, index) => lines.slice(index * 48, (index + 1) * 48));
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"];
  const pageIds: number[] = [];
  for (const [index, page] of pages.entries()) {
    const pageId = objects.length + 1, streamId = pageId + 1;
    pageIds.push(pageId);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    const body = `BT /F1 10 Tf 36 756 Td 14 TL\n${page.map(line => `/Span << /ActualText <${unicodeHex(line.original)}> >> BDC (${literal(line.text)}) Tj EMC T*`).join("\n")}\nET\nBT /F1 9 Tf 36 30 Td (Page ${index + 1} of ${pages.length}) Tj ET\n`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] >>`;
  let document = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, index) => { offsets.push(document.length); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = document.length;
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(document);
}
