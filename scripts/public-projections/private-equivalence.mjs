// Private verification only. Normal public verification never invokes this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hash, json, git, tracked, writeTree} from '../edition-authoring/files.mjs';
import {snapshot, source} from '../edition-authoring/sources.mjs';
import {extract, compare} from '../edition-authoring/updates.mjs';
import {readOriginal, projectArchive} from './archive.mjs';
import {semanticComparison} from './semantic.mjs';
import {proveParent} from './private-parent.mjs';
import {verifyProjections} from './verify.mjs';
import {candidate, command as runCommand, commit, identities, normalizeTree} from '../../tests/public-projections/support.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [privateStore, reportPath]=process.argv.slice(2);
if(!privateStore||!reportPath) throw Error('Usage: private-equivalence.mjs <private-original-directory> <private-report>');
for(const directory of [privateStore,reportPath]) if(path.resolve(directory).startsWith(root+path.sep)) throw Error('Private verification inputs and report must be outside public source');
const receipt=verifyProjections(root), plan=JSON.parse(fs.readFileSync(path.join(root,'scripts/public-projections/plan.json')));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lamp-private-equivalence-'));
const details=reportPath+'.details';
if(fs.existsSync(details))throw Error('Private details directory must not exist');
fs.mkdirSync(details,{recursive:true,mode:0o700});
let observation=0;
const artifacts=[];
function observe(label,value){const bytes=json(value),name=String(++observation).padStart(3,'0')+'-'+label+'.json';fs.writeFileSync(path.join(details,name),bytes,{mode:0o600});artifacts.push({name,sha256:hash(bytes)});return value;}
function command(directory,...args){return observe('cli-'+args[0],runCommand(directory,...args));}
const report={schemaVersion:1,recipeSha256:receipt.recipeSha256,node:process.version,sourceCommit:git(root,'rev-parse','HEAD'),sourceTree:git(root,'write-tree'),lockSha256:hash(fs.readFileSync(path.join(root,'sources.lock.json'))),artifacts,consumers:[],archives:[]};
function createRoot(name, original) {
  const destination=path.join(temp,name);fs.mkdirSync(destination);git(destination,'init','--quiet');
  writeTree(destination,tracked(root));
  fs.mkdirSync(path.join(destination,'.edition/sources'),{recursive:true});
  const recipe=JSON.parse(fs.readFileSync(path.join(root,'edition.json')));
  const bootstrapLock=JSON.parse(fs.readFileSync(path.join(root,'sources.lock.json')));
  for(const entry of receipt.archives) {
    const saved=original?readOriginal(privateStore,plan.archives.find(p=>p.originalKey===entry.originalKey)):snapshot(root,entry.origin);
    const expectedSha256=original?entry.originalSha256:entry.sha256;
    assert.equal(hash(json(saved)),expectedSha256,'Private bootstrap must match the independently authenticated archive pin');
    fs.writeFileSync(path.join(destination,'.edition/sources',saved.key+'.json'),json(saved));
    const ref=structuredClone(original?saved.origin:entry.origin);
    delete ref.excludeSnapshots;
    const baseline={key:saved.key,digest:saved.digest,sha256:expectedSha256};
    if(entry.selector==='parent'){recipe.parent=ref;bootstrapLock.parent=baseline;}
    else {
      const component=recipe.components.find(c=>c.id===entry.selector);
      component.source.origin=ref;
      const locked=bootstrapLock.components.find(c=>c.id===entry.selector);
      locked.source=structuredClone(component.source);locked.baseline=baseline;
    }
  }
  fs.writeFileSync(path.join(destination,'edition.json'),json(recipe));
  // Seed explicit authenticated pins in this isolated proof tree before the
  // ordinary lock command. Public readers never get an unpinned bootstrap mode.
  fs.writeFileSync(path.join(destination,'sources.lock.json'),json(bootstrapLock));
  git(destination,'add','-A');command(destination,'lock');commit(destination);
  return destination;
}
try {
  const originalRoot=createRoot('original',true), publicRoot=createRoot('public',false);
  for(const entry of receipt.archives) {
    const original=readOriginal(privateStore,plan.archives.find(p=>p.originalKey===entry.originalKey));
    const projected=snapshot(publicRoot,entry.origin);
    assert.deepEqual(projectArchive(original,plan.archives.find(p=>p.originalKey===entry.originalKey),receipt.recipeSha256),projected);
    assert.deepEqual(projectArchive(original,plan.archives.find(p=>p.originalKey===entry.originalKey),receipt.recipeSha256),projected);
    const originalFiles=source(originalRoot,original.origin), projectedFiles=source(publicRoot,entry.origin);
    const ids=files=>Object.fromEntries(Object.entries(files).map(([n,f])=>[n,{sha256:hash(Buffer.from(f.data,'base64')),executable:f.executable}]));
    assert.deepEqual(normalizeTree(ids(originalFiles),entry),ids(projectedFiles));
    const originalExtract=path.join(temp,entry.key+'-original'), publicExtract=path.join(temp,entry.key+'-public');
    extract(originalRoot,entry.selector,originalExtract);extract(publicRoot,entry.selector,publicExtract);
    assert.deepEqual(normalizeTree(observe('extract-original',identities(originalExtract)),entry),observe('extract-public',identities(publicExtract)));
    const result={selector:entry.selector,originalSha256:entry.originalSha256,projectedSha256:entry.sha256,originalMembers:Object.keys(original.files).length,projectedMembers:Object.keys(projected.files).length,consumers:['snapshot','source','extract','deterministic regeneration']};
    // Preserve all PNG rendering chunks exactly. Metadata is the only retained-image edit.
    for(const [name,file] of Object.entries(projected.files)) {
      const after=Buffer.from(file.data,'base64'),before=Buffer.from(original.files[name].data,'base64');
      if(!after.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))continue;
      const chunks=bytes=>{const result=[];for(let n=8;n<bytes.length;){const end=n+12+bytes.readUInt32BE(n);const kind=bytes.subarray(n+4,n+8).toString();if(!['eXIf','tEXt','zTXt','iTXt','iCCP','caBX','tIME'].includes(kind))result.push(bytes.subarray(n,end));n=end;}return Buffer.concat(result);};
      assert.deepEqual(chunks(before),chunks(after));
    }
    if(entry.selector==='parent') {
      result.parentControls=proveParent({originalRoot,publicRoot,original,projected,entry,temp,observe});
      result.consumers.push('compare whole parent', 'compare independent current source', 'compare exact privacy identities', 'compare 14 presentation omissions', 'compare byte, mode, addition and removal controls');
    } else {
      const incoming=candidate(path.join(temp,entry.key+'-candidate'),projected);
      const compareBoth=()=>{
        const originalResult=observe('compare-original',compare(originalRoot,entry.selector,incoming)), publicResult=observe('compare-public',compare(publicRoot,entry.selector,incoming));
        assert.deepEqual(semanticComparison(originalResult,entry),semanticComparison(publicResult,entry));
        return publicResult;
      };
      compareBoth();
      const member=Object.keys(projected.files).find(n=>n.endsWith('.mjs')||n.endsWith('.ts'));
      const prefix=entry.origin.path==='.'?'':entry.origin.path;
      const target=path.join(incoming,prefix,member);
      fs.appendFileSync(target,'\n// Independent candidate edit.\n');
      fs.chmodSync(target,projected.files[member].executable?0o644:0o755);commit(incoming);
      const modified=compareBoth();assert.equal(modified.upstreamChanges.length,1);assert.equal(modified.upstreamChanges[0].path,member);
      // Exercise the production no-local-mappings branch without altering source bytes.
      const recipes=[originalRoot,publicRoot].map(r=>JSON.parse(fs.readFileSync(path.join(r,'edition.json'))));
      for(const [i,r] of [originalRoot,publicRoot].entries()) {
        const recipe=structuredClone(recipes[i]);delete recipe.components.find(c=>c.id===entry.selector).source.mappings;
        fs.writeFileSync(path.join(r,'edition.json'),json(recipe));command(r,'lock');
      }
      assert.equal(compareBoth().localChanges,null);
      // An unmapped owned file must stay visible in currentFiles without guessed mappings.
      const unmapped='projection-equivalence-owned.txt';
      for(const [i,r] of [originalRoot,publicRoot].entries()) {
        const recipe=structuredClone(recipes[i]);recipe.components.find(c=>c.id===entry.selector).source.paths.push(unmapped);
        fs.writeFileSync(path.join(r,unmapped),'Independent unmapped owner input.\n');git(r,'add',unmapped);
        fs.writeFileSync(path.join(r,'edition.json'),json(recipe));command(r,'lock');
      }
      const unmappedResult=compareBoth();assert.ok(unmappedResult.currentFiles[unmapped]);
      assert.ok(!unmappedResult.localChanges.some(change=>change.path===unmapped));
      for(const [i,r] of [originalRoot,publicRoot].entries()){git(r,'rm','-f',unmapped);fs.writeFileSync(path.join(r,'edition.json'),json(recipes[i]));command(r,'lock');}
      result.consumers.push('compare mapped','compare incoming content and mode change','compare no local mappings','compare unmapped owned input');
    }
    report.archives.push(result);
  }
  for(const [index,copy] of [originalRoot,publicRoot].entries()) {
    commit(copy);
    assert.equal(command(copy,'check').ok,true);
    const changes=command(copy,'changes');assert.deepEqual(changes.files,[]);assert.deepEqual(changes.metadata,[]);
    const materialized=path.join(temp,`materialized-${index}`);command(copy,'materialize',materialized);
    assert.equal(fs.existsSync(path.join(materialized,'.edition')),false);
    const releasePath=path.join(temp,`release-${index}`);command(copy,'release',releasePath);
    assert.equal(command(releasePath,'receipt',releasePath+'.release.json').ok,true);
    report.consumers.push({variant:index===0?'original':'projection',commands:['lock','check','changes','materialize','release','receipt'],ok:true});
  }
  report.ok=true;
  fs.writeFileSync(reportPath,json(report),{mode:0o600});
  console.log(json({ok:true,archives:report.archives.length,variants:report.consumers.length}));
} finally {fs.rmSync(temp,{recursive:true,force:true});}
