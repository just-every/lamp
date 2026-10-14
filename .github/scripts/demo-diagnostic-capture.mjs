import {writeFileSync, appendFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {sanitize, target} from './demo-diagnostic-sanitize.mjs';
import {provider, now} from './demo-diagnostic-provider.mjs';

export function cleanupCategory(report) {
  if (report?.complete !== true) return 'cleanup-uncertain';
  const cleanup = report.cleanup;
  if (cleanup?.providerResult === 'uncertain' || cleanup?.tailCreationUncertain === true) return 'cleanup-uncertain';
  if (cleanup?.socketClosed !== true) return 'cleanup-incomplete';
  if (cleanup.providerResult === 'complete' && cleanup.tailDeleted === true) return 'cleanup-complete';
  if (cleanup.providerResult === 'not-required' && cleanup.tailDeleted === false) return 'cleanup-complete';
  return 'cleanup-incomplete';
}

export async function capture(directory) {
  const sha = value => /^[a-f0-9]{40}$/.test(value || '') ? value : null;
  const number = value => /^\d{1,15}$/.test(value || '') ? Number(value) : null;
  const reportPath = join(directory, 'report.json');
  const report = {
    schemaVersion: 1, ...target, startedAt: now(), captureReadyAt: null, endedAt: null, complete: false,
    deployedSource: '1d5273a85022b1e96964d296396183b14f0f5d0b', deployedSourceIdentity: 'operator-supplied-existing-deployment',
    diagnosticRevision: sha(process.env.GITHUB_SHA), runId: number(process.env.GITHUB_RUN_ID), runAttempt: number(process.env.GITHUB_RUN_ATTEMPT),
    interface: 'Worker-tail-API-trace-v1', implementationReference: 'Wrangler-4.129.1-createTail',
    captureSeconds: 360, captureDeadlineSeconds: 420, overallDeadlineSeconds: 460, counts: {}, captureResult: 'starting',
    attribution: 'time-window-only; concurrent-events-cannot-be-excluded; instance-ordinals-are-not-request-correlation',
    logSource: 'Worker-and-Durable-Object-only; Container-stdout-not-established',
    oneStartResult: 'root-browser-evidence-required', publicResponseStatus: null, publicResponseElapsedMs: null,
    containerDestructionVerified: false, tailCreationAttempted: false,
    cleanup: {socketClosed: false, tailDeleted: false, providerResult: 'not-required', rawFilesCreated: false},
  };
  const save = () => {
    writeFileSync(`${reportPath}.next`, `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
    renameSync(`${reportPath}.next`, reportPath);
  };
  const record = value => {
    report.counts[value.category] = (report.counts[value.category] || 0) + 1;
    if (value.category !== 'unclassified') appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({at: now(), ...value})}\n`, {mode: 0o600});
    save();
  };
  save();
  const api = provider(record);
  let socket, tail, finishStarted = false, captureTimer, readyTimer, overallTimer, startup;
  let finishResolve;
  const finished = new Promise(resolve => { finishResolve = resolve; });
  async function finish(reason) {
    if (finishStarted) return;
    finishStarted = true;
    clearTimeout(captureTimer); clearTimeout(readyTimer); clearTimeout(overallTimer);
    report.captureResult = reason;
    // Wait for an in-flight create request so its returned tail id is cleaned up.
    await startup?.catch(() => {});
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, 2000);
        socket.addEventListener('close', () => { clearTimeout(timeout); resolve(); }, {once: true});
        try { socket.close(); } catch { clearTimeout(timeout); resolve(); }
      });
    }
    report.cleanup.socketClosed = !socket || socket.readyState === WebSocket.CLOSED;
    if (tail) {
      try {
        await api.deleteTail(tail.id);
        report.cleanup.tailDeleted = true; report.cleanup.providerResult = 'complete';
      } catch (error) {
        report.cleanup.providerResult = error.providerRejected === true ? 'incomplete' : 'uncertain';
      }
    }
    report.cleanup.tailCreationUncertain = report.cleanup.providerResult === 'uncertain' && !tail;
    if (report.captureReadyAt && reason !== 'cancelled') {
      try {
        report.after = await api.snapshot('after');
        if (!report.after.complete) report.captureResult = 'capture-unavailable';
      }
      catch { report.captureResult = 'capture-unavailable'; }
    }
    report.stageClassifications = ['health-timeout', 'owner-claim-rejected', 'container-start-error'].filter(category => report.counts[category]);
    report.stageDistinguished = report.stageClassifications.length === 1 && report.stageClassifications[0] !== 'container-start-error';
    report.runtimeFailureEvidence = report.stageClassifications.length ? 'captured-see-classifications-and-attribution-limit' : 'none-captured';
    report.cleanup.processExitClosesRemainingHandles = true;
    report.complete = true; report.endedAt = now();
    report.cleanup.category = cleanupCategory(report);
    try { save(); } finally { finishResolve(); }
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => void finish('cancelled'));
  process.on('uncaughtException', () => void finish('capture-unavailable'));
  process.on('unhandledRejection', () => void finish('capture-unavailable'));
  overallTimer = setTimeout(() => void finish('overall-deadline'), 420000);
  readyTimer = setTimeout(() => void finish('capture-unavailable'), 45000);
  startup = (async () => {
    report.application = await api.validateApplication();
    if (finishStarted) return;
    report.before = await api.snapshot('before');
    if (finishStarted) return;
    if (!report.before.complete) throw Error('baseline-incomplete');
    report.tailCreationAttempted = true; report.cleanup.providerResult = 'uncertain'; save();
    try {
      tail = await api.createTail();
      report.cleanup.providerResult = 'incomplete';
    } catch (error) {
      report.cleanup.providerResult = error.providerRejected === true ? 'not-required' : 'uncertain';
      throw error;
    }
    report.tailExpiresAt = tail.expiresAt;
    if (finishStarted) return;
    const url = new URL(tail.url);
    // This URL is returned by the authenticated, fixed Worker-tail endpoint;
    // it is never accepted as an operator input or given the API Bearer token.
    if (url.protocol !== 'wss:' || url.username || url.password) throw Error('unexpected-tail-url');
    socket = new WebSocket(url, 'trace-v1');
    socket.addEventListener('open', () => {
      if (finishStarted) return;
      socket.send(JSON.stringify({debug: false}));
      report.captureReadyAt = now(); report.captureResult = 'capturing'; clearTimeout(readyTimer);
      record({category: 'capture-ready'});
      captureTimer = setTimeout(() => void finish('capture-window-complete'), 360000);
    });
    socket.addEventListener('message', async event => {
      if (finishStarted) return;
      let records;
      try {
        const data = event.data;
        if (!(typeof data === 'string' || data instanceof Blob) || (typeof data === 'string' ? data.length : data.size) > 1048576) throw Error('unexpected-frame');
        records = sanitize('tail', JSON.parse(typeof data === 'string' ? data : await data.text()));
      } catch { records = [{category: 'unclassified'}]; }
      if (!finishStarted) for (const value of records) record(value);
    });
    socket.addEventListener('error', () => void finish('capture-unavailable'));
    socket.addEventListener('close', () => { if (!finishStarted) void finish('capture-disconnected'); });
  })();
  startup.catch(() => void finish('capture-unavailable'));
  await finished;
  return report;
}
