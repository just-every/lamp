import { appendFile, readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

const repositoryShape = value => Number.isSafeInteger(value?.id) && value.id > 0 && typeof value.full_name === 'string';
const runShape = value => value && Number.isSafeInteger(value.id) && value.id > 0
 && Number.isSafeInteger(value.workflow_id) && value.workflow_id > 0
 && typeof value.name === 'string' && /^[a-f0-9]{40}$/.test(value.head_sha ?? '')
 && (typeof value.head_branch === 'string' || value.head_branch === null)
 && typeof value.event === 'string' && typeof value.status === 'string'
 && (typeof value.conclusion === 'string' || value.conclusion === null)
 && repositoryShape(value.repository) && (value.head_repository === null || repositoryShape(value.head_repository));
const jobShape = value => value && Number.isSafeInteger(value.id) && value.id > 0 && Number.isSafeInteger(value.run_id)
 && typeof value.name === 'string' && typeof value.status === 'string'
 && (typeof value.conclusion === 'string' || value.conclusion === null);
const succeeded = item => item.status === 'completed' && item.conclusion === 'success';

// A push of this SHA to another branch or tag runs the jobs a main push runs.
// A pull request tests its merge ref and a dispatch may run a subset, so
// neither is evidence. The newest such push must have succeeded, and so must
// every newer run of this workflow for the SHA.
function mainEvidence(runs, { sha, repository, workflow, runId, currentRun }) {
 if (String(currentRun.id) !== runId || currentRun.head_sha !== sha || currentRun.repository.full_name !== repository
  || currentRun.name !== workflow || currentRun.event !== 'push' || currentRun.head_branch !== 'main') return;
 const related = runs.filter(run => run.id !== currentRun.id
  && run.workflow_id === currentRun.workflow_id && run.name === workflow
  && run.repository.id === currentRun.repository.id && run.repository.full_name === repository
  && run.head_repository?.id === currentRun.repository.id && run.head_repository.full_name === repository
  && run.head_sha === sha);
 const evidence = related.filter(run => run.event === 'push' && run.head_branch && run.head_branch !== 'main')
  .reduce((newest, run) => !newest || run.id > newest.id ? run : newest, undefined);
 if (evidence && succeeded(evidence) && related.every(run => run.id <= evidence.id || succeeded(run))) return evidence;
}

// Only complete API evidence can authorize skipping the main duplicate.
export async function lookupMainVerification({ env = process.env, fetch = globalThis.fetch } = {}) {
 if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') return false;
 try {
  if (!/^[^/]+\/[^/]+$/.test(env.GITHUB_REPOSITORY ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
   || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || !env.GITHUB_TOKEN) return false;
  const api = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const base = `${api}/repos/${env.GITHUB_REPOSITORY}/actions`;
  const signal = AbortSignal.timeout(20000);
  const get = async url => {
   const response = await fetch(url, { signal, redirect: 'error', headers: {
    Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
   } });
   if (response.status !== 200) throw Error('GitHub run lookup unavailable');
   return response.json();
  };
  // Every page full, one stable total within GitHub's 1,000-result limit, and
  // distinct well-formed items; anything less is no evidence.
  const list = async (path, key, shape) => {
   const items = [];
   for (let page = 1, total; page <= 10; page++) {
    const response = await get(`${base}/${path}&per_page=100&page=${page}`);
    if (!Number.isSafeInteger(response?.total_count) || response.total_count < 0 || response.total_count > 1000
     || (total ?? response.total_count) !== response.total_count || !Array.isArray(response[key])
     || response[key].length !== Math.min(100, response.total_count - items.length) || !response[key].every(shape)) return;
    total = response.total_count;
    items.push(...response[key]);
    if (items.length === total) return new Set(items.map(item => item.id)).size === total ? items : undefined;
   }
  };
  const currentRun = await get(`${base}/runs/${env.GITHUB_RUN_ID}`);
  if (!runShape(currentRun)) return false;
  const runs = await list(`workflows/${currentRun.workflow_id}/runs?head_sha=${env.GITHUB_SHA}`, 'workflow_runs', runShape);
  const evidence = runs && mainEvidence(runs, { sha: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY,
   workflow: env.GITHUB_WORKFLOW, runId: env.GITHUB_RUN_ID, currentRun });
  if (!evidence) return false;
  // Every job of the evidence succeeded, except this main-only gate job and
  // jobs this main run has already skipped by their own conditions.
  const jobs = await list(`runs/${evidence.id}/jobs?filter=latest`, 'jobs', jobShape);
  if (!jobs?.some(succeeded) || !jobs.every(job => job.run_id === evidence.id
   && (succeeded(job) || (job.status === 'completed' && job.conclusion === 'skipped')))) return false;
  const skipped = jobs.filter(job => !succeeded(job) && job.name !== env.GITHUB_JOB);
  if (!skipped.length) return true;
  const mainJobs = await list(`runs/${currentRun.id}/jobs?filter=latest`, 'jobs', jobShape);
  const skippedOnMain = new Set(mainJobs?.filter(job => job.run_id === currentRun.id
   && job.status === 'completed' && job.conclusion === 'skipped').map(job => job.name));
  return skipped.every(job => skippedOnMain.has(job.name));
 } catch {
  // Authentication, rate limits, network/JSON failures and timeouts all run CI.
 }
 return false;
}

// Reads only what a permission check needs from workflow YAML: nested block
// mappings and one-line values. A sequence or a value that continues on later
// lines is opaque; any other shape makes the file unreadable (null).
const opaque = Symbol('opaque');
function outline(text) {
 const root = {}, stack = [{ indent: -1, node: root }];
 let skip = Infinity, open;
 for (const raw of text.split(/\r?\n/)) {
  const line = raw.replace(/(^|\s)#.*$/, '').trimEnd(), indent = line.search(/\S/);
  if (indent < 0 || /^(---|\.\.\.)$/.test(line)) continue;
  const body = line.slice(indent), item = /^-(\s|$)/.test(body);
  if (indent > skip || (indent === skip && item)) continue;
  skip = Infinity;
  if (item) {
   if (!open || indent < open.indent) return null;
   open.parent[open.key] = opaque;
   skip = open.indent;
   open = undefined;
   continue;
  }
  const match = /^(?:'([^']*)'|"([^"]*)"|([^\s'"{[\]}&*!|>-][^:]*?))\s*:(?:\s+(.*))?$/.exec(body);
  if (!match) return null;
  while (stack.at(-1).indent >= indent) stack.pop();
  const parent = stack.at(-1).node, key = match[1] ?? match[2] ?? match[3], value = match[4]?.trim();
  if (!value) {
   parent[key] = {};
   stack.push({ indent, node: parent[key] });
   open = { indent, parent, key };
   continue;
  }
  open = undefined;
  skip = indent;
  const flow = /^\{(.*)\}$/.exec(value)?.[1].trim(), unquote = text => text.trim().replace(/^(['"])(.*)\1$/, '$2');
  parent[key] = flow !== undefined ? Object.fromEntries(flow ? flow.split(',').map(pair => pair.split(':').map(unquote)) : [])
   : /^[{[&*!|>]/.test(value) ? opaque : unquote(value);
 }
 return root;
}

// GitHub refuses to start a run whose called workflow requests more token
// permission than its calling job grants; actionlint does not report it.
const levels = ['none', 'read', 'write'];
const allScopes = ['actions', 'attestations', 'checks', 'contents', 'deployments', 'discussions', 'id-token',
 'issues', 'models', 'packages', 'pages', 'pull-requests', 'security-events', 'statuses'];
const readable = node => node && typeof node === 'object' && node['<<'] === undefined;
const level = (permissions, scope) => {
 if (permissions === 'read-all' || permissions === 'write-all') return permissions === 'read-all' ? 1 : 2;
 const index = readable(permissions) ? levels.indexOf(permissions[scope] ?? 'none') : -1;
 return index < 0 ? undefined : index;
};
async function workflowPermissionErrors(directory = '.github/workflows') {
 const files = (await readdir(directory)).filter(name => /\.ya?ml$/.test(name));
 const texts = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(join(directory, name), 'utf8')])));
 const errors = [];
 for (const name of files.filter(file => texts[file].includes('./.github/workflows/'))) {
  const caller = outline(texts[name]);
  if (!readable(caller)) { errors.push(`${name}: cannot read its jobs`); continue; }
  for (const [id, job] of Object.entries(readable(caller.jobs) ? caller.jobs : {})) {
   const target = /^\.\/\.github\/workflows\/([^/@]+\.ya?ml)$/.exec(job?.uses ?? '')?.[1];
   if (!target) continue;
   const callee = texts[target] === undefined ? null : outline(texts[target]);
   if (!readable(callee) || !readable(job)) { errors.push(`${name} job ${id}: cannot read its call to ${target}`); continue; }
   const granted = job.permissions ?? caller.permissions;
   const requests = Object.entries(readable(callee.jobs) ? callee.jobs : {})
    .map(([calledId, called]) => [calledId, readable(called) ? called.permissions ?? callee.permissions : opaque])
    .filter(([, requested]) => requested !== undefined);
   if (requests.length && granted === undefined) { errors.push(`${name} job ${id}: grant permissions on the job that calls ${target}`); continue; }
   for (const [calledId, requested] of requests) {
    const scopes = requested === 'read-all' || requested === 'write-all' ? allScopes : readable(requested) ? Object.keys(requested) : null;
    const compared = scopes?.map(scope => [scope, level(requested, scope), level(granted, scope)]);
    if (!compared || compared.some(([, want, have]) => want === undefined || have === undefined)) {
     errors.push(`${name} job ${id}: cannot compare its permissions with ${target} job ${calledId}`);
    } else {
     for (const [scope, want, have] of compared) if (have < want) errors.push(`${name} job ${id} grants ${scope}: ${levels[have]}, but ${target} job ${calledId} requests ${scope}: ${levels[want]}`);
    }
   }
  }
 }
 return errors;
}

// Symlinked paths (macOS /tmp, linked checkouts) still run as the command.
const invokedDirectly = () => { try { return realpathSync(process.argv[1]) === realpathSync(import.meta.filename); } catch { return false; } };
if (invokedDirectly()) {
 const [mode, tier] = process.argv.slice(2);
 if (mode === '--main-skip' && !tier) {
  const output = `skip=${await lookupMainVerification()}\n`;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
 } else if (mode === '--plan' && !tier) {
  const { verificationPlan } = await import('./verify-app.mjs');
  const { planVerification } = await import('./verify-plan.mjs');
  const decision = await planVerification({ plan: await verificationPlan() });
  const output = Object.entries({ ...decision, matrix: JSON.stringify(decision.matrix), readers: JSON.stringify(decision.readers), has_shards: decision.matrix.include.length > 0 })
   .map(([key, value]) => `${key}=${value}\n`).join('');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
 } else if (mode === '--light' && !tier) {
  const { run } = await import('./verify-app.mjs');
  const readers = JSON.parse(process.env.LIGHT_READERS);
  if (!Array.isArray(readers) || readers.some(command => typeof command !== 'string')) throw Error('Invalid light readers');
  run('node scripts/edition-authoring/cli.mjs check');
  run('pnpm run check');
  for (const command of readers) run(command);
  run('pnpm run build --site');
 } else if (mode === '--check-workflows' && !tier) {
  const errors = await workflowPermissionErrors();
  for (const error of errors) console.error(error);
  if (errors.length) process.exit(1);
  console.log('Every local reusable workflow call grants what its jobs request.');
 } else {
  const { verificationPlan, run } = await import('./verify-app.mjs');
  const plan = await verificationPlan();
  if (mode === '--matrix') {
   if (!['push', 'nightly', 'all'].includes(tier)) throw Error('Usage: verify-ci.mjs --matrix push|nightly|all');
   const shards = tier === 'all' ? [...plan.push, ...plan.nightly] : plan[tier];
   console.log(JSON.stringify({ include: shards.map(({ name, browser }) => ({ name, browser })) }));
  } else {
   const shard = [...plan.push, ...plan.nightly].find(shard => shard.name === mode);
   if (!shard || tier) throw Error('Usage: verify-ci.mjs SHARD');
   // Exactly one job retains rer verify's hosted-output and hydration checks.
   run(shard.hosted ? 'pnpm run verify' : 'pnpm run verify:app', { ...process.env, SEED_VERIFY_SHARD: shard.name });
  }
 }
}
