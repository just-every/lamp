import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openAgentRuntime } from './runtime.mjs';
import specialist from './specialist.mjs';
import { inspectNativePages } from './browser.mjs';
import { inspectPeople } from './identity.mjs';
import { createProtocol } from '../../src/base/modules/agent-door/conformance/protocol.mjs';
import { autonomousPolicy } from '../../src/base/modules/agent-door/conformance/crypto.mjs';
import { runAgentDoorConformance } from '../../src/base/modules/agent-door/conformance/index.mjs';
import { assertNativeTarget, pendingBase } from './pending-base.mjs';

const fixture = await openAgentRuntime();
try {
  const surface = JSON.parse(await readFile('agent-surface.json', 'utf8'));
  const points = [];
  const c = createProtocol({ fetch: fixture.request, origin: fixture.origin, surface, signer: fixture.signer, person: fixture.person,
    business: fixture.business, consent: 'lamp-native-shift', points, agentId: 'harbour-incident-agent', seq: 0, revision: 0, listed: new Map() });
  for (const version of ['2026-07-28', '2025-11-25']) {
    const init = await c.mcp('initialize', {}, { version });
    assert.equal(init.status, 200); assert.equal(init.result.protocolVersion, version);
  }
  await c.adopt(autonomousPolicy());
  const result = await specialist({ request: fixture.request, origin: fixture.origin, cookie: fixture.person.cookie, tool: c.tool });
  console.log('PASS Lamp specialist: native alert, exact draft, stale refusal, one-effect replay, recovery refusal and recorded override, report, competing maintenance claim, silent import and explicit pending invitation.');
  if (process.env.LAMP_AGENT_EVIDENCE) {
    await mkdir(process.env.LAMP_AGENT_EVIDENCE, { recursive: true });
    await writeFile(join(process.env.LAMP_AGENT_EVIDENCE, 'specialist.json'), JSON.stringify(result, null, 2) + '\n');
  }
  await inspectPeople(fixture, c);
  await inspectNativePages(fixture, c, result);
  // Keep the exact upstream harness and its normal failing exit. These gaps are
  // named, dated assertions, never skips or a replacement policy implementation.
  const clean = await openAgentRuntime();
  let conformance;
  try {
    conformance = await runAgentDoorConformance({ fetch: clean.request, origin: clean.origin, surface,
      signer: clean.signer, person: clean.person, business: clean.business });
    for (const point of conformance.points) console.log(`${point.ok ? 'PASS' : 'FAIL'} ${point.id}${point.detail ? ': ' + point.detail : ''}`);
  } finally { await clean.close(); }
  const audit = await c.personJson('/agents/api/audit');
  const native = audit.rows.find(row => row.tool === 'lamp.incidents.resolve' && row.outcome === 'done');
  assertNativeTarget(native, `lamp://incidents/${result.id}`);
  assert.equal(conformance.ok, true, `${pendingBase.escalationSurface}; all declared points must pass`);
} finally { await fixture.close(); }
