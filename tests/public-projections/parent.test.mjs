import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compare} from '../../scripts/edition-authoring/updates.mjs';
import {snapshot} from '../../scripts/edition-authoring/sources.mjs';
import {verifyProjections} from '../../scripts/public-projections/verify.mjs';
import {candidate, commit} from './support.mjs';

// These are independent committed incoming and current repositories, not a copy
// of a comparison result. Exercise the same public entry point as the CLI.
test('whole-parent comparison preserves independent bytes, modes, additions and removals offline', () => {
  const root=process.cwd(), entry=verifyProjections(root).archives.find(a=>a.selector==='parent');
  const saved=snapshot(root,entry.origin), temp=fs.mkdtempSync(path.join(os.tmpdir(),'parent-comparison-'));
  try {
    const incoming=candidate(path.join(temp,'incoming'),saved), current=candidate(path.join(temp,'current'),saved);
    const initial=compare(root,'parent',incoming,current);
    assert.deepEqual(initial.upstreamChanges,[]);assert.deepEqual(initial.localChanges,[]);assert.equal(initial.mappings,null);
    const changed=Object.keys(saved.files).find(n=>n.endsWith('.mjs'));
    const mode=Object.keys(saved.files).find(n=>n!==changed&&n.endsWith('.ts'));
    const removed=Object.keys(saved.files).find(n=>n.endsWith('README.md'));
    const omitted=entry.members.find(m=>m.projectedSha256===null).path;
    const mutate=(directory,marker)=>{
      fs.appendFileSync(path.join(directory,changed),'\n// '+marker+'\n');
      fs.chmodSync(path.join(directory,mode),saved.files[mode].executable?0o644:0o755);
      fs.unlinkSync(path.join(directory,removed));
      fs.mkdirSync(path.dirname(path.join(directory,omitted)),{recursive:true});
      fs.writeFileSync(path.join(directory,omitted),'Unknown screenshot bytes '+marker);
      fs.mkdirSync(path.join(directory,'.edition'),{recursive:true});
      fs.writeFileSync(path.join(directory,'.edition','owner-input.txt'),marker);
      commit(directory);
    };
    mutate(incoming,'incoming only');
    const upstream=compare(root,'parent',incoming,current);
    assert.deepEqual(upstream.localChanges,[]);
    assert.deepEqual(upstream.upstreamChanges.map(c=>c.path).sort(),[changed,mode,removed,omitted,'.edition/owner-input.txt'].sort());
    assert.equal(upstream.upstreamChanges.find(c=>c.path===removed).change,'removed');
    assert.equal(upstream.upstreamChanges.find(c=>c.path===mode).after.executable,!saved.files[mode].executable);
    mutate(current,'current only');
    const local=compare(root,'parent',incoming,current);
    assert.deepEqual(local.upstreamChanges,upstream.upstreamChanges);
    assert.deepEqual(local.localChanges.map(c=>c.path).sort(),upstream.upstreamChanges.map(c=>c.path).sort());
    assert.notEqual(local.currentFiles[changed].sha256,local.upstreamChanges.find(c=>c.path===changed).after.sha256);
    // A dirty tracked deletion and mode-only edit must remain observable locally.
    fs.unlinkSync(path.join(current,changed));
    assert.equal(compare(root,'parent',incoming,current).localChanges.find(c=>c.path===changed).change,'removed');
    fs.appendFileSync(path.join(incoming,changed),'\n// Uncommitted incoming\n');
    assert.throws(()=>compare(root,'parent',incoming,current),/clean and committed/);
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
