// Preserve this edition's published document shape while deriving touched rows
// and all summary counts from its authoritative contract Status table.
import fs from 'node:fs';
import { parseContract } from '../src/base/seed-contract.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['write','check'].includes(command)) throw Error('Use contract-docs.mjs write or check with --clauses and comma-separated clause ids.');
const option=args.indexOf('--clauses');
const selected=new Set((option<0?'':args[option+1]??'').split(',').filter(Boolean));
if (!selected.size) throw Error('Name the touched clauses with --clauses.');
const original=fs.readFileSync('CONTRACT.md','utf8');
const cells=line=>line.split(/(?<!\\)\|/).slice(1,-1).map(cell=>cell.trim());
const rows=original.split('\n').filter(line=>/^\| `[A-Z][A-Z0-9-]*-\d{3}` \|/.test(line)).map(cells);
const counts=group=>['done','partial','missing'].map(state=>group.filter(row=>row[3]===state).length);
let source=original;
for(const [label,group] of [['Published',rows.filter(row=>row[2]==='published')],['Target and push further',rows.filter(row=>row[2]!=='published')],['All',rows]]) {
  const line=`| ${label} | ${counts(group).join(' | ')} | ${group.length} |`;
  source=source.split('\n').map(old=>old.startsWith(`| ${label} |`)?line:old).join('\n');
}
const [done,partial,missing]=counts(rows);
source=source.replace(/^Of \d+ clauses, .*$/m,`Of ${rows.length} clauses, ${done} are done, ${partial} partial and ${missing} missing (${partial+missing} non-DONE).`);
const contract=parseContract(source);
for(const id of selected)if(!contract.clauses.some(clause=>clause.id===id))throw Error(`Unknown clause ${id}`);
const rowById=new Map(rows.map(row=>[row[0].replaceAll('`',''),row]));
const escape=text=>text.replaceAll('|','\\|').replace(/\s+/g,' ').trim();
let acceptance=fs.readFileSync('ACCEPTANCE.md','utf8');
let claims=fs.readFileSync('docs/CLAIMS.md','utf8');
for(const clause of contract.clauses.filter(clause=>selected.has(clause.id))) {
  const row=rowById.get(clause.id), evidence=row[4], gap=row[5];
  const acceptanceText=clause.text.match(/Acceptance:\s*(.*?)(?=\s+Status:|$)/)?.[1]??clause.text;
  const current=[evidence,gap?`Gap: ${gap}`:''].filter(Boolean).join(' ');
  const acceptanceRow=clause.kind==='published'
    ? `| ${clause.id} | ${clause.title} | ${clause.status} | ${evidence} |`
    : `| ${clause.id} | ${clause.title} | ${clause.status} | ${escape(acceptanceText)} | ${current} |`;
  const matcher=new RegExp(`^\\| ${clause.id} \\|.*$`,'m');
  if(!matcher.test(acceptance))throw Error(`ACCEPTANCE.md is missing ${clause.id}`);
  acceptance=acceptance.replace(matcher,()=>acceptanceRow);
  const claimRow=`| ${clause.id} | ${clause.status} | ${evidence} | ${gap||'None.'} |`;
  claims=matcher.test(claims)?claims.replace(matcher,()=>claimRow):claims.trimEnd()+'\n'+claimRow+'\n';
}
const published=rows.filter(row=>row[2]==='published'), targets=rows.filter(row=>row[2]!=='published');
acceptance=acceptance.replace(/^### Released clauses .*$/m,`### Released clauses (${published.length}, ${counts(published)[0]} done)`)
  .replace(/^### Target and push further clauses .*$/m,`### Target and push further clauses (${targets.length}: ${counts(targets)[0]} done, ${counts(targets)[1]} partial, ${counts(targets)[2]} missing)`);
for(const [path,text] of Object.entries({'CONTRACT.md':source,'ACCEPTANCE.md':acceptance,'docs/CLAIMS.md':claims})) {
  if(command==='write')fs.writeFileSync(path,text);
  else if(fs.readFileSync(path,'utf8')!==text)throw Error(`${path} is stale; regenerate the touched contract documents.`);
}
console.log(command==='write'?'Contract documents regenerated.':'Contract documents are current.');
