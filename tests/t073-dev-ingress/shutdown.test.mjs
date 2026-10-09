import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { stopProcessGroup } from './shutdown.mjs';

function liveMembers(group) {
  return execFileSync('ps', ['-axo', 'pid=,pgid=,stat='], { encoding: 'utf8' }).trim().split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([, pgid, state]) => Number(pgid) === group && !state.startsWith('Z'));
}

for (const exitsFirst of [false, true]) {
  test(`teardown stops actual descendants when the launcher ${exitsFirst ? 'already exited' : 'is running'}`, { timeout: 30_000 }, async () => {
    const script = `
      const { spawn } = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      process.stdout.write(String(descendant.pid));
      ${exitsFirst ? 'descendant.unref();' : 'setInterval(() => {}, 1000);'}
    `;
    const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    try {
      const [ready] = await once(child.stdout, 'data');
      assert.match(ready.toString(), /^\d+$/);
      if (exitsFirst) await exited;
      assert.ok(liveMembers(child.pid).length >= 1, 'the descendant is actually running');
      await stopProcessGroup(child);
      assert.deepEqual(liveMembers(child.pid), [], 'no live process in the owned group remains');
      await stopProcessGroup(child); // Cleanup stays idempotent after exit/reaping.
    } finally {
      await stopProcessGroup(child);
    }
  });
}
