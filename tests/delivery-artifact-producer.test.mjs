import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { produceArtifact } from '../scripts/build-delivery-artifact.mjs';

import {collectFiles} from '../scripts/delivery/base/paths.mjs';
import {payload} from './artifact-payload.mjs';

test('bundle transports runtime bytes without granting configuration authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamp-delivery-'));
  try {
    for (const folder of ['dist/server', 'dist/client', 'migrations/core']) await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, 'dist/server/index.js'), 'export default {};');
    await writeFile(join(root, 'dist/server/wrangler.json'), JSON.stringify({compatibility_date:'2026-09-08',d1_databases:[{binding:'DB',migrations_dir:'../../migrations/core'}]}));
    await writeFile(join(root, 'dist/client/app.js'), 'console.log(1)');
    await cp('scripts/delivery/rer-entry.template.mjs',join(root,'rer-entry.template.mjs'));
    await mkdir(join(root,'scripts/delivery'),{recursive:true});
    await cp('scripts/delivery/rer-entry.template.mjs',join(root,'scripts/delivery/rer-entry.template.mjs'));
    await cp('edition.json',join(root,'edition.json'));await cp('rer-setup.json',join(root,'rer-setup.json'));
    const path = await produceArtifact({ root });
    const artifact = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(artifact.schema, 2);
    assert.deepEqual(artifact.modules.map(file => file.name), ['index.js', 'rer-entry.js']);
    assert.equal(artifact.mainModule, 'rer-entry.js');
    assert.equal((await payload(path,artifact.modules[0])).toString(), 'export default {};');
    assert.equal(artifact.modules[0].type, 'esm');
    assert.equal(artifact.assets[0].path, '/app.js');
    await symlink(join(root, 'dist/server/index.js'), join(root, 'dist/client/link'));
    await assert.rejects(collectFiles(root, 'dist/client'), /symlink/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
