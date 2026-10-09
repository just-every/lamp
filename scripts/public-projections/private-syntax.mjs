// The pinned Node runtime supplies Acorn with --expose-internals. This private
// proof is not a public verification dependency and fails if that parser is absent.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {hash,json,git} from '../edition-authoring/files.mjs';
import {readOriginal,projectFile} from './archive.mjs';
import {snapshot} from '../edition-authoring/sources.mjs';
import {verifyProjections} from './verify.mjs';
const {parse}=createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');
const [privateStore,reportPath]=process.argv.slice(2);
if(!privateStore||!reportPath||[privateStore,reportPath].some(p=>path.resolve(p).startsWith(process.cwd()+path.sep)))throw Error('Usage: node --expose-internals private-syntax.mjs PRIVATE_ORIGINALS PRIVATE_REPORT');
const plan=JSON.parse(fs.readFileSync('scripts/public-projections/plan.json')),receipt=verifyProjections(process.cwd());
const report={schemaVersion:1,node:process.version,parser:'Acorn supplied by pinned Node with --expose-internals',sourceCommit:git(process.cwd(),'rev-parse','HEAD'),sourceTree:git(process.cwd(),'write-tree'),members:[]};
// Compare every syntax node and operator; only literal payloads can differ.
// Separately, construction proves every byte outside exact approved edits equal.
function skeleton(node){
  if(Array.isArray(node))return node.map(skeleton);
  if(node===null||typeof node!=='object')return node;
  if(node.type==='TemplateElement')return {type:'TemplateElement',tail:node.tail};
  if(node.type==='Literal')return {type:'Literal',payloadType:node.regex?'regexp':typeof node.value,...(node.regex?{flags:node.regex.flags}:{})};
  return Object.fromEntries(Object.entries(node).filter(([k])=>!['start','end','loc','range'].includes(k)).map(([k,v])=>[k,skeleton(v)]));
}
for(const entry of receipt.archives){
  const spec=plan.archives.find(a=>a.originalKey===entry.originalKey),original=readOriginal(privateStore,spec),projected=snapshot(process.cwd(),entry.origin);
  for(const [name,rule] of Object.entries(spec.members)){
    if(!name.endsWith('.mjs')||rule.omit)continue;
    const before=Buffer.from(original.files[name].data,'base64'),after=Buffer.from(projected.files[name].data,'base64');
    assert.deepEqual(projectFile(before,rule),after);
    const first=parse(before.toString(),{ecmaVersion:'latest',sourceType:'module'}),second=parse(after.toString(),{ecmaVersion:'latest',sourceType:'module'});
    assert.deepEqual(skeleton(first),skeleton(second),`Syntax or nonliteral semantics changed in ${name}`);
    const cases=tree=>{const names=[];const visit=n=>{if(!n||typeof n!=='object')return;if(n.type==='CallExpression'&&n.callee?.name==='test')names.push(n.arguments[0]?.value);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(typeof v==='object')visit(v);};visit(tree);return names;};
    assert.deepEqual(cases(first),cases(second));
    report.members.push({selector:entry.selector,path:name,originalSha256:hash(before),projectedSha256:hash(after),syntaxSkeletonSha256:hash(json(skeleton(first))),testCases:cases(first),exactConstruction:true});
  }
}
report.ok=true;fs.writeFileSync(reportPath,json(report),{mode:0o600});console.log(json({ok:true,members:report.members.length}));
