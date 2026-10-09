import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Kill only the detached process group this test created, including descendants
 * left behind by a package launcher. Teardown must have a bounded deadline. */
export async function stopProcessGroup(child) {
  if (!child?.pid) return;
  const exited = child.exitCode === null && child.signalCode === null ? once(child, 'exit') : Promise.resolve();
  const members = () => execFileSync('ps', ['-axo', 'pid=,pgid=,uid=,stat='], { encoding: 'utf8' }).trim().split('\n')
    .map(line => line.trim().split(/\s+/))
    // Zombies have exited and cannot hold listeners or receive a signal. On
    // macOS a group containing only zombies can report EPERM from killpg.
    .filter(([, group, uid, state]) => Number(group) === child.pid && Number(uid) === process.getuid() && !state.startsWith('Z'));
  const signal = value => {
    // Signal only freshly identified live members. Group-wide killpg can race
    // the launcher's exit on macOS even while a descendant is exiting.
    for (const [pid] of members()) {
      try { process.kill(Number(pid), value); } catch (error) {
        const stillLive = members().some(([current]) => current === pid);
        if (error.code !== 'ESRCH' && !(error.code === 'EPERM' && !stillLive)) throw error;
      }
    }
  };
  signal('SIGTERM');
  let timeout;
  await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(resolve, 10_000); })]);
  clearTimeout(timeout);
  signal('SIGKILL');
  await exited;
  const deadline = Date.now() + 5000;
  while (members().length && Date.now() < deadline) await pause(100);
  if (members().length) throw new Error('The test-owned process group did not stop.');
}
