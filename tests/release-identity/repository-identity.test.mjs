import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('current source descriptors agree on the canonical repository and edition identity and declare no comparison parent', async () => {
  const [descriptor, integration, edition] = await Promise.all([
    readJson('rer-project.json'),
    readJson('management/integration/profile.json'),
    readJson('edition.json'),
  ]);
  assert.equal(descriptor.sourceRepository, 'https://github.com/just-every/run-lamp');
  assert.equal(integration.sourceRepository, descriptor.sourceRepository);
  assert.equal(descriptor.projectId, 'just-every/lamp');
  assert.equal(edition.id, descriptor.projectId);
  assert.equal(edition.parent, undefined);
});
