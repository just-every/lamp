import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('both dispatch-only release consumers select the accepted full trusted-build revision', async () => {
  const files = ['.github/workflows/deploy.yml', '.github/workflows/rer-managed.yml'];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /uses: runeditrun\/delivery\/.github\/workflows\/trusted-build\.yml@3bf5463466b68615ff3862a28acbe5cb9d1786ec\n/);
    assert.match(source, /  workflow_dispatch:/);
    assert.doesNotMatch(source, /^  (push|pull_request):/m);
  }
  assert.match(await readFile(files[0], 'utf8'), /verification_profile: full/);
  assert.match(await readFile(files[1], 'utf8'), /verification_profile:[\s\S]*?default: full/);
});


test('main pushes run credential-free verification without dispatching a release', async () => {
  const source = await readFile('.github/workflows/verify.yml', 'utf8');
  assert.match(source, /  push:\n    branches: \[main\]/);
  assert.match(source, /bash scripts\/agent-bootstrap\.sh && pnpm verify/);
  assert.doesNotMatch(source, /id-token: write|secrets: inherit|trusted-build/);
});
