import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash, json} from '../edition-authoring/files.mjs';
import {readOriginal, projectArchive, memberReceipt} from './archive.mjs';
import {verifyOriginalInventory} from './input-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [privateStore, output] = process.argv.slice(2);
if (!privateStore || !output) throw Error('Usage: generate.mjs <private-original-directory> <new-output-directory>');
for (const directory of [privateStore, output]) if (path.resolve(directory) === root || path.resolve(directory).startsWith(root + path.sep)) throw Error('Generation inputs and staging output must be outside the public source tree');
if (fs.existsSync(output)) throw Error('Output directory must not exist');
const planBytes = fs.readFileSync(path.join(root, 'scripts/public-projections/plan.json'));
const plan = JSON.parse(planBytes);
const recipeSha256 = hash(planBytes);
verifyOriginalInventory(privateStore, plan.archives);
const products = plan.archives.map(entry => {
  const original = readOriginal(privateStore, entry);
  const projected = projectArchive(original, entry, recipeSha256);
  return {entry, original, projected};
});
fs.mkdirSync(path.join(output, 'sources'), {recursive: true});
const receipt = {schemaVersion: 1, recipeSha256, archives: []};
for (const {entry, original, projected} of products) {
  const bytes = json(projected);
  fs.writeFileSync(path.join(output, 'sources', `${projected.key}.json`), bytes);
  receipt.archives.push({selector: entry.selector, originalKey: entry.originalKey, originalSha256: entry.originalSha256, upstreamRevision: original.origin.revision, key: projected.key, sha256: hash(bytes), digest: projected.digest, origin: projected.origin, members: memberReceipt(original, projected)});
}
fs.writeFileSync(path.join(output, 'receipt.json'), json(receipt));
console.log(json({archives: products.length, recipeSha256}));
