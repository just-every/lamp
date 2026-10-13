import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { generateProjectDescriptor } from '../../scripts/delivery/base/generators/project.mjs';
import { loadSetupManifest, setupSelection } from '../../scripts/delivery/base/setup-manifest.mjs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('current source descriptors agree on the canonical repository and edition identity and declare no comparison parent', async () => {
  const [descriptor, integration, edition, packaging, pkg, deploy, operations, exportedPackaging] = await Promise.all([
    readJson('rer-project.json'),
    readJson('management/integration/profile.json'),
    readJson('edition.json'),
    readJson('rer-packaging.json'),
    readJson('package.json'),
    readJson('deploy.json'),
    readJson('OPERATIONS.json'),
    readJson('scripts/delivery/base/packaging.json'),
  ]);
  const repository = new URL(pkg.repository.url.replace(/\.git$/, ''));
  assert.equal(descriptor.sourceRepository, repository.href);
  assert.equal(integration.sourceRepository, descriptor.sourceRepository);
  assert.equal(descriptor.projectId, repository.pathname.slice(1));
  assert.equal(packaging.project.projectId, descriptor.projectId);
  assert.equal(packaging.edition.componentId, edition.id);
  assert.ok(edition.components.some(component => component.id === edition.id && component.role === 'edition'));
  assert.equal(edition.id, descriptor.projectId);
  assert.equal(edition.parent, undefined);
  assert.equal(deploy.project, edition.id);
  assert.equal(operations.project, edition.id);
  // The vendored producer policy is the export of the current packaging input.
  assert.deepEqual(exportedPackaging, packaging);
  const setup = await loadSetupManifest(process.cwd(), setupSelection(packaging.setup));
  assert.deepEqual(descriptor, {
    ...generateProjectDescriptor(packaging.project),
    setup: { path: setup.path, sha256: setup.sha256 },
  });
});
