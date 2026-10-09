import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTypescript } from './runtime.mjs';
const { incidentDraftSchema } = await loadTypescript('src/core/shared/schemas.ts');
const fields = {lifecycle:'Resolved',affectedAudience:'Buyers',customerImpact:'Payments restored',whatStillWorks:'Browsing',details:''};
test('UPDATE-001 resolved draft accepts absent/null time and preserves validation', () => {
  assert.equal(incidentDraftSchema.parse(fields).nextUpdateAt, null);
  assert.equal(incidentDraftSchema.parse({...fields,nextUpdateAt:null}).nextUpdateAt, null);
  assert.equal(incidentDraftSchema.safeParse({...fields,nextUpdateAt:'invalid'}).success, false);
  assert.equal(incidentDraftSchema.safeParse({...fields,customerImpact:'x'.repeat(251)}).success, false);
  assert.equal(incidentDraftSchema.safeParse({...fields,unexpected:true}).success, false);
  assert.equal(incidentDraftSchema.parse({...fields,lifecycle:'Investigating',nextUpdateAt:'2026-10-06T09:00:00Z'}).nextUpdateAt, '2026-10-06T09:00:00Z');
});
