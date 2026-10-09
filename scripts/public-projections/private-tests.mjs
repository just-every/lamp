// Executes genuine dependency-free archived tests, with raw output kept private.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {hash,json,git,writeTree} from '../edition-authoring/files.mjs';
import {readOriginal} from './archive.mjs';
import {snapshot} from '../edition-authoring/sources.mjs';
import {verifyProjections} from './verify.mjs';

const [privateStore,output]=process.argv.slice(2),root=process.cwd();
if(!privateStore||!output||path.resolve(output).startsWith(root+path.sep)||path.resolve(privateStore).startsWith(root+path.sep))throw Error('Supply private originals and new evidence directory outside the public source');
if(fs.existsSync(output))throw Error('Evidence directory already exists');
fs.mkdirSync(output,{recursive:true,mode:0o700});
const plan=JSON.parse(fs.readFileSync('scripts/public-projections/plan.json')),receipt=verifyProjections(root);
const selections={parent:[],'runeditrun/base-onboarding':['app-processes.test.mjs','contract.test.mjs','failures.test.mjs','pending-request.test.mjs','private.test.mjs','start-concurrency.test.mjs','ui/model-core.test.mjs'],'runeditrun/sendgrid-email':['modules/sendgrid-email/tests/sender.test.ts'],'runeditrun/owner-migrations':['deployment/owner-migrations.test.mjs']};
const report={schemaVersion:1,sourceCommit:git(root,'rev-parse','HEAD'),sourceTree:git(root,'write-tree'),lockSha256:hash(fs.readFileSync('sources.lock.json')),node:process.version,runs:[],remainingRuntimeTests:[]};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'archived-test-equivalence-'));
try{
  for(const entry of receipt.archives){
    const spec=plan.archives.find(a=>a.originalKey===entry.originalKey);
    const runs=[];
    if(entry.selector==='parent'){
      for(const [name,rule] of Object.entries(spec.members))if(name.endsWith('.test.mjs'))report.remainingRuntimeTests.push({path:name,originalSha256:rule.originalSha256,projectedSha256:entry.members.find(m=>m.path===name).projectedSha256,reason:'Requires product dependencies, Worker or browser runtime; exact construction and comparison proven separately. The deployment-secrets suite dynamically imports vite.'});
      continue;
    }
    for(const variant of ['original','projection']){
      const archive=variant==='original'?readOriginal(privateStore,spec):snapshot(root,entry.origin);
      const directory=path.join(temp,entry.key+'-'+variant);fs.mkdirSync(directory);writeTree(directory,archive.files);
      const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...selections[entry.selector]],{cwd:directory,encoding:'utf8',maxBuffer:16*1024*1024,timeout:120000,env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});
      const raw=(result.stdout||'')+(result.stderr||'');const name=entry.key+'-'+variant+'.log';fs.writeFileSync(path.join(output,name),raw,{mode:0o600});
      const summary=Object.fromEntries([...raw.matchAll(/^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
      // Node may select TAP when output is piped.
      for(const m of raw.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm))summary[m[1]]=Number(m[2]);
      const run={selector:entry.selector,variant,archiveSha256:hash(json(archive)),command:['node','--test','--test-concurrency=1',...selections[entry.selector]],status:result.status,signal:result.signal,summary,log:name,logSha256:hash(raw)};runs.push(run);report.runs.push(run);
      assert.equal(result.status,0,`Archived tests failed: ${entry.selector} ${variant}; inspect private log`);
      assert.ok(summary.tests>0);assert.equal(summary.fail,0);assert.equal(summary.skipped,0);assert.equal(summary.cancelled,0);
    }
    assert.deepEqual(runs[0].summary,runs[1].summary);

  }
  report.ok=true;
}finally{fs.writeFileSync(path.join(output,'receipt.json'),json(report),{mode:0o600});fs.rmSync(temp,{recursive:true,force:true});}
console.log(json({ok:true,runs:report.runs.length,testsPerVariant:report.runs.filter(r=>r.variant==='original').reduce((n,r)=>n+r.summary.tests,0),remainingRuntimeTests:report.remainingRuntimeTests.length}));
