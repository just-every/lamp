import { readFile } from "node:fs/promises";

export const baselineId = /^BASE-[A-Z][A-Z0-9]*-[0-9]{3}$/;
const clauseLine = /^- \*\*(BASE-[A-Z][A-Z0-9]*-[0-9]{3}) — ([^.]+)\./gm;
const contractLine = /^- \*\*([A-Z][A-Z0-9-]*-[0-9]{3}) —/gm;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

export async function readBaselineCatalog(baselinePath = "BASELINE.md", contractPath = "CONTRACT.md") {
  const [baseline, contract] = await Promise.all([readFile(baselinePath, "utf8"), readFile(contractPath, "utf8")]);
  const clauses = new Map();
  let match;
  while ((match = clauseLine.exec(baseline)) !== null) {
    const [id, title] = match.slice(1);
    if (clauses.has(id)) throw new Error(`BASELINE.md defines ${id} more than once.`);
    clauses.set(id, { id, title, line: lineOf(baseline, match.index), supersededBy: [] });
  }
  if (!clauses.size) throw new Error("BASELINE.md does not contain any BASE clauses.");

  const contractClauses = [];
  while ((match = contractLine.exec(contract)) !== null) contractClauses.push({ id: match[1], start: match.index, line: lineOf(contract, match.index) });
  for (let index = 0; index < contractClauses.length; index += 1) {
    const source = contractClauses[index];
    const body = contract.slice(source.start, contractClauses[index + 1]?.start ?? contract.length);
    for (const supersedes of body.matchAll(/\bSupersedes\s+(BASE-[A-Z][A-Z0-9]*-[0-9]{3})\b([^.]*)\./gi)) {
      const id = supersedes[1].toUpperCase();
      const clause = clauses.get(id);
      if (!clause) throw new Error(`${source.id} names unknown baseline clause ${id}.`);
      const suffix = supersedes[2].replaceAll("**", "").trim();
      clause.supersededBy.push({ contractId: source.id, scope: suffix ? suffix.replace(/^for\s+/i, "") : "entire clause", line: source.line });
    }
  }
  return clauses;
}
