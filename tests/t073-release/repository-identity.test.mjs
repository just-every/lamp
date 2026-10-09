import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('current source descriptors agree on the canonical repository and edition identity while comparison origin remains stable', async () => {
  const [descriptor, integration, edition] = await Promise.all([
    readJson('rer-project.json'),
    readJson('management/integration/profile.json'),
    readJson('edition.json'),
  ]);
  assert.equal(descriptor.sourceRepository, 'https://github.com/just-every/lamp');
  assert.equal(integration.sourceRepository, descriptor.sourceRepository);
  assert.equal(descriptor.projectId, 'just-every/lamp');
  assert.equal(edition.id, descriptor.projectId);
  assert.deepEqual(edition.parent, {
  "repository": "https://github.com/just-every/lamp.git",
  "projection": {
    "schemaVersion": 1,
    "originalSha256": "e23647ab29fbe69848e84b6329fb967ed41f8f74fb8c1e21de8453fa6d96f5f8",
    "recipeSha256": "254d317133f0c6fa0f611280425f4520a72c75a4fb19e4552e43386f96fef3c5"
  }
});
});
