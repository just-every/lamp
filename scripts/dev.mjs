import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { devOptions } from './local-options.mjs';

// A real page-host request records development notification origin metadata.
// A fresh installation returns 503 until owner setup; this never seeds product data.
async function warmPageOrigin(child, appOrigin, pageOrigin) {
  for (let attempt = 0; attempt < 240 && child.exitCode === null && !child.killed; attempt++) {
    try {
      const response = await fetch(`${pageOrigin}/`, { signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      // rer's proxy answers 502 until this Vite server listens behind it.
      if (response.status === 502) { await delay(500); continue; }
      console.log(`Lamp landing page: ${appOrigin}/  (sign in at ${appOrigin}/signin)\nLamp status page:  ${pageOrigin}/`);
      if (response.status === 503) console.log('The status page is unavailable until owner setup and a public snapshot are ready. Open sign-in to complete setup.');
      else if (!response.ok) console.error(`Lamp status page answered ${response.status}; check the local runtime diagnostics.`);
      return;
    } catch {
      if (!child.killed && child.exitCode === null) await delay(500);
    }
  }
}

try {
  const { port, verbose, forwarded } = devOptions(process.argv.slice(2));
  const migrated = spawnSync(process.execPath, ['scripts/migrate-local.mjs', ...(verbose ? ['--verbose'] : [])], { stdio: 'inherit' });
  if (migrated.status !== 0) throw new Error('Local migration failed; development server was not started.');
  const child = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', port, '--strictPort', ...forwarded], {
    stdio: 'inherit', env: { ...process.env },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
  // Behind `rer dev` the browser reaches this server through the CLI's proxy on
  // the public port it names in RER_DEV_ORIGIN.
  const publicPort = process.env.RER_DEV_ORIGIN ? new URL(process.env.RER_DEV_ORIGIN).port : port;
  void warmPageOrigin(child, `http://127.0.0.1:${publicPort}`, `http://localhost:${publicPort}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
