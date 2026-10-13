import { stat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const text = value => typeof value === 'string' && value.trim().length > 0;

const environmentName = value => typeof value === 'string' && value === value.trim() && /^[A-Z][A-Z0-9_]*$/.test(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const hostedProviders = ['sendgrid', 'resend', 'cloudflare'];
const fixedProviders = {
  sendgrid: { apiKeyEnvironment: 'SENDGRID_API_KEY' },
  resend: { apiKeyEnvironment: 'RESEND_API_KEY' },
  cloudflare: { apiKeyEnvironment: 'CLOUDFLARE_EMAIL_API_TOKEN', accountIdEnvironment: 'CLOUDFLARE_EMAIL_ACCOUNT_ID' }
};

function fields(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid loop declaration.');
}

function mailInputs(provider, declaration, fallback = false) {
  fields(declaration, ['apiKeyEnvironment', 'requiredEnvironment', 'accountIdEnvironment', 'development', ...(fallback ? ['provider'] : [])]);
  if (![...hostedProviders, ...(fallback ? [] : ['development'])].includes(provider)
      || !Array.isArray(declaration.requiredEnvironment) || declaration.requiredEnvironment.some(name => !environmentName(name))) throw new Error('Invalid mail binding declaration.');
  const names = [...declaration.requiredEnvironment];
  if (provider === 'development') {
    if (has(declaration, 'apiKeyEnvironment') || has(declaration, 'accountIdEnvironment')) throw new Error('Invalid development mail binding.');
    fields(declaration.development, ['modeEnvironment', 'originEnvironment']);
    if (!environmentName(declaration.development.modeEnvironment) || !environmentName(declaration.development.originEnvironment)) throw new Error('Invalid development mail binding.');
    names.push(declaration.development.modeEnvironment, declaration.development.originEnvironment);
  } else {
    if (!environmentName(declaration.apiKeyEnvironment) || has(declaration, 'development')) throw new Error('Invalid hosted mail binding.');
    names.unshift(declaration.apiKeyEnvironment);
    if (provider === 'cloudflare') {
      if (!environmentName(declaration.accountIdEnvironment)) throw new Error('Invalid hosted mail binding.');
      names.push(declaration.accountIdEnvironment);
    } else if (has(declaration, 'accountIdEnvironment')) throw new Error('Invalid hosted mail binding.');
  }
  return { ...declaration, provider, names: [...new Set(names)] };
}

// All consumers use the same validated input declarations, including disabled loops.
function normalizedLoops(descriptor) {
  const loops = descriptor.loops === undefined ? [] : descriptor.loops;
  if (!Array.isArray(loops) || new Set(loops.map(loop => loop?.id)).size !== loops.length) throw new Error('Invalid loop declarations.');
  return loops.map(loop => {
    fields(loop, ['id', 'type', 'required', 'enabled', ...(loop?.type === 'mail' ? ['provider', 'binding'] : [])]);
    if (typeof loop.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(loop.id) || typeof loop.required !== 'boolean' || typeof loop.enabled !== 'boolean' || !['worker', 'mail'].includes(loop.type)) throw new Error('Invalid loop declaration.');
    if (loop.type === 'worker') return { ...loop, names: [] };
    if (!has(loop, 'binding')) {
      if (!hostedProviders.includes(loop.provider)) throw new Error('Invalid mail provider declaration.');
      const selected = mailInputs(loop.provider, { ...fixedProviders[loop.provider], requiredEnvironment: [] });
      return { ...loop, selected, names: ['MAIL_PROVIDER', ...selected.names] };
    }
    if (has(loop, 'provider')) throw new Error('Invalid mail binding declaration.');
    const binding = loop.binding;
    fields(binding, ['providerEnvironment', 'providers', 'whenUnset']);
    if (!environmentName(binding.providerEnvironment) || !record(binding.providers) || !Object.keys(binding.providers).length) throw new Error('Invalid mail binding declaration.');
    const providers = Object.fromEntries(Object.entries(binding.providers).map(([provider, inputs]) => [provider, mailInputs(provider, inputs)]));
    const whenUnset = has(binding, 'whenUnset') ? mailInputs(binding.whenUnset?.provider, binding.whenUnset, true) : undefined;
    return { ...loop, binding: { ...binding, providers, whenUnset }, names: [...new Set([binding.providerEnvironment, ...Object.values(providers).flatMap(inputs => inputs.names), ...(whenUnset?.names ?? [])])] };
  });
}

export function knownEnvironmentNames(descriptor) {
  return new Set([...descriptor.requiredEnvironment, ...normalizedLoops(descriptor).flatMap(loop => loop.names)]);
}

function localDevelopmentOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      && (value === url.origin || value === `${url.origin}/`);
  } catch { return false; }
}

function inspectMailInputs(selected, env) {
  const missingEnvironment = selected.names.filter(name => !text(env[name]));
  let status = 'ready';
  const missing = name => { if (!missingEnvironment.includes(name)) missingEnvironment.push(name); };
  if (selected.accountIdEnvironment && (typeof env[selected.accountIdEnvironment] !== 'string' || !/^[a-f0-9]{32}$/i.test(env[selected.accountIdEnvironment]))) missing(selected.accountIdEnvironment);
  if (selected.development) {
    const { modeEnvironment, originEnvironment } = selected.development;
    if (env[modeEnvironment] !== 'development') missing(modeEnvironment);
    if (!localDevelopmentOrigin(env[originEnvironment])) missing(originEnvironment);
    if (missingEnvironment.includes(modeEnvironment) || missingEnvironment.includes(originEnvironment)) status = 'invalid-development-mail';
  }
  if (missingEnvironment.length && status === 'ready') status = 'missing-inputs';
  return { status, missingEnvironment };
}

// Descriptors can identify only files in their own checkout, including through symlinks.
async function localFile(root, path) {
  if (!text(path) || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('Invalid project input path.');
  const target = await realpath(resolve(root, path));
  const inside = relative(await realpath(root), target);
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Project input escapes checkout.');
  if (!(await stat(target)).isFile()) throw new Error('Project input is not a file.');
}

export async function readProjectOperations(root, descriptor, validateSources) {
  if (descriptor.seedContract !== undefined) {
    const contract = descriptor.seedContract;
    if (!contract || contract.version !== 1 || contract.profile !== 'first-party' || !text(contract.adapter)
        || Object.keys(contract).some(key => !['version', 'profile', 'adapter'].includes(key))) throw new Error('Invalid seed command contract.');
    await localFile(root, contract.adapter);
  }
  if (!text(descriptor.project) || !Array.isArray(descriptor.requiredEnvironment)
      || descriptor.requiredEnvironment.some(name => !environmentName(name))
      || !Array.isArray(descriptor.runtime?.requirements)
      || descriptor.runtime.requirements.some(item => !text(item?.name) || !text(item?.version))
      || !descriptor.commands || Array.isArray(descriptor.commands)
      || !Object.keys(descriptor.commands).length) throw new Error('Invalid project operations descriptor.');
  inspectRequiredLoops(descriptor, {});
  if (typeof validateSources !== 'function') throw new Error('Environment source validation is unavailable.');
  validateSources(descriptor, knownEnvironmentNames(descriptor));
  for (const path of [descriptor.documentation?.document, descriptor.acceptance?.document, descriptor.configuration?.module].filter(value => value !== undefined)) await localFile(root, path);
  const commands = [];
  for (const [name, command] of Object.entries(descriptor.commands)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || !Array.isArray(command?.argv) || !command.argv.length
        || command.argv.some(arg => typeof arg !== 'string') || !text(command.argv[0])
        || !text(command.effects) || !Array.isArray(command.inputs)) throw new Error('Invalid project operation command.');
    let available = true;
    for (const path of command.inputs) {
      // Malformed paths are descriptor errors; missing declared files are unavailable targets.
      if (!text(path) || isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('Invalid project input path.');
      try { await localFile(root, path); } catch (error) {
        if (error.code === 'ENOENT') available = false;
        else throw error;
      }
    }
    commands.push({ name, available });
  }
  return { descriptor, commands };
}

/** Declarative local loop checks. Never imports a module, sends mail, queries DNS or invokes a command. */
export function inspectRequiredLoops(descriptor, env) {
  return normalizedLoops(descriptor).map(loop => {
    let result = { status: 'ready', missingEnvironment: [] };
    if (!loop.enabled) result.status = loop.required ? 'disabled-required' : 'optional-disabled';
    else if (loop.type === 'mail') {
      if (loop.binding) {
        const { providerEnvironment, providers, whenUnset } = loop.binding;
        const provider = env[providerEnvironment];
        const selected = provider === undefined ? whenUnset : typeof provider === 'string' && has(providers, provider) ? providers[provider] : undefined;
        result = selected ? inspectMailInputs(selected, env) : { status: 'invalid-mail-provider', missingEnvironment: [providerEnvironment] };
      } else {
        result = inspectMailInputs(loop.selected, env);
        // Preserve the fixed-provider contract's truthy-selector mismatch behavior.
        if (env.MAIL_PROVIDER && env.MAIL_PROVIDER !== loop.provider) result.status = 'mail-provider-mismatch';
      }
    }
    return { id: loop.id, required: loop.required, ...result };
  });
}
