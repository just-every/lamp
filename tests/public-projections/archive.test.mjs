import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hash, json, git} from '../../scripts/edition-authoring/files.mjs';
import {projectFile, readOriginal} from '../../scripts/public-projections/archive.mjs';
import {semanticComparison} from '../../scripts/public-projections/semantic.mjs';
import {verifyProjections} from '../../scripts/public-projections/verify.mjs';

test('all retained archives and every member have complete digest-bound receipts', () => {
  const receipt = verifyProjections(process.cwd());
  assert.equal(receipt.archives.length, 4);
  assert.deepEqual(receipt.archives.map(a => a.selector).sort(), ['parent', 'runeditrun/base-onboarding', 'runeditrun/owner-migrations', 'runeditrun/sendgrid-email']);
  assert.equal(receipt.archives.reduce((n,a) => n+a.members.length,0), 328);
  assert.equal(receipt.archives.flatMap(a=>a.members).filter(m=>m.projectedSha256===null).length,14);
});

test('byte edits are deterministic and reject mismatched input, overlap and changed ranges', () => {
  const bytes = Buffer.from('Before\nfixture-original\nAfter\n');
  const rule = {originalSha256: hash(bytes), edits: [{start:7,end:24,originalSha256:hash(bytes.subarray(7,24)),replacement:Buffer.from('fixture-public\n').toString('base64')}]};
  const expected = Buffer.from('Before\nfixture-public\nAfter\n');
  assert.deepEqual(projectFile(bytes,rule),expected);
  assert.deepEqual(projectFile(bytes,rule),expected);
  assert.throws(()=>projectFile(Buffer.from('modified'),rule),/digest mismatch/);
  assert.throws(()=>projectFile(bytes,{...rule,edits:[...rule.edits,...rule.edits]}),/Invalid projection edit/);
  assert.throws(()=>projectFile(bytes,{...rule,edits:[{...rule.edits[0],start:8}]}),/Invalid projection edit/);
});

test('source digest is checked before parsing or transforming originals', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'projection-integrity-'));
  try {
    fs.writeFileSync(path.join(dir,'fixture.json'),'not an archive');
    assert.throws(()=>readOriginal(dir,{originalKey:'fixture',originalSha256:hash('different')}),/Original archive digest mismatch/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('normalization preserves unrelated edits, omissions with changed bytes, mode changes and unmapped state', () => {
  const original=hash('original'), projected=hash('projected'), changed=hash('adjacent change');
  const receipt={members:[{path:'source',originalSha256:original,projectedSha256:projected},{path:'visual.png',originalSha256:original,projectedSha256:null,executable:false}]};
  const row=(name,before,after)=>({path:name,change:'modified',before,after});
  const id=(sha256,executable=false)=>({sha256,executable});
  const result={component:'fixture/component',upstreamChanges:[row('source',id(original),id(projected)),row('source',id(original),id(changed)),row('source',id(original),id(projected,true)),row('visual.png',id(original),id(changed)),row('visual.png',id(original),id(original,true))],localChanges:null,currentFiles:{},mappings:[],meaning:'fixture'};
  const normalized=semanticComparison(result,receipt);
  assert.equal(normalized.upstreamChanges.length,4);
  assert.equal(normalized.upstreamChanges[0].after.sha256,changed);
  assert.equal(normalized.upstreamChanges[1].after.executable,true);
  assert.equal(normalized.upstreamChanges[2].change,'added');
  assert.equal(normalized.upstreamChanges[3].after.executable,true);
  assert.equal(normalized.localChanges,null);
});

test('sanitization plan retains licenses, executable source and product images', () => {
  const plan=JSON.parse(fs.readFileSync('scripts/public-projections/plan.json'));
  const deploymentBoundaries=['810:842','873:905','935:967'];
  const boundaryEdits=[];
  for(const archive of plan.archives) for(const [name,rule] of Object.entries(archive.members)) {
    assert.doesNotMatch(name,/(?:LICENSE|OFL\.txt$)/);
    if(rule.omit) assert.match(name,/^visual\/[^/]+\.png$/);
    else for(const edit of rule.edits) {
      const replacement=Buffer.from(edit.replacement,'base64').toString();
      if(edit.reason==='synthetic test value, never a credential') {
        if(archive.selector==='parent'&&name==='tests/e2e/deployment-artifact.test.mjs'&&deploymentBoundaries.includes(`${edit.start}:${edit.end}`)) {
          assert.equal(edit.end-edit.start,32);
          assert.equal(Buffer.byteLength(replacement),32);
          assert.ok(/^fixture-synthetic-[a-f0-9]{14}$/.test(replacement),'Expected exact 32-byte synthetic deployment fixture');
          boundaryEdits.push({range:`${edit.start}:${edit.end}`,replacement});
        } else assert.match(replacement,/^fixture-synthetic-[a-f0-9]{12}$/);
      }
      if(edit.reason.includes('email')) assert.match(replacement,/(?:@|^)example\.test$/);
    }
  }
  assert.deepEqual(boundaryEdits.map(edit=>edit.range).sort(),deploymentBoundaries);
  assert.equal(new Set(boundaryEdits.map(edit=>edit.replacement)).size,2);
  assert.ok(boundaryEdits[0].replacement!==boundaryEdits[1].replacement);
  assert.ok(boundaryEdits[1].replacement===boundaryEdits[2].replacement);
});


test('synthetic member audit binds exact archive blobs and member bytes without a blanket waiver', () => {
  const receipt=verifyProjections(process.cwd());
  const plan=JSON.parse(fs.readFileSync('scripts/public-projections/plan.json'));
  const audit=JSON.parse(fs.readFileSync('scripts/public-projections/fixture-reviews.json'));
  const expected=[];
  for(const item of receipt.archives) {
    const entry=plan.archives.find(p=>p.originalKey===item.originalKey);
    for(const [name,rule] of Object.entries(entry.members)) {
      if(!rule.edits?.some(edit=>edit.reason==='synthetic test value, never a credential'))continue;
      expected.push(item.key+'/'+name);
    }
  }
  assert.deepEqual(audit.members.map(m=>m.archivePath.split('/').at(-1).replace('.json','')+'/'+m.memberPath).sort(),expected.sort());
  for(const review of audit.members) {
    assert.equal(review.reason,'synthetic test value, never a credential');
    const archive=JSON.parse(fs.readFileSync(review.archivePath));
    assert.equal(hash(Buffer.from(archive.files[review.memberPath].data,'base64')),review.memberSha256);
    assert.equal(git(process.cwd(),'hash-object',review.archivePath),review.archiveBlob);
  }
});


test('scoped dependency identifiers are retained, while genuine email edits still apply', () => {
  const bytes=Buffer.from('"@scope.test/client": "*"\n"person@private.invalid"\n');
  const rule=(start,end,replacement)=>({originalSha256:hash(bytes),edits:[{start,end,originalSha256:hash(bytes.subarray(start,end)),replacement:Buffer.from(replacement).toString('base64')}]});
  assert.throws(()=>projectFile(bytes,rule(2,12,'example.test')),/scoped npm dependency/);
  const start=bytes.indexOf('person@'),end=bytes.indexOf('"',start);
  assert.equal(projectFile(bytes,rule(start,end,'person@example.test')).toString(),'"@scope.test/client": "*"\n"person@example.test"\n');
  const receipt=verifyProjections(process.cwd()).archives.find(a=>a.selector==='parent');
  const saved=JSON.parse(fs.readFileSync('.edition/sources/'+receipt.key+'.json'));
  const lock=Buffer.from(saved.files['pnpm-lock.yaml'].data,'base64');
  const member=receipt.members.find(m=>m.path==='pnpm-lock.yaml');
  assert.equal(hash(lock),member.originalSha256);
  assert.equal(member.projectedSha256,member.originalSha256);
  assert.equal((lock.toString().match(/@xata\.io\/client/g)||[]).length,2);
  assert.doesNotMatch(lock.toString(),/@example\.test\/client/);
});

test('original inputs reject symlink files, directories, ancestors and dangling links', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'projection-links-'));
  try {
    const real=path.join(dir,'real');fs.mkdirSync(real);fs.mkdirSync(path.join(real,'nested'));
    const bytes=Buffer.from('not an archive'), entry={originalKey:'fixture',originalSha256:hash('other')};
    fs.writeFileSync(path.join(real,'nested','fixture.json'),bytes);
    fs.symlinkSync(path.join(real,'nested'),path.join(dir,'directory'));
    fs.symlinkSync(real,path.join(dir,'ancestor'));
    fs.symlinkSync(path.join(real,'absent'),path.join(dir,'dangling-directory'));
    for(const directory of [path.join(dir,'directory'),path.join(dir,'ancestor','nested'),path.join(dir,'dangling-directory'),path.join(dir,'directory')+'/..']) assert.throws(()=>readOriginal(directory,entry),/Symlink/);
    for(const target of [path.join(real,'nested','fixture.json'),path.join(real,'absent.json')]) {
      const link=path.join(real,'fixture.json');fs.symlinkSync(target,link);
      assert.throws(()=>readOriginal(real,entry),/Symlink/);fs.unlinkSync(link);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
