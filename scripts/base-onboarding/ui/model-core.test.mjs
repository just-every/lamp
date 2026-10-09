import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel } from './model-core.mjs';

const seed = {
  product: { name: 'Example' },
  fields: { title: { valid: value => Boolean(value) }, region: { valid: value => ['east', 'west'].includes(value) } },
  setupGroups: [{ id: 'details', title: 'Details', keys: ['title'] }, { id: 'location', title: 'Location', keys: ['region'] }],
};
test('edition schema alone controls required fields without hosting, owner or artwork', () => {
  const model = createModel(seed);
  assert.deepEqual(model.initialDraft({ draft: { title: 'Team', password: 'private' } }), { title: 'Team' });
  assert.deepEqual(model.setupModel({ title: 'Team' }).missing, ['region']);
  assert.equal(model.nextIncompleteGroup({ title: 'Team' }), 'location');
  assert.equal(model.setupProgress({ title: 'Team' }, {}, { active: 'location' }), 'Step 1 of 1');
  const ready = { title: 'Team', region: 'west' };
  assert.equal(model.setupModel(ready).ready, true);
  assert.deepEqual(model.installInput(ready), ready);
  assert.deepEqual(model.emailModel(ready), { keys: [], complete: true });
  assert.deepEqual(model.hostingModel(ready), { complete: true, accessReady: false });
});
test('agent updates preserve pending local answers and never merge unknown fields', () => {
  const model = createModel(seed), draft = { title: 'Local', region: 'east' };
  const result = model.mergeAgentDraft(draft, { draft: { title: 'Agent', region: 'west', password: 'private' }, lastUpdate: { revision: 2, source: 'agent', keys: ['title', 'region', 'password'] } }, 1, ['title']);
  assert.deepEqual(result, { title: 'Local', region: 'west' });
});

test('saved answers override defaults and edition secrets use declared readiness bindings', () => {
  const model = createModel({ ...seed, fields: { ...seed.fields, credential: { type: 'password', valid: value => Boolean(value) } }, initialValues: () => ({ title: 'Default', region: 'east' }), secretScopes: { credential: ['title', 'title'] } });
  assert.deepEqual(model.initialDraft({ draft: { title: 'Saved' } }), { title: 'Saved', region: 'east' });
  const draft = { title: 'Saved', region: 'east' };
  assert.equal(model.setupModel(draft, { secretReadiness: { credential: true, title: 'Saved' } }).ready, true);
  assert.deepEqual(model.setupModel(draft, { secretReadiness: { credential: true, title: 'Different' } }).missing, ['credential']);
});
