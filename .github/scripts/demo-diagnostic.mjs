import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {target} from './demo-diagnostic-sanitize.mjs';
import {capture, cleanupCategory} from './demo-diagnostic-capture.mjs';

const directory = join(process.env.RUNNER_TEMP || tmpdir(), 'lamp-demo-diagnostic');
const control = `${directory}-control.json`;
const delay = ms => new Promise(done => setTimeout(done, ms));
const readReport = () => { try { return JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')); } catch { return null; } };
function emit(category) { process.stdout.write(`${JSON.stringify({at: new Date().toISOString(), category})}\n`); }
function authorized() {
  return process.env.GITHUB_ACTIONS === 'true' && process.env.DEMO_DIAGNOSTIC === 'true' && process.env.DEMO_PROOF === 'true'
    && (!process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID === target.account)
    && Boolean(process.env.CLOUDFLARE_API_TOKEN);
}
function stopOwnedCapture() {
  try {
    const {pid} = JSON.parse(readFileSync(control, 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 1) process.kill(pid, 'SIGTERM');
  } catch { /* Already exited or not started. */ }
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'stop') {
    if (!readReport()?.complete) stopOwnedCapture();
    for (let i = 0; i < 400 && existsSync(control); i++) await delay(100);
    const category = existsSync(control) ? 'cleanup-incomplete' : cleanupCategory(readReport());
    emit(category);
    if (category !== 'cleanup-complete') process.exitCode = 1;
    return;
  }
  if (mode === 'wait') {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stopOwnedCapture);
    for (let i = 0; i < 460; i++) {
      const report = readReport();
      if (report?.complete && !existsSync(control)) {
        const cleanup = cleanupCategory(report);
        emit(cleanup === 'cleanup-complete' ? report.captureResult : cleanup);
        if (report.captureResult !== 'capture-window-complete' || cleanup !== 'cleanup-complete') process.exitCode = 1;
        return;
      }
      await delay(1000);
    }
    stopOwnedCapture(); emit('overall-deadline'); process.exitCode = 1; return;
  }
  if (!authorized()) { emit('diagnostic-authorization-rejected'); process.exitCode = 1; return; }
  if (mode === 'capture') {
    const report = await capture(directory);
    rmSync(control, {force: true});
    // This process owns all fetch/WebSocket handles; exiting closes any handle
    // whose graceful close timed out. No raw files or child CLI process exists.
    process.exit(report.captureResult === 'capture-window-complete' && cleanupCategory(report) === 'cleanup-complete' ? 0 : 1);
  }
  if (mode !== 'start') { emit('capture-unavailable'); process.exitCode = 1; return; }
  mkdirSync(directory, {mode: 0o700});
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'capture'], {detached: true, stdio: 'ignore'});
  writeFileSync(control, JSON.stringify({pid: child.pid}), {mode: 0o600});
  child.unref();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stopOwnedCapture);
  for (let i = 0; i < 600; i++) {
    const report = readReport();
    if (report?.captureReadyAt && !report.complete) { emit('capture-ready'); return; }
    if (report?.complete) { emit('capture-unavailable'); process.exitCode = 1; return; }
    await delay(100);
  }
  stopOwnedCapture(); emit('capture-unavailable'); process.exitCode = 1;
}
main().catch(() => { stopOwnedCapture(); emit('capture-unavailable'); process.exitCode = 1; });
