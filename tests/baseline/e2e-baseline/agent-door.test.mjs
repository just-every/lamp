import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before } from 'node:test';
import { baseline } from './case.mjs';

const clauses = Array.from({ length: 13 }, (_, index) => `BASE-AGENT-${String(index + 1).padStart(3, '0')}`);
const belongsTo = (point, id) => typeof point?.id === 'string' && (point.id === id || point.id.startsWith(`${id}.`));
let result;
let executionError;
let reportError;

before(async () => {
  try {
    // Run the same installed-CLI journey as rer verify, against a disposable
    // production Worker and its native owner lifecycle, not a module fixture.
    const { checkAgentDoor } = await import(new URL('agent-door.mjs', import.meta.resolve('@runeditrun/rer/adapter')));
    result = await checkAgentDoor(process.cwd());
  } catch (error) {
    if (error.code === 'agent_door_failed' && Array.isArray(error.agentDoor?.points)) result = error.agentDoor;
    else executionError = typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'agent_conformance_unavailable';
  }

  const path = process.env.LAMP_AGENT_DOOR_REPORT ?? join(dirname(process.env.LAMP_BASELINE_REPORT ?? join(tmpdir(), 'lamp-baseline-report.json')), 'agent-door-conformance.json');
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(executionError ? { executionError } : result, null, 2)}\n`);
  } catch {
    reportError = 'The executed native conformance result could not be retained.';
  }
  // Leave bootstrap and retention failures to the individual assertions so all
  // thirteen clauses have an executed failing baseline result, not cancelled tests.
});

for (const id of clauses) baseline(id, 'installed CLI native door conformance', () => {
  assert.equal(executionError, undefined, `${id}: native conformance did not complete (${executionError})`);
  assert.equal(reportError, undefined, reportError);
  assert.ok(Array.isArray(result?.points), `${id}: the installed CLI returned no executed conformance points`);
  const points = result.points.filter(point => belongsTo(point, id));
  assert.ok(points.length, `${id}: native conformance executed no points for this clause`);
  const failed = points.filter(point => point.ok !== true);
  assert.deepEqual(failed, [], `${id}: ${failed.map(point => `${point.id}: ${point.detail ?? 'failed'}`).join('\n')}`);
  const unassigned = result.points.filter(point => !clauses.some(clause => belongsTo(point, clause)));
  assert.ok(unassigned.every(point => point.ok === true), `Unassigned native conformance points failed: ${unassigned.filter(point => point.ok !== true).map(point => point.id).join(', ')}`);
});
