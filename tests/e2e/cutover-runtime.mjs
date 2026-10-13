import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { commandCustody } from '@runeditrun/rer/internal/onboarding/command-custody.mjs';
import { createProcessBaseline, createProcessScope, processScopeEnvironment } from '@runeditrun/rer/process-scope';

// Keep command diagnostics, but never retain sign-in URLs or generated secrets.
const sanitize = value => String(value)
  .replace(/https?:\/\/[^\s'"<>]+/g, '[URL]')
  .replace(/(?:[A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|COOKIE|PASSWORD)[A-Za-z0-9_]*\s*[=:]\s*)[^\s,;]+/gi, '[secret assignment]')
  .replace(/[A-Za-z0-9_-]{43,}/g, '[long credential]');

export async function cutoverRuntime(evidence) {
  const root = await mkdtemp(join(tmpdir(), 'lamp-cutover-journey-'));
  const privateDirectory = await mkdtemp(join(tmpdir(), 'lamp-cutover-private-'));
  const cache = resolve('node_modules/.vite', basename(root));
  // Setup is an independent owner journey; do not inherit another CLI's queue,
  // process custody, credentials or local storage configuration.
  const env = { PATH: dirname(process.execPath) + ':' + process.env.PATH,
    HOME: join(privateDirectory, 'home'), TMPDIR: privateDirectory, TZ: 'UTC', CI: 'true',
    RER_SERVER_JOURNEY: '1', RER_SERVERS_DIR: join(privateDirectory, 'servers'),
    X_LOCAL_EXPLORER: 'false', LAMP_VITE_CACHE_DIR: cache };
  await mkdir(env.HOME, { recursive: true });
  const pkg = JSON.parse(await readFile(resolve('node_modules/@runeditrun/rer/package.json'), 'utf8'));
  const cli = join(root, 'node_modules/@runeditrun/rer', pkg.bin.rer);
  const baseline = await createProcessBaseline();
  const owned = args => {
    const scope = createProcessScope(baseline);
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, env: processScopeEnvironment(scope, env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return { child, custody: commandCustody(child, scope) };
  };
  let sequence = 0, server, serverCustody;
  let output = '';
  const run = async (...args) => {
    const { child, custody } = owned(args);
    let text = '', timeout;
    const log = join(evidence, `rer-${++sequence}-${args[0]}.log`);
    let writes = Promise.resolve();
    const save = () => { writes = writes.then(() => writeFile(log, sanitize(text))); };
    const recording = setInterval(save, 5000);
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    try {
      const status = await Promise.race([
        new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`rer ${args[0]} exceeded its deadline; see sanitized command log`)), 600000); }),
      ]);
      clearInterval(recording); save(); await writes;
      assert.equal(status, 0, `rer ${args[0]} succeeds; see sanitized command log`);
    } finally { clearInterval(recording); clearTimeout(timeout); try { await custody.stop(); } finally { save(); await writes; } }
  };
  return { root, env, run,
    async start() {
      ({ child: server, custody: serverCustody } = owned(['dev', '--login', '--foreground']));
      server.stdout.on('data', chunk => { output += chunk; });
      server.stderr.on('data', chunk => { output += chunk; });
      const deadline = Date.now() + 180000;
      while (!output.includes('RER_READY ') && server.exitCode === null && Date.now() < deadline) await new Promise(done => setTimeout(done, 250));
      await writeFile(join(evidence, 'rer-dev.log'), sanitize(output));
      assert.ok(output.includes('RER_READY '), 'rer dev ready; see sanitized command log');
    },
    async close() {
      try { if (server) { try { await run('dev', '--stop'); } finally { await serverCustody.stop(); } } }
      finally {
        await writeFile(join(evidence, 'rer-dev.log'), sanitize(output));
        await rm(cache, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
        await rm(privateDirectory, { recursive: true, force: true });
      }
    },
  };
}
