import fs from 'node:fs';
import path from 'node:path';
import {hash, json, digest} from '../edition-authoring/files.mjs';
import {snapshot} from '../edition-authoring/sources.mjs';
export function verifyProjections(root) {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-projections/plan.json')));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-projections/receipt.json')));
  if (receipt.recipeSha256 !== hash(fs.readFileSync(path.join(root, 'scripts/public-projections/plan.json')))) throw Error('Projection recipe mismatch');
  const actual = fs.readdirSync(path.join(root, '.edition/sources')).sort();
  if (json(actual) !== json(receipt.archives.map(a => `${a.key}.json`).sort()) || receipt.archives.length !== plan.archives.length) throw Error('Unaccounted comparison archive');
  for (const item of receipt.archives) {
    const planned = plan.archives.find(a => a.originalKey === item.originalKey);
    if (!planned || planned.originalSha256 !== item.originalSha256) throw Error('Unplanned archive');
    const saved = snapshot(root, item.origin);
    if (hash(json(saved)) !== item.sha256 || digest(saved.files) !== item.digest || saved.derivation.originalSha256 !== item.originalSha256 || saved.derivation.upstreamRevision !== item.upstreamRevision || saved.derivation.recipeSha256 !== receipt.recipeSha256) throw Error('Projection receipt mismatch');
    const names = new Set();
    for (const member of item.members) {
      if (names.has(member.path)) throw Error('Duplicate receipt member');
      names.add(member.path);
      const file = saved.files[member.path];
      if (member.projectedSha256 === null) {
        if (file || !planned.members[member.path]?.omit) throw Error('Unplanned omission');
      } else if (!file || hash(Buffer.from(file.data, 'base64')) !== member.projectedSha256 || file.executable !== member.executable) throw Error('Member receipt mismatch');
    }
    if (Object.keys(saved.files).some(n => !names.has(n))) throw Error('Unaccounted archive member');
  }
  return receipt;
}
