import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extract, compare} from '../../scripts/edition-authoring/updates.mjs';
import {snapshot, source} from '../../scripts/edition-authoring/sources.mjs';
import {git, hash, json} from '../../scripts/edition-authoring/files.mjs';
import {verifyProjections} from '../../scripts/public-projections/verify.mjs';
import {candidate, commit, identities} from './support.mjs';
const root=process.cwd();

test('actual public consumers extract every selection and compare all components and the whole parent', () => {
  const receipt=verifyProjections(root), temp=fs.mkdtempSync(path.join(os.tmpdir(),'public-comparisons-'));
  try {
    for(const [i,item] of receipt.archives.entries()) {
      const saved=snapshot(root,item.origin), output=path.join(temp,`extract-${i}`);
      assert.deepEqual(source(root,item.origin),saved.files);
      extract(root,item.selector,output);
      const actual=identities(output);
      for(const member of item.members) {
        if(member.projectedSha256===null) assert.equal(actual[member.path],undefined);
        else assert.deepEqual(actual[member.path],{sha256:member.projectedSha256,executable:member.executable});
      }
      const repo=candidate(path.join(temp,`candidate-${i}`),saved);
      const before=compare(root,item.selector,repo);
      assert.deepEqual(before.upstreamChanges,[]);
      assert.ok(Array.isArray(before.localChanges));
      if(item.selector==='parent') {
        assert.equal(before.mappings,null);
        assert.ok(before.localChanges.length>0);
        assert.ok(before.currentFiles['sources.lock.json']);
      } else assert.ok(before.mappings.length>0);
      const name=Object.keys(saved.files).find(n=>n.endsWith('.mjs')||n.endsWith('.ts'));
      const target=path.join(repo,item.origin.path==='.'?'':item.origin.path,name);
      fs.appendFileSync(target,'\n// Additional candidate change remains visible.\n');
      fs.chmodSync(target,saved.files[name].executable?0o644:0o755);commit(repo);
      const after=compare(root,item.selector,repo);
      assert.deepEqual(after.upstreamChanges.map(c=>c.path),[name]);
      assert.equal(after.upstreamChanges[0].after.executable,!saved.files[name].executable);
      assert.deepEqual(after.localChanges,before.localChanges);
      assert.deepEqual(after.currentFiles,before.currentFiles);
    }
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('missing and corrupt projected archives fail offline; all direct consumers are inventoried', () => {
  const receipt=verifyProjections(root), temp=fs.mkdtempSync(path.join(os.tmpdir(),'projection-failures-'));
  try {
    for(const item of receipt.archives) {
      assert.throws(()=>snapshot(temp,item.origin),/Missing retained public projection/);
      fs.mkdirSync(path.join(temp,'.edition/sources'),{recursive:true});
      const archive=JSON.parse(fs.readFileSync(path.join(root,'.edition/sources',item.key+'.json')));
      const first=Object.keys(archive.files)[0];archive.files[first].data=Buffer.from('corrupt').toString('base64');
      const target=path.join(temp,'.edition/sources',item.key+'.json');fs.writeFileSync(target,json(archive));
      assert.throws(()=>snapshot(temp,item.origin),/Corrupt retained source snapshot/);fs.unlinkSync(target);
    }
    const readers=git(root,'ls-files','scripts').split('\n').filter(n=>n.endsWith('.mjs')&&!n.startsWith('scripts/public-projections/')).filter(n=>/\.edition\/sources|from ['"]\.\/sources\.mjs['"]/.test(fs.readFileSync(path.join(root,n),'utf8'))).sort();
    assert.deepEqual(readers,['scripts/edition-authoring/cli.mjs','scripts/edition-authoring/parent-comparison.mjs','scripts/edition-authoring/release.mjs','scripts/edition-authoring/sources.mjs','scripts/edition-authoring/updates.mjs']);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
