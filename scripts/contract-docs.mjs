// Incremental generation while ct owns conversion of the remaining legacy clauses.
// Only named clause entries and the shared counts change; other entries stay intact.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseContract } from '@runeditrun/rer/internal/foundation/runtime/seed-contract.mjs';

const [verb, ...arguments_] = process.argv.slice(2);
const mapIndex = arguments_.indexOf('--citation-map');
const mapPath = mapIndex < 0 ? null : arguments_.splice(mapIndex, 2)[1];
if (mapIndex >= 0 && !mapPath) throw Error('--citation-map needs a path.');
const ids = arguments_;
if (!['write', 'check'].includes(verb) || !ids.length || ids.some(id => !/^[A-Z][A-Z0-9-]*-\d{3}$/.test(id))) {
  throw Error('Usage: node scripts/contract-docs.mjs write|check CLAUSE-ID... [--citation-map PATH]');
}
const read = path => readFileSync(path, 'utf8');
const citationMap = mapPath ? JSON.parse(read(mapPath)) : {};
for (const [before, after] of Object.entries(citationMap)) {
  if (!/^tests\/[\w./-]+\.(?:mjs|ts)$/.test(before) || !/^tests\/[\w./-]+\.(?:mjs|ts)$/.test(after) || !existsSync(after)) throw Error('Citation maps must name test paths and existing destinations.');
}
const citations = text => text.replace(/tests\/[\w./-]+\.(?:mjs|ts)\b/g, path => citationMap[path] ?? path);
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim());
const escapeCell = text => text.replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
const original = citations(read('CONTRACT.md'));
const lines = original.split('\n');
const summaryStart = lines.findIndex(line => line === '| Clauses | Done | Partial | Missing | Total |');
if (summaryStart < 0) throw Error('The contract summary is absent.');
let summaryEnd = summaryStart + 2;
while (lines[summaryEnd]?.startsWith('|')) summaryEnd++;
const withoutSummary = [...lines.slice(0, summaryStart), ...lines.slice(summaryEnd)].join('\n');
const contract = parseContract(withoutSummary);
const tally = clauses => ['done', 'partial', 'missing'].map(status => clauses.filter(clause => clause.status === status).length);
const summary = (label, clauses) => `| ${label} | ${[...tally(clauses), clauses.length].join(' | ')} |`;
const published = contract.clauses.filter(clause => clause.kind === 'published');
const target = contract.clauses.filter(clause => clause.kind !== 'published');
lines.splice(summaryStart + 2, summaryEnd - summaryStart - 2,
  summary('Published', published), summary('Target and push further', target), summary('All', contract.clauses));
let source = lines.join('\n');
const [done, partial, missing] = tally(contract.clauses);
source = source.replace(/^Of \d+ clauses, .+\(\d+ non-DONE\)\.$/m,
  `Of ${contract.clauses.length} clauses, ${done} are done, ${partial} partial and ${missing} missing (${partial + missing} non-DONE).`);
let acceptance = citations(read('ACCEPTANCE.md'));
let claims = citations(read('docs/CLAIMS.md'));
const targetCounts = tally(target);
acceptance = acceptance.replace(/^### Target and push further clauses \(.+\)$/m,
  `### Target and push further clauses (${target.length}: ${targetCounts[0]} done, ${targetCounts[1]} partial, ${targetCounts[2]} missing)`);
for (const id of ids) {
  const clause = contract.clauses.find(clause => clause.id === id);
  if (!clause) throw Error(`Unknown clause ${id}.`);
  const row = original.split('\n').find(line => line.startsWith(`| \`${id}\` |`));
  const [, , , , evidence, gap] = cells(row);
  const start = lines.findIndex(line => line.startsWith(`#### ${id} `));
  // A citation migration preserves legacy acceptance prose and judgments.
  if (start < 0 && mapPath) continue;
  if (start < 0) throw Error(`${id} needs the standard level-four heading.`);
  let end = start + 1;
  while (end < lines.length && !/^#{2,4} /.test(lines[end])) end++;
  const body = lines.slice(start + 1, end).join('\n');
  const points = [...body.matchAll(/^([1-8])\. (.+)$/gm)];
  if (!points.length && mapPath) continue;
  if (!points.length || points.some((point, index) => Number(point[1]) !== index + 1)) throw Error(`${id} needs numbered acceptance points.`);
  const assertions = escapeCell(points.map(point => point[2]).join(' '));
  const entry = `| ${id} | ${escapeCell(clause.title)} | ${clause.status} | ${assertions} | ${escapeCell(evidence + (gap ? ` Gap: ${gap}` : ''))} |`;
  const acceptanceLines = acceptance.split('\n');
  const index = acceptanceLines.findIndex(line => line.startsWith(`| ${id} |`));
  if (index < 0) throw Error(`ACCEPTANCE.md lacks ${id}; do not silently omit a clause.`);
  acceptanceLines[index] = entry;
  acceptance = acceptanceLines.join('\n');
  const claim = `| ${id} | ${clause.status} | ${escapeCell(evidence)} | ${escapeCell(gap)} |`;
  const claimLines = claims.trimEnd().split('\n');
  const claimIndex = claimLines.findIndex(line => line.startsWith(`| ${id} |`));
  if (claimIndex < 0) claimLines.push(claim); else claimLines[claimIndex] = claim;
  claims = claimLines.join('\n') + '\n';
}
const changed = [];
for (const [path, text] of Object.entries({ 'CONTRACT.md': source, 'ACCEPTANCE.md': acceptance, 'docs/CLAIMS.md': claims })) {
  for (const match of text.matchAll(/tests\/[\w./-]+\.(?:mjs|ts)\b/g)) {
    if (!existsSync(match[0])) throw Error(`${path} cites missing test evidence: ${match[0]}`);
  }
  if (read(path) === text) continue;
  changed.push(path);
  if (verb === 'write') writeFileSync(path, text);
}
if (verb === 'check' && changed.length) throw Error(`Generated documents differ: ${changed.join(', ')}. Run contract-docs write with the touched clause IDs.`);
console.log(verb === 'check' ? 'Contract documents are current.' : `Generated ${changed.length} documents for ${ids.join(', ')}.`);
