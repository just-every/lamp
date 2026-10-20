import { createUlid } from "../../shared/ids";
import { catalogueSchema, type ComponentCatalogue } from "./catalogue-schema";

const COLUMNS = new Set(["id", "name", "group", "description", "display_order", "group_order", "internal", "only_show_if_degraded", "uptime_start_date", "note", "action"]);

function csvRows(text: string) {
  if (text.length > 1_000_000) throw new Error("The CSV must be at most 1 MB.");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, afterQuote = false;
  const input = text.replace(/^\uFEFF/u, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; afterQuote = true; }
      else field += character;
    } else if (character === ",") { row.push(field); field = ""; afterQuote = false; }
    else if (character === "\n" || character === "\r") {
      row.push(field); rows.push(row); row = []; field = ""; afterQuote = false;
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else if (character === '"' && field.length === 0 && !afterQuote) quoted = true;
    else {
      if (character === '"' || afterQuote) throw new Error(`CSV row ${rows.length + 1} has an invalid quoted field.`);
      field += character;
    }
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (field || row.length || afterQuote) { row.push(field); rows.push(row); }
  return rows;
}

function boolean(value: string, column: string, row: number) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0" || value === "") return false;
  throw new Error(`CSV row ${row}: ${column} must be true or false.`);
}

function order(value: string, column: string, row: number) {
  if (!/^\d+$/u.test(value)) throw new Error(`CSV row ${row}: ${column} must be a non-negative integer.`);
  return Number(value);
}

/** CSV is a merge: existing rows remain unless action=delete explicitly names their ID. */
export function catalogueFromCsv(csv: string, current: ComponentCatalogue): ComponentCatalogue {
  const rows = csvRows(csv);
  const headers = rows.shift()?.map(column => column.trim().toLowerCase()) ?? [];
  if (!headers.includes("name") || new Set(headers).size !== headers.length || headers.some(column => !COLUMNS.has(column))) throw new Error(`CSV needs a name column and unique supported headers: ${[...COLUMNS].join(", ")}.`);
  if (rows.length === 0 || rows.length > 1000) throw new Error("Choose a CSV with 1 to 1000 component rows.");
  const catalogue: ComponentCatalogue = structuredClone(current);
  const touched = new Set<string>();
  rows.forEach((cells, index) => {
    const number = index + 2;
    if (cells.length !== headers.length) throw new Error(`CSV row ${number} has ${cells.length} cells; expected ${headers.length}.`);
    const values = Object.fromEntries(headers.map((column, cell) => [column, cells[cell]!]));
    const id = values.id?.trim() || createUlid();
    if (touched.has(id)) throw new Error(`CSV row ${number} repeats a component ID.`);
    touched.add(id);
    const existing = catalogue.components.find(component => component.id === id);
    if (values.id?.trim() && !existing) throw new Error(`CSV row ${number} names an unknown component ID.`);
    const action = values.action?.trim().toLowerCase() || "upsert";
    if (action === "delete") {
      if (!existing) throw new Error(`CSV row ${number}: deleting a component requires its ID.`);
      catalogue.components = catalogue.components.filter(component => component.id !== id);
      return;
    }
    if (action !== "upsert") throw new Error(`CSV row ${number}: action must be upsert or delete.`);
    let groupId = existing?.groupId ?? null;
    if (values.group !== undefined) {
      const name = values.group.trim();
      const matches = catalogue.groups.filter(group => group.name === name);
      if (matches.length > 1) throw new Error(`CSV row ${number}: group ${name} is ambiguous; rename the duplicate groups first.`);
      let group = matches[0];
      if (name && !group) {
        group = { id: createUlid(), name, displayOrder: Math.max(-1, ...catalogue.groups.map(item => item.displayOrder)) + 1 };
        catalogue.groups.push(group);
      }
      groupId = name ? group!.id : null;
      if (group && values.group_order?.trim()) group.displayOrder = order(values.group_order.trim(), "group_order", number);
    }
    const component = {
      id, groupId,
      name: values.name.trim(),
      description: values.description ?? existing?.description ?? "",
      region: existing?.region ?? null,
      displayOrder: values.display_order?.trim() ? order(values.display_order.trim(), "display_order", number) : existing?.displayOrder ?? Math.max(-1, ...catalogue.components.map(item => item.displayOrder)) + 1,
      note: values.note ?? existing?.note ?? "",
      internal: values.internal !== undefined ? boolean(values.internal.trim().toLowerCase(), "internal", number) : existing?.internal ?? false,
      onlyShowIfDegraded: values.only_show_if_degraded !== undefined ? boolean(values.only_show_if_degraded.trim().toLowerCase(), "only_show_if_degraded", number) : existing?.onlyShowIfDegraded ?? false,
      uptimeStartDate: values.uptime_start_date !== undefined ? values.uptime_start_date.trim() || null : existing?.uptimeStartDate ?? null,
    };
    catalogue.components = catalogue.components.filter(item => item.id !== id);
    catalogue.components.push(component);
  });
  return catalogueSchema.parse(catalogue);
}
