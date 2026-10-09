// Private execution only: authentic originals never enter ordinary public tests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compare} from '../edition-authoring/updates.mjs';
import {candidate, commit} from '../../tests/public-projections/support.mjs';
import {semanticComparison} from './semantic.mjs';

export function proveParent({originalRoot, publicRoot, original, projected, entry, temp, observe}) {
  const incoming=candidate(path.join(temp,'parent-incoming'),original);
  const publicIncoming=candidate(path.join(temp,'parent-public-incoming'),projected);
  const current=candidate(path.join(temp,'parent-current'),projected);
  const checks=[];
  const compareBoth=(label,repository=incoming)=>{
    const before=observe('parent-'+label+'-original',compare(originalRoot,'parent',repository,current));
    const after=observe('parent-'+label+'-public',compare(publicRoot,'parent',repository,current));
    // Origins are intentionally distinct. Every semantic field comes directly
    // from the production comparator, including independent current identities.
    assert.deepEqual(semanticComparison(before,entry),semanticComparison(after,entry));
    assert.deepEqual(before.upstreamChanges,after.upstreamChanges);
    assert.deepEqual(before.localChanges,after.localChanges);
    assert.deepEqual(before.currentFiles,after.currentFiles);
    checks.push(label);return after;
  };
  const originalClean=compareBoth('authentic-original');
  assert.deepEqual(originalClean.upstreamChanges,[]);assert.deepEqual(originalClean.localChanges,[]);
  assert.deepEqual(compareBoth('public-incoming',publicIncoming).upstreamChanges,[]);
  const omitted=entry.members.filter(m=>m.projectedSha256===null);
  assert.equal(omitted.length,14);
  for(const member of omitted) assert.equal(originalClean.currentFiles[member.path],undefined);
  const changed=entry.members.find(m=>m.projectedSha256&&m.originalSha256!==m.projectedSha256&&m.path.endsWith('.mjs')).path;
  const mode=Object.keys(projected.files).find(n=>n!==changed&&n.endsWith('.ts'));
  const removed=Object.keys(projected.files).find(n=>n.endsWith('README.md'));
  fs.appendFileSync(path.join(incoming,changed),'\n// Substantive adjacent incoming edit.\n');
  fs.chmodSync(path.join(incoming,mode),original.files[mode].executable?0o644:0o755);
  fs.unlinkSync(path.join(incoming,removed));
  fs.mkdirSync(path.join(incoming,'.edition'),{recursive:true});
  fs.writeFileSync(path.join(incoming,'.edition','independent.txt'),'Incoming addition\n');
  fs.appendFileSync(path.join(incoming,omitted[0].path),'Different screenshot bytes');
  fs.chmodSync(path.join(incoming,omitted[1].path),original.files[omitted[1].path].executable?0o644:0o755);
  commit(incoming);
  const upstream=compareBoth('incoming-byte-mode-add-remove-image-controls');
  const expected=[changed,mode,removed,'.edition/independent.txt',omitted[0].path,omitted[1].path].sort();
  assert.deepEqual(upstream.upstreamChanges.map(row=>row.path).sort(),expected);
  assert.deepEqual(upstream.localChanges,[]);
  assert.equal(upstream.upstreamChanges.find(row=>row.path===removed).change,'removed');
  assert.equal(upstream.upstreamChanges.find(row=>row.path===mode).after.executable,!original.files[mode].executable);
  // Add all exact omitted originals to current source: no presentation difference.
  for(const member of omitted) {
    const target=path.join(current,member.path);fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,Buffer.from(original.files[member.path].data,'base64'),{mode:member.executable?0o755:0o644});
  }
  commit(current);assert.deepEqual(compareBoth('current-exact-presentation-images').localChanges,[]);
  fs.appendFileSync(path.join(current,changed),'\n// Independent current edit.\n');
  fs.chmodSync(path.join(current,mode),projected.files[mode].executable?0o644:0o755);
  fs.unlinkSync(path.join(current,removed));
  fs.mkdirSync(path.join(current,'.edition'),{recursive:true});
  fs.writeFileSync(path.join(current,'.edition','independent.txt'),'Current addition\n');
  fs.appendFileSync(path.join(current,omitted[0].path),'Current screenshot bytes');
  fs.chmodSync(path.join(current,omitted[1].path),original.files[omitted[1].path].executable?0o644:0o755);
  commit(current);
  const local=compareBoth('current-byte-mode-add-remove-image-controls');
  assert.deepEqual(local.upstreamChanges,upstream.upstreamChanges);
  assert.deepEqual(local.localChanges.map(row=>row.path).sort(),expected);
  assert.notEqual(local.currentFiles[changed].sha256,local.upstreamChanges.find(row=>row.path===changed).after.sha256);
  return checks;
}
