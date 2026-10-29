import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before } from 'node:test';
import { baseline } from './case.mjs';

// Use the installed CLI's production installation journey, as rer verify does.
const { checkAgentDoor } = await import(new URL('agent-door.mjs', import.meta.resolve('@runeditrun/rer/adapter')));
const clauses = [
  'BASE-AGENT-001', 'BASE-AGENT-002', 'BASE-AGENT-003', 'BASE-AGENT-004',
  'BASE-AGENT-005', 'BASE-AGENT-006', 'BASE-AGENT-007', 'BASE-AGENT-008',
  'BASE-AGENT-009', 'BASE-AGENT-010', 'BASE-AGENT-011', 'BASE-AGENT-012', 'BASE-AGENT-013',
];
let result;
before(async () => {
  try { result = await checkAgentDoor(process.cwd()); }
  catch (error) {
    if (error.code !== 'agent_door_failed' || !error.agentDoor) throw error;
    result = error.agentDoor;
  }
  const path = process.env.LAMP_AGENT_DOOR_REPORT ?? join(dirname(process.env.LAMP_BASELINE_REPORT ?? join(tmpdir(), 'lamp-baseline-report.json')), 'agent-door-conformance.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`);
  assert.ok(Array.isArray(result.points), 'The installed CLI must return executed conformance points');
});

for (const id of clauses) baseline(id, 'installed CLI native door conformance', () => {
  const points = result.points.filter(point => point.id === id || point.id.startsWith(`${id}.`));
  assert.ok(points.length, `${id}: the native conformance run executed no points for this clause`);
  const failed = points.filter(point => point.ok !== true);
  assert.deepEqual(failed, [], `${id}: ${failed.map(point => `${point.id}: ${point.detail ?? 'failed'}`).join('\n')}`);
});

after(() => {
  if (!result?.points) return;
  const unassigned = result.points.filter(point => !clauses.some(clause => point.id === clause || point.id.startsWith(`${clause}.`)));
  assert.ok(unassigned.every(point => point.ok === true), 'Unassigned native conformance points failed');
});
