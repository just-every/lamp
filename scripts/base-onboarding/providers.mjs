import { access, constants } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { delimiter, isAbsolute, resolve } from 'node:path';

const PROVIDER_NAMES = ['cloudflare', 'github'];
const MAX_OUTPUT = 256 * 1024;

/**
 * These are the only provider commands the installer can run. Values returned
 * by local files or HTTP requests never become command arguments.
 */
export const PROVIDER_COMMANDS = Object.freeze({
  cloudflare: Object.freeze({
    binary: 'wrangler',
    version: Object.freeze(['--version']),
    auth: Object.freeze(['whoami']),
    connect: Object.freeze(['login']),
  }),
  github: Object.freeze({
    binary: 'gh',
    version: Object.freeze(['--version']),
    auth: Object.freeze(['auth', 'status', '--hostname', 'github.com']),
    account: Object.freeze(['api', 'user', '--hostname', 'github.com', '--jq', '{login,id,name}']),
    repository: Object.freeze(['repo', 'view', '--json', 'nameWithOwner,isPrivate,defaultBranchRef,pushedAt']),
    connect: Object.freeze(['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']),
  }),
});

function providerName(value) {
  if (typeof value !== 'string' || !PROVIDER_NAMES.includes(value)) {
    throw new Error('Unsupported provider');
  }
  return value;
}

function commandConfig(provider) {
  return PROVIDER_COMMANDS[providerName(provider)];
}

function output(value) {
  return typeof value === 'string' ? value.slice(0, MAX_OUTPUT) : '';
}

async function executable(binary, env = process.env) {
  if (isAbsolute(binary)) {
    try {
      await access(binary, constants.X_OK);
      return binary;
    } catch {
      return null;
    }
  }
  for (const directory of String(env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, binary);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH without exposing filesystem errors to the UI.
    }
  }
  return null;
}

function runCommand(file, args, { cwd, signal, interactive = false, onDevice, env = process.env } = {}) {
  return new Promise((resolveResult, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd,
        env,
        shell: false,
        detached: false,
        stdio: [interactive ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolveResult({ code: null, signal: null, stdout: '', stderr: '' });
      return;
    }

    if (interactive) child.stdin?.end('\n');
    let stdout = '';
    let stderr = '';
    const collect = (kind, chunk) => {
      // Provider auth tools can print credentials or token fragments. Keep
      // output private to this process and bounded; callers only parse it.
      if (kind === 'stdout') stdout = (stdout + String(chunk)).slice(0, MAX_OUTPUT);
      else stderr = (stderr + String(chunk)).slice(0, MAX_OUTPUT);
      if (interactive && onDevice) {
        const clean = (stdout + stderr).replace(/\x1b\[[0-9;]*m/g, '');
        const code = clean.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
        if (code) onDevice(code);
      }
    };
    child.stdout?.on('data', chunk => collect('stdout', chunk));
    child.stderr?.on('data', chunk => collect('stderr', chunk));

    const timeout = setTimeout(() => child.kill('SIGTERM'), interactive ? 180000 : 12000);
    let settled = false;
    const abort = () => {
      if (!settled) child.kill('SIGTERM');
    };
    let processExit;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (processExit) process.removeListener('exit', processExit);
      resolveResult(result);
    };
    processExit = () => abort();
    process.once('exit', processExit);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish({ code: null, signal: null, stdout, stderr }));
    child.once('close', (code, childSignal) => finish({ code, signal: childSignal, stdout, stderr }));
  });
}

function status(provider, executablePath, state, extra = {}) {
  return {
    provider,
    installed: Boolean(executablePath),
    executable: executablePath || null,
    state,
    authenticated: state === 'connected',
    ...extra,
  };
}

function cloudflareAccounts(text) {
  const lines = String(text).split(/\r?\n/);
  const accounts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const idMatch = line.match(/\b([a-f0-9]{32})\b/i);
    if (!idMatch) continue;
    let name = line
      .replace(idMatch[0], '')
      .replace(/[│|]/g, ' ')
      .replace(/account\s*id\s*:?/gi, '')
      .trim();
    if (!name || /^id$/i.test(name)) {
      const previous = lines[index - 1] || '';
      const nameMatch = previous.match(/account\s*name\s*:?\s*([^│|]+)$/i);
      name = nameMatch?.[1]?.trim() || null;
    }
    if (name && /email|logged|token|account\s*id/i.test(name)) name = null;
    if (!accounts.some(account => account.id === idMatch[1])) {
      accounts.push({ id: idMatch[1], ...(name ? { name } : {}) });
    }
  }
  return accounts;
}

function cloudflareAuthenticated(result) {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return result.code === 0 && !/(not logged|not authenticated|run .*login|authentication required)/i.test(text);
}

function githubAuthenticated(result) {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return result.code === 0 && !/(not logged|not authenticated|no accounts|authentication required)/i.test(text);
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function gitRemoteName(value) {
  const remote = String(value || '').trim();
  const match = remote.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

async function discoverCloudflare(root, options) {
  const config = commandConfig('cloudflare');
  const path = await executable(config.binary, options.env);
  if (!path) return status('cloudflare', null, 'not_installed', { accounts: [] });
  const versionResult = await options.run(path, config.version, { cwd: root, signal: options.signal, env: options.env });
  const authResult = await options.run(path, config.auth, { cwd: root, signal: options.signal, env: options.env });
  const connected = cloudflareAuthenticated(authResult);
  return status('cloudflare', path, connected ? 'connected' : 'auth_required', {
    version: output(versionResult.stdout || versionResult.stderr).split(/\r?\n/, 1)[0] || null,
    accounts: connected ? cloudflareAccounts(`${authResult.stdout}\n${authResult.stderr}`) : [],
    connect: { command: config.connect.slice(), opensBrowser: true },
  });
}

async function discoverGithub(root, options) {
  const config = commandConfig('github');
  const path = await executable(config.binary, options.env);
  if (!path) return status('github', null, 'not_installed', { account: null, repository: null });
  const versionResult = await options.run(path, config.version, { cwd: root, signal: options.signal, env: options.env });
  const authResult = await options.run(path, config.auth, { cwd: root, signal: options.signal, env: options.env });
  const connected = githubAuthenticated(authResult);
  const result = status('github', path, connected ? 'connected' : 'auth_required', {
    version: output(versionResult.stdout || versionResult.stderr).split(/\r?\n/, 1)[0] || null,
    account: null,
    repository: null,
    connect: { command: config.connect.slice(), opensBrowser: true },
  });
  if (!connected) return result;

  const accountResult = await options.run(path, config.account, { cwd: root, signal: options.signal, env: options.env });
  const account = safeJson(output(accountResult.stdout));
  if (account && typeof account === 'object' && typeof account.login === 'string' && (typeof account.id === 'number' || typeof account.id === 'string')) {
    result.account = {
      login: account.login,
      id: String(account.id),
      ...(typeof account.name === 'string' && account.name ? { name: account.name } : {}),
    };
  }

  const remoteResult = await options.run('git', ['config', '--get', 'remote.origin.url'], { cwd: root, signal: options.signal, env: options.env });
  const nameWithOwner = gitRemoteName(remoteResult.stdout);
  if (!nameWithOwner) return result;
  const repositoryResult = await options.run(path, [...config.repository, nameWithOwner], { cwd: root, signal: options.signal, env: options.env });
  const repository = safeJson(output(repositoryResult.stdout));
  if (repository && typeof repository === 'object' && typeof repository.nameWithOwner === 'string') {
    result.repository = {
      nameWithOwner: repository.nameWithOwner,
      ...(typeof repository.isPrivate === 'boolean' ? { isPrivate: repository.isPrivate } : {}),
      ...(repository.defaultBranchRef?.name ? { defaultBranch: repository.defaultBranchRef.name } : {}),
      ...(typeof repository.pushedAt === 'string' ? { pushedAt: repository.pushedAt } : {}),
    };
  }
  return result;
}

/** Discover local CLI availability and account metadata without returning CLI output. */
export async function discoverProviders(root = process.cwd(), { signal, run = runCommand, env = process.env } = {}) {
  const directory = resolve(root);
  const options = { signal, run, env };
  const [cloudflare, github] = await Promise.all([
    discoverCloudflare(directory, options),
    discoverGithub(directory, options),
  ]);
  return { schemaVersion: 1, providers: { cloudflare, github } };
}

/**
 * Start one of the fixed, browser-based provider logins. This function is
 * intended for an explicit Connect action; discovery alone has no remote side
 * effects. The returned status is refreshed after the child exits, so a zero
 * exit code never becomes a false connected state.
 */
export async function connectProvider(root = process.cwd(), provider, { signal, onProgress, run = runCommand, env = process.env } = {}) {
  const name = providerName(provider);
  const config = commandConfig(name);
  const directory = resolve(root);
  const path = await executable(config.binary, env);
  if (!path) {
    const result = (await discoverProviders(directory, { signal, run, env })).providers[name];
    onProgress?.({ provider: name, state: result.state });
    return { ...result, operation: { state: 'failed', reason: 'not_installed' } };
  }

  onProgress?.({ provider: name, state: 'awaiting_browser' });
  const login = await run(path, config.connect.slice(), {
    cwd: directory,
    signal,
    env,
    interactive: true,
    onDevice: name === 'github' ? deviceCode => onProgress?.({ provider: name, state: 'awaiting_browser', deviceCode, verificationUrl: 'https://github.com/login/device' }) : undefined,
  });
  if (signal?.aborted) {
    onProgress?.({ provider: name, state: 'cancelled' });
    const result = (await discoverProviders(directory, { signal, run, env })).providers[name];
    return { ...result, operation: { state: 'cancelled' } };
  }

  onProgress?.({ provider: name, state: 'refreshing' });
  const result = (await discoverProviders(directory, { signal, run, env })).providers[name];
  const operation = result.authenticated
    ? { state: 'connected' }
    : { state: 'auth_required', reason: login.code === 0 ? 'authentication_not_confirmed' : 'login_failed' };
  onProgress?.({ provider: name, state: operation.state });
  return { ...result, operation };
}

export const providerNames = Object.freeze(PROVIDER_NAMES.slice());
