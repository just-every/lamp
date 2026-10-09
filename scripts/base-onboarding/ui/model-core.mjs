export function createModel(seed) {
const fields = seed.fields;
const safeKeys = seed.safeKeys || Object.keys(fields).filter(key => fields[key].type !== 'password');
const product = seed.product;
const branding = seed.branding || product;
const features = seed.features || {};
function normalizeWebsite(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:[/?#]|$)/.test(text)) return text;
  return text.startsWith('//') ? 'https:' + text : 'https://' + text;
}
function safeDraft(draft) { return Object.fromEntries(safeKeys.filter(key => typeof draft[key] === 'string').map(key => [key, draft[key]])); }
function initialDraft(state) {
  const draft = { ...safeDraft(seed.initialValues?.(state) || {}), ...safeDraft(state.draft || {}) }, sending = state.known?.email || {};
  if (features.email && !draft.emailProvider && sending.configuration === 'configured') draft.emailProvider = sending.provider;
  if (features.email && !draft.emailFrom) draft.emailFrom = sending.from || '';
  if (features.email && !draft.emailAccountId) draft.emailAccountId = sending.accountId || '';
  const accounts = state.known?.providers?.cloudflare?.accounts || [];
  if (features.hosting && !draft.accountId && accounts.length === 1) draft.accountId = accounts[0].id;
  return normalizeAutomaticDraft(draft);
}
function secretReady(key, draft, known = {}) {
  const readiness = known.secretReadiness || {};
  if (readiness.scopes?.[key]) return readiness[key] === true && Object.entries(readiness.scopes[key]).every(([field,value]) => draft[field] === value);
  const binding = (seed.secretScopes || { password: ['ownerEmail', 'email'], apiToken: ['accountId', 'accountId'], emailApiKey: ['emailProvider', 'emailProvider'] })[key];
  if (!binding) return readiness[key] === true;
  return readiness[key] === true && (!Object.hasOwn(readiness, binding[0]) || readiness[binding[0]] === draft[binding[1]]) && (key !== 'emailApiKey' || draft.emailProvider !== 'cloudflare' || !Object.hasOwn(readiness, 'emailAccountId') || readiness.emailAccountId === draft.emailAccountId);
}
function configuredEmailReady(draft, known = {}) {
  return Boolean(known.email?.credentialPresent && known.email.provider === draft.emailProvider && (draft.emailProvider !== 'cloudflare' || known.email.accountId === draft.emailAccountId));
}
const hostingKeys = ['target', 'accountId', 'prefix', 'appOrigin', 'apiToken'];
function hostingModel(draft, known = {}) {
  if (!features.hosting) return { complete: true, accessReady: false };
  const accessReady = Boolean(known.providers?.cloudflare?.authenticated || fields.apiToken.valid(draft.apiToken) || secretReady('apiToken', draft, known));
  const complete = draft.target === 'local' || (draft.target === 'remote' && accessReady && ['accountId', 'prefix', 'appOrigin'].every(key => fields[key].valid(draft[key])));
  return { complete, accessReady };
}
function setupModel(draft, known = {}) {
  const keys = [...(seed.requiredKeys?.(draft, known) || Object.keys(fields).filter(key => !fields[key].optional))];
  const connections = [];
  if (features.hosting && draft.target === 'remote') {
    keys.push('accountId', 'prefix', 'appOrigin');
    if (!known.providers?.cloudflare?.authenticated && !fields.apiToken.valid(draft.apiToken) && !secretReady('apiToken', draft, known)) connections.push('cloudflare');
  }
  if (features.email) keys.push('emailProvider');
  if (features.email && ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider)) {
    keys.push('emailFrom');
    if (draft.emailProvider === 'cloudflare') keys.push('emailAccountId');
    if (!configuredEmailReady(draft, known) && !secretReady('emailApiKey', draft, known)) keys.push('emailApiKey');
  }
  const missing = keys.filter(key => !fields[key].valid(draft[key]) && !(fields[key].type === 'password' && secretReady(key, draft, known)));
  const complete = keys.filter(key => fields[key].valid(draft[key]) || (fields[key].type === 'password' && secretReady(key, draft, known)));
  return { missing, complete, connections, remaining: missing.length + connections.length, ready: !missing.length && !connections.length };
}
function installInput(draft) {
  if (seed.installInput) return seed.installInput(draft);
  if (!features.email) return { ...safeDraft(draft), ...Object.fromEntries(Object.keys(fields).filter(key => fields[key].type === 'password' && draft[key]).map(key => [key, draft[key]])) };
  const data = safeDraft(draft);
  for (const key of ['emailProvider', 'emailFrom', 'emailAccountId']) delete data[key];
  return { ...data, password: draft.password || undefined, apiToken: draft.apiToken || undefined, emailConfiguration: { provider: draft.emailProvider, from: draft.emailFrom, accountId: draft.emailAccountId, apiKey: draft.emailApiKey || undefined } };
}
function displayValue(key, value) { return fields[key]?.options?.find(([option]) => option === value)?.[1] || value; }

function mergeAgentDraft(draft, state, appliedRevision = 0, pendingKeys = []) {
  const update = state.lastUpdate;
  if (!Number.isFinite(update?.revision) || update.revision <= appliedRevision) return draft;
  const keys = new Set(Object.entries(state.sources || {}).filter(([, source]) => source === 'agent').map(([key]) => key));
  if (update.source === 'agent' && Array.isArray(update.keys)) for (const key of update.keys) keys.add(key);
  const pending = new Set(pendingKeys), values = safeDraft(state.draft || {}), merged = { ...draft }; let changed = false;
  for (const key of keys) if (!pending.has(key) && Object.hasOwn(values, key) && values[key] !== draft[key]) { merged[key] = values[key]; changed = true; }
  return changed ? merged : draft;
}

function derivePrefix(value) {
  let slug = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return '';
  if (!/^[a-z]/.test(slug) || slug.length < 3) slug = (product.slugPrefix || 'app') + '-' + slug;
  return slug.slice(0, 40).replace(/-+$/g, '');
}
function normalizeAutomaticDraft(value) {
  const draft = { ...value };
  if (!features.hosting) return draft;
  draft.prefixMode ||= draft.prefix ? 'custom' : 'automatic';
  draft.addressMode ||= draft.appOrigin ? 'custom' : 'automatic';
  if (draft.prefixMode === 'automatic') draft.prefix = derivePrefix(draft.name);
  return draft;
}
function emailModel(draft, known = {}) {
  if (!features.email) return { keys: [], complete: true };
  const keys = ['emailProvider'];
  if (features.email && ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider)) {
    keys.push('emailFrom');
    if (draft.emailProvider === 'cloudflare') keys.push('emailAccountId');
    if (!configuredEmailReady(draft, known) && !secretReady('emailApiKey', draft, known)) keys.push('emailApiKey');
  }
  return { keys, complete: keys.every(key => fields[key].valid(draft[key])) };
}

// Navigation is deliberately separate from readiness: only the user advances a step.
const setupGroups = seed.setupGroups.map(group => ({ ...group, complete: group.complete || (group.kind === 'hosting'
 ? ((draft, known) => (!features.hosting || hostingModel(draft, known).complete) && (!features.email || emailModel(draft, known).complete))
 : ((draft, known) => !setupModel(draft, known).missing.some(key => group.keys.includes(key)))) }));
function readySummary(draft) { return seed.readySummary?.(draft) || `${draft.name || product.name} is ready to be installed.`; }
function nextIncompleteGroup(draft, known = {}) {
  return setupGroups.find(group => !group.complete(draft, known))?.id || null;
}

// Retain steps the owner actually reached; only unvisited, complete groups drop out.
// Editing known details is separate from the numbered setup journey.
function setupProgress(draft, known = {}, { active = null, visited = [], editing = false } = {}) {
  const group = setupGroups.find(group => group.id === active);
  if (!group) return 'Your choices are ready';
  if (editing) return `Editing ${group.title}`;
  const reached = [...new Set([...visited, active])];
  const remaining = setupGroups.filter(group => !reached.includes(group.id) && !group.complete(draft, known));
  return `Step ${reached.indexOf(active) + 1} of ${reached.length + remaining.length}`;
}

return { fields, safeKeys, product, branding, features, normalizeWebsite, safeDraft, initialDraft, secretReady, configuredEmailReady, hostingKeys, hostingModel, setupModel, installInput, displayValue, mergeAgentDraft, derivePrefix, normalizeAutomaticDraft, emailModel, setupGroups, readySummary, nextIncompleteGroup, setupProgress };
}
