import type { D1Sql, TargetRow } from "../../../../modules/import-kit/src/d1/index.ts";
import type { NativeValue, Row } from "./rows";
import { allMarkers, markerTable, markerWhere, nativeKinds, sealedDefaults, tablesOf } from "./native-tables";

/** A full-set fence for every imported native target whose size does not grow
 * with the rows it covers. Each marker (kind, id, revision) and each row an
 * entity owns is rendered to one canonical text, identically in JS and SQL, and
 * hashed as a polynomial over the hex digits of its UTF-8 bytes in four
 * independent prime fields (124 bits). Bytes, not characters: SQLite's
 * length(), substr() and unicode() stop at U+0000, while hex() and a BLOB cast
 * read every stored byte, as JS's TextEncoder does. The set digest is a count plus a nonlinear sum of item hashes, so
 * any added, removed or edited row, column or marker changes it. D1 has no hash
 * function, so SQL evaluates the same polynomial with integer arithmetic. */

const lanes = [0, 1, 2, 3] as const;
const P = [2147483647n, 2147483629n, 2147483587n, 2147483579n];
const B = [1000003n, 999983n, 1000033n, 1299709n];
// Nine hex digits (< 2^7 each) form one 63-bit unit; units are read in
// 144-digit chunks of 9216-digit spans so long text is never rescanned per
// unit. SQL hexes each span's 4608 bytes on its own, so no value outgrows its text.
const UNIT = 9, CHUNK = 144, SPAN = 9216, SPAN_BYTES = SPAN / 2;
const DIGIT = 128n, digitWeights = Array.from({ length: UNIT }, (_, index) => DIGIT ** BigInt(UNIT - 1 - index));
const utf8 = new TextEncoder(), HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).toUpperCase().padStart(2, "0"));
const hexOf = (text: string) => { let hex = ""; for (const byte of utf8.encode(text)) hex += HEX[byte]; return hex; };
const pow = (base: bigint, exponent: number, modulus: bigint) => { let result = 1n; for (let n = 0; n < exponent; n++) result = result * base % modulus; return result; };
const chunkWeight = lanes.map((l) => pow(B[l], CHUNK / UNIT, P[l])), spanWeight = lanes.map((l) => pow(B[l], SPAN / UNIT, P[l]));

const name = (value: string) => { if (!/^\w+$/u.test(value)) throw new Error("Invalid native column."); return value; };

/** Self-delimiting value text: typeof tag plus content, as SQLite reports it. */
function encode(value: unknown): string {
  if (value === null) return "n";
  if (typeof value === "string") return `t${utf8.encode(value).length}:${value}`;
  if (typeof value === "number" && Number.isSafeInteger(value)) return `i${value};`;
  // A non-integral number compares by SQLite's own text for it; any mismatch fails closed.
  if (typeof value === "number") return `real:${value};`;
  throw new Error("Unsupported native value.");
}
const encodeSql = (x: string) => `CASE typeof(${x}) WHEN 'null' THEN 'n' WHEN 'text' THEN 't'||length(CAST(${x} AS BLOB))||':'||${x} WHEN 'integer' THEN 'i'||${x}||';' ELSE typeof(${x})||':'||${x}||';' END`;
const literal = (value: Row[string]) => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;

function columnsOf(table: string, rows: readonly Row[]) {
  return [...new Set([...rows.flatMap((row) => Object.keys(row)), ...Object.keys(sealedDefaults[table] ?? {})])].map(name).sort();
}
function renderRow(table: string, columns: string[], row: Row) {
  const defaults = sealedDefaults[table] ?? {};
  return columns.map((column) => {
    if (column in defaults && (!(column in row) || row[column] === defaults[column])) return "";
    return column in row ? `${column}=${encode(row[column])}` : `${column}=u`;
  }).join("");
}
function renderRowSql(table: string, columns: string[]) {
  const defaults = sealedDefaults[table] ?? {};
  return columns.map((column) => {
    const value = `'${column}='||${encodeSql(`x.${column}`)}`;
    return column in defaults ? `(CASE WHEN x.${column} IS ${literal(defaults[column])} THEN '' ELSE ${value} END)` : value;
  }).join("||") || "''";
}
const rowPrefix = (kind: string, table: string) => `r${encode(kind)}${encode(table)}`;

function itemHash(text: string): bigint[] {
  const hex = hexOf(text), units: bigint[] = [];
  for (let index = 0; index < hex.length; index += UNIT) {
    let unit = 0n;
    for (let digit = 0; digit < UNIT; digit++) unit += BigInt(hex.charCodeAt(index + digit) || 0) * digitWeights[digit];
    units.push(unit);
  }
  return lanes.map((l) => {
    let hash = BigInt(hex.length) % P[l], weight = 1n;
    for (const unit of units) {
      weight = weight * B[l] % P[l];
      hash = (hash + unit % P[l] * weight) % P[l];
    }
    return hash;
  });
}

function setDigest(texts: string[]) {
  const sums = lanes.map(() => 0n);
  for (const text of texts) {
    const hash = itemHash(text);
    for (const l of lanes) sums[l] = (sums[l] + hash[l] * hash[(l + 1) % 4] % P[l] + hash[l]) % P[l];
  }
  return JSON.stringify([texts.length, ...sums.map(Number)]);
}

/** The set digest of one item query's texts. D1 allows five terms per compound
 * SELECT, so each marker set and owned table is its own predicate. */
function digestSql(items: string) {
  const each = (f: (l: number) => string) => lanes.map(f).join(",");
  return `(WITH RECURSIVE
items(k,t) AS MATERIALIZED (SELECT row_number() OVER (),CAST(t AS BLOB) FROM (${items})),
spans(s,${each((l) => `w${l}`)}) AS (SELECT 0,1,1,1,1 UNION ALL SELECT s+1,${each((l) => `w${l}*${spanWeight[l]}%${P[l]}`)} FROM spans WHERE (s+1)*${SPAN_BYTES}<(SELECT max(length(t)) FROM items)),
chunks(c,${each((l) => `w${l}`)}) AS (SELECT 0,1,1,1,1 UNION ALL SELECT c+1,${each((l) => `w${l}*${chunkWeight[l]}%${P[l]}`)} FROM chunks WHERE c<${SPAN / CHUNK - 1}),
units(u,${each((l) => `w${l}`)}) AS (SELECT 0,${each((l) => String(B[l]))} UNION ALL SELECT u+1,${each((l) => `w${l}*${B[l]}%${P[l]}`)} FROM units WHERE u<${CHUNK / UNIT - 1}),
parts(k,${each((l) => `w${l}`)},p) AS MATERIALIZED (SELECT k,${each((l) => `spans.w${l}`)},hex(substr(t,s*${SPAN_BYTES}+1,${SPAN_BYTES})) FROM items JOIN spans ON s*${SPAN_BYTES}<length(t)),
pieces(k,${each((l) => `w${l}`)},q) AS MATERIALIZED (SELECT k,${each((l) => `parts.w${l}*chunks.w${l}%${P[l]}`)},substr(p,c*${CHUNK}+1,${CHUNK}) FROM parts JOIN chunks ON c*${CHUNK}<length(p)),
terms(k,${each((l) => `w${l}`)},v) AS MATERIALIZED (SELECT k,1,1,1,1,2*length(t) FROM items UNION ALL SELECT k,${each((l) => `pieces.w${l}*units.w${l}%${P[l]}`)},${digitWeights.map((weight, digit) => `coalesce(unicode(substr(q,u*${UNIT}+${digit + 1},1)),0)*${weight}`).join("+")} FROM pieces JOIN units ON u*${UNIT}<length(q)),
hashes(${each((l) => `h${l}`)}) AS (SELECT ${each((l) => `sum(v%${P[l]}*w${l}%${P[l]})%${P[l]}`)} FROM terms GROUP BY k)
SELECT json_array(count(*),${each((l) => `coalesce(sum(h${l}*h${(l + 1) % 4}%${P[l]}+h${l}),0)%${P[l]}`)}) FROM hashes)`;
}

/** Exact, nonempty full-set predicates: a count per kind, then a digest of the
 * revision markers and of each owned table, compared with the values held. */
export function matchesAll(rows: TargetRow[]): D1Sql[] {
  const counts: Record<string, number> = {}, owned = new Map<string, Array<{ id: string; record: Row }>>();
  const markers = rows.map((row) => {
    counts[row.targetKind] = (counts[row.targetKind] ?? 0) + 1;
    for (const table of Object.keys(tablesOf(row.targetKind))) {
      const entries = owned.get(table) ?? [];
      owned.set(table, entries);
      for (const record of (row.value as unknown as NativeValue).tables[table] ?? []) entries.push({ id: row.targetId, record });
    }
    return `m${encode(row.targetKind)}${encode(row.targetId)}${encode(row.revision ?? null)}`;
  });
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a < b ? -1 : 1));
  const guards: D1Sql[] = [
    { sql: `(SELECT json_group_object(kind,n) FROM (SELECT kind,count(*) AS n FROM (${allMarkers}) GROUP BY kind ORDER BY kind))=?`, params: [JSON.stringify(sorted)] },
    { sql: `${digestSql(`SELECT 'm'||${encodeSql("kind")}||${encodeSql("id")}||${encodeSql("revision")} AS t FROM (${allMarkers})`)}=?`, params: [setDigest(markers)] },
  ];
  for (const kind of nativeKinds) for (const [table, column] of Object.entries(tablesOf(kind))) {
    const entries = owned.get(table) ?? [], columns = columnsOf(table, entries.map((entry) => entry.record));
    const select = `SELECT '${rowPrefix(kind, table)}'||${encodeSql("m.id")}||${renderRowSql(table, columns)} AS t FROM ${markerTable(kind)} m JOIN ${table} x ON x.${name(column)}=m.id${markerWhere(kind).params.length ? ` WHERE m.kind='${kind}'` : ""}`;
    guards.push({ sql: `${digestSql(select)}=?`, params: [setDigest(entries.map((entry) => `${rowPrefix(kind, table)}${encode(entry.id)}${renderRow(table, columns, entry.record)}`))] });
  }
  return guards;
}
