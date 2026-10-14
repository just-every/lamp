import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, readFile, readdir, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { readDevKey } from '@runeditrun/rer/internal/modules/operator-auth/dev/sign-in-as.mjs';
import { createRedaction } from '@runeditrun/rer/redaction';
import { reservePort } from '../e2e/worker-startup.mjs';
import { exerciseDemo } from '../demo-effects.mjs';

async function digestTree(root) {
  const hash = createHash('sha256');
  async function walk(path) { for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) { const file = join(path, entry.name); hash.update(file.slice(root.length)); if (entry.isDirectory()) await walk(file); else hash.update(await readFile(file)); } }
  await walk(root); return hash.digest('hex');
}

test('disposable demo opens signed in, captures effects and leaves owner state intact', { timeout: 900000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lamp-demo-')), servers = await mkdtemp(join(tmpdir(), 'lamp-demo-servers-'));
  const { RER_LOCAL_OPERATION, RER_ONBOARDING_PROCESS_OWNER, ...inherited } = process.env;
  const env = { ...inherited, LAMP_VITE_CACHE_DIR: join(root, '.vite-cache'), RER_SERVER_JOURNEY: '1', RER_SERVERS_DIR: servers, CI: 'true', X_LOCAL_EXPLORER: 'false' };
  const cli = (...args) => spawnSync(process.execPath, ['node_modules/@runeditrun/rer/bin/rer.mjs', ...args], { cwd: root, env, encoding: 'utf8', timeout: 600000 });
  let child, browser, firstResult;
  const stop = async () => { if (child?.exitCode === null) { const result = cli('demo', '--stop'); assert.equal(result.status, 0); await new Promise(done => child.exitCode !== null ? done() : child.once('exit', done)); } child = undefined; };
  try {
    execFileSync('sh', ['-c', 'git ls-files -z --cached --others --exclude-standard | tar --null -T - -cf - | tar -xf - -C "$1"', 'copy', root]);
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    const port = await reservePort(), origin = `http://127.0.0.1:${port}`, pageOrigin = `http://localhost:${port}`;
    assert.equal(cli('setup', '--owner-email', 'owner@example.invalid', '--non-interactive', '--port', String(port)).status, 0, 'ordinary setup succeeds');
    await appendFile(join(root, '.dev.vars'), '\nAI_PROVIDER_URL=https://ai.example.invalid/v1\nAI_PROVIDER_MODEL=demo-test\nAI_PROVIDER_API_KEY=uncredentialed-test-value\n');
    const before = await digestTree(join(root, '.wrangler/state'));
    browser = await chromium.launch();
    for (const first of [true, false]) {
      let output = '';
      child = spawn(process.execPath, ['node_modules/@runeditrun/rer/bin/rer.mjs', 'demo'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
      for (const deadline = Date.now() + 180000; !output.includes('RER_READY ') && child.exitCode === null && Date.now() < deadline;) await new Promise(done => setTimeout(done, 250));
      assert.ok(output.includes('RER_READY '), 'rer demo reached readiness; private output is never printed');
      const key = await readDevKey(root);
      const context = await browser.newContext();
      await context.route(url => url.pathname.startsWith('/@fs/'), route => route.continue({ headers: { ...route.request().headers(), 'x-rer-dev-key': key } }));
      const page = await context.newPage();
      const browserErrors=[];
      page.on('pageerror',error=>browserErrors.push(error.message));
      page.on('response',response=>{if(response.status()>=400)browserErrors.push(response.status()+' '+new URL(response.url()).pathname);});
      await page.goto((await readFile(join(root, '.rer/local/open-url'), 'utf8')).trim());
      await page.waitForURL(url => url.pathname === '/app');
      await page.locator('#rer-demo-bar').waitFor();
      assert.equal(new URL(page.url()).pathname, '/app');
      await page.getByRole('link', { name: 'Components', exact: true }).first().click();
      try{await page.getByText('Background jobs', { exact: true }).first().waitFor();}
      catch(error){const redaction=createRedaction();redaction.addSecrets([key]);t.diagnostic(redaction.redact('Browser URL: '+page.url()+'\n'+browserErrors.join('\n')+'\n'+output));throw error;}
      if (process.env.LAMP_DEMO_EVIDENCE) { await mkdir(process.env.LAMP_DEMO_EVIDENCE, { recursive: true }); await page.screenshot({ path: join(process.env.LAMP_DEMO_EVIDENCE, first ? 'demo-components.png' : 'fresh-demo.png'), fullPage: true }); }
      const cookie = (await context.cookies(origin)).map(row => `${row.name}=${row.value}`).join('; ');
      const fetch = async (url, init = {}) => {
        const form = init.body instanceof URLSearchParams;
        const response = await context.request.fetch(url, { method: init.method, headers: { ...init.headers, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, data: form ? init.body.toString() : init.body, maxRedirects: init.redirect === 'manual' ? 0 : 20 });
        return { status: response.status(), headers: new Headers(response.headers()), text: () => response.text(), json: () => response.json() };
      };
      if (first) {
        firstResult = await exerciseDemo({ origin, pageOrigin, key, cookie, fetch });
        t.diagnostic('Captured subscriber mail and sender check; blocked: ' + firstResult.witnessed.join(', '));
        if (process.env.LAMP_DEMO_EVIDENCE) { await page.goto(origin + '/app'); await page.getByRole('region', { name: 'Active incidents', exact: true }).getByRole('link', { name: new RegExp(firstResult.incidentTitle) }).waitFor(); await page.locator('#rer-demo-bar summary').click(); await page.screenshot({ path: join(process.env.LAMP_DEMO_EVIDENCE, 'demo-effects.png'), fullPage: true }); }
      }
      else {
        const rows = await (await fetch(origin + '/api/app/incidents', { headers: { Cookie: cookie, 'x-rer-dev-key': key } })).json();
        assert.equal(rows.incidents.find(row => row.id === firstResult.incidentId).lifecycle, firstResult.initialLifecycle, 'previous demo edit was deleted');
      }
      await context.close(); await stop();
      assert.deepEqual(await readdir(join(root, '.rer/demo')), [], 'stopped demo data removed');
      assert.equal(await digestTree(join(root, '.wrangler/state')), before, 'owner state bytes unchanged');
    }
  } finally { await browser?.close(); await stop(); await rm(root, { recursive: true, force: true }); await rm(servers, { recursive: true, force: true }); }
});
