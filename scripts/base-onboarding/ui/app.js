import { activityStatus } from './activity.js';
import { workspaceArt } from './workspace-art.js';
import { addressResolver } from './address-client.mjs';
import { product, branding, features, readySummary, fields, normalizeWebsite, initialDraft, setupModel, safeDraft, installInput, displayValue, mergeAgentDraft, secretReady, hostingModel, emailModel, normalizeAutomaticDraft, derivePrefix, setupGroups, nextIncompleteGroup, setupProgress } from './model.mjs';
const $ = selector => document.querySelector(selector);
document.title = 'Install ' + product.name;
$('.brand').textContent = branding.name || product.name;
$('.panel').setAttribute('aria-label', 'Install ' + product.name);
$('#open').textContent = 'Open ' + product.name + ' →';
const updateActivity = activityStatus($('#activity'), { request });
const tokenMeta = $('meta[name="installer-token"]'), token = tokenMeta?.content || '';
tokenMeta?.remove();
let draft = {}, state = {}, initialized = false, busy = false, timer, saveTimer, activeGroup = null, agentRevision = 0, tokenEditing = false, emailNow = false;
const resolver = features.hosting ? addressResolver({ model: {fields,derivePrefix,secretReady}, read: () => ({ draft, known: state.known || {} }), request, answer: setAnswer, changed: () => { if (initialized) renderPreservingFocus(); } }) : null;
const art = features.artwork ? workspaceArt({ model: {fields}, request, read: () => draft, save }) : null;
const changed = new Set(), pendingSave = new Set(), history = [], visitedGroups = [];
let editingGroup = false;
let visibleKeys = new Set(), passwordEditing = false, hostingAccountShown = false, emailFieldsScope = null, emailVisibleKeys = new Set();
function selectGroup(id, edit = false, editing = edit) {
  editingGroup = editing;
  if (id && !editing && !visitedGroups.includes(id)) visitedGroups.push(id);
  activeGroup = id; passwordEditing = false; hostingAccountShown = false; emailFieldsScope = null; emailVisibleKeys.clear();
  const group = setupGroups.find(group => group.id === id), missing = setupModel(draft, state.known).missing;
  visibleKeys = new Set(group?.keys.filter(key => edit || fields[key].optional || missing.includes(key)) || []);
  passwordEditing = visibleKeys.has('password') && !secretReady('password', draft, state.known);
}
function node(tag, className, text) { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; }
function error(message = '') { $('#error').textContent = message; $('#error').hidden = !message; }
async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...options.headers, 'X-Installer-Token': token }, credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json(); if (!response.ok) throw Error(body.error || `Installer request failed (${response.status}).`); return body;
}
async function save() {
  clearTimeout(saveTimer); const values = safeDraft(Object.fromEntries([...pendingSave].map(key => [key, draft[key]]))); if (!Object.keys(values).length) return;
  await request('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  for (const [key, value] of Object.entries(values)) if (draft[key] === value) pendingSave.delete(key);
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { save().catch(cause => error(cause.message)); }, 600); }
function inputFor(key, value) {
  const definition = fields[key], accounts = state.known?.providers?.cloudflare?.accounts || [];
  const options = key === 'accountId' && accounts.length ? accounts.map(account => [account.id, account.name || account.id]) : definition.options;
  const input = node(options ? 'select' : definition.type === 'textarea' ? 'textarea' : 'input', 'input'); input.id = key; input.name = key;
  if (options) { const placeholder = node('option', '', 'Choose…'); placeholder.value = ''; input.append(placeholder); for (const [value, title] of options) { const option = node('option', '', title); option.value = value; input.append(option); } }
  else if (definition.type === 'textarea') { input.rows = 3; }
  else { input.type = definition.type || 'text'; input.autocomplete = definition.autocomplete || 'off'; if (definition.inputMode) input.inputMode = definition.inputMode; if (['email', 'url', 'password'].includes(input.type)) { input.spellcheck = false; input.setAttribute('autocapitalize', 'none'); } }
  if (definition.placeholder) input.placeholder = definition.placeholder;
  if (definition.maxLength) input.maxLength = definition.maxLength;
  input.value = definition.type === 'color' ? (definition.valid(value) ? value : '#7c3aed') : value || ''; input.required = !definition.optional;
  if (key === 'password') { input.minLength = 12; input.maxLength = 1024; }
  if (input.type === 'email') input.maxLength = 320;
  return input;
}
function appendInput(container, key, input, value) {
  if (input.type === 'color') {
    const wrap = node('div', 'colour-control'), selected = fields[key].valid(value), caption = node('span', 'colour-caption', selected ? value : 'Choose a colour');
    wrap.append(input, caption); input.addEventListener('input', () => { caption.textContent = input.value; });
    container.append(wrap);
  } else if (input.tagName === 'SELECT') { const wrap = node('div', 'select-wrap'); wrap.append(input); container.append(wrap); }
  else container.append(input);
}
function setAnswer(key, value) {
  if (draft[key] !== value) art?.edited(key);
  if (key === 'accountId' && fields.accountId?.valid(draft.accountId) && draft.accountId !== value) draft.apiToken = '';
  if (key === 'emailProvider' && draft[key] !== value) draft.emailApiKey = '';
  draft[key] = value; changed.add(key); pendingSave.add(key); scheduleSave();
  if (['name', 'accountId', 'apiToken', 'target', 'prefixMode', 'addressMode'].includes(key) || (key === 'prefix' && draft.prefixMode === 'custom')) queueMicrotask(() => resolver?.schedule());
}
function missingField(key, container = $('#fields')) {
  const definition = fields[key], card = node('div', 'field'), label = node('label', '', definition.label), input = inputFor(key, draft[key]);
  label.htmlFor = key; card.dataset.field = key; if (definition.heading) card.append(node('h3', 'field-title', definition.heading)); card.append(label); appendInput(card, key, input, draft[key]);
  if (definition.help) { const help = node('p', 'help', definition.help); help.id = key + '-help'; card.append(help); input.setAttribute('aria-describedby', help.id); }
  input.addEventListener('input', () => { setAnswer(key, input.value); if (fields.password && key === 'email' && !visibleKeys.has('password') && !secretReady('password', draft, state.known)) { visibleKeys.add('password'); passwordEditing = true; missingField('password'); } refreshStatus(); });
  if (['allowedOrigin', 'name', 'primaryColor'].includes(key)) input.addEventListener('blur', () => {
    if (key === 'allowedOrigin') {
      const value = normalizeWebsite(input.value);
      if (value !== input.value) { input.value = value; setAnswer(key, value); refreshStatus(); }
    }
    void art?.commit()?.catch(cause => error(cause.message));
  });
  input.addEventListener('change', () => {
    if (key === 'allowedOrigin') input.value = normalizeWebsite(input.value);
    setAnswer(key, input.value);
    if (['allowedOrigin', 'name', 'primaryColor'].includes(key)) void art?.commit()?.catch(cause => error(cause.message));
    if (['target', 'emailProvider'].includes(key)) renderPreservingFocus(); else if (['accountId', 'apiToken', 'emailAccountId'].includes(key)) renderPreservingFocus(); else refreshStatus();
  });
  container.append(card);
}
function knownRow(container, key, value, source) {
  const row = node('div', 'known-row'), display = node('div', 'known-value');
  if (key === 'primaryColor' && fields.primaryColor.valid(value)) {
    const swatch = node('span', 'colour-swatch'); swatch.style.backgroundColor = value; swatch.setAttribute('aria-hidden', 'true'); display.append(swatch);
  } else if (key === 'email' || key === 'GitHub' || key === 'Cloudflare') {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    icon.classList.add('value-icon'); icon.setAttribute('aria-hidden', 'true'); use.setAttribute('href', key === 'email' ? '#group-email' : key === 'Cloudflare' ? '#value-cloudflare' : '#value-github'); icon.append(use); display.append(icon);
  }
  display.append(node('span', 'known-value-text', value)); row.append(node('div', 'known-label', key === 'password' ? 'Password' : key === 'emailProvider' && draft.emailProvider === 'later' ? 'Email' : fields[key]?.summaryLabel || fields[key]?.label || key), display);
  if (source) { row.title = source; row.append(node('span', 'visually-hidden', source)); const badge = source.startsWith('Suggested') ? 'Suggested' : ''; if (badge) row.append(node('span', 'known-source', badge)); }
  container.append(row);
  return row;
}
function targetChoices(container) {
  const choices = node('fieldset', 'target-choices'); choices.append(node('legend', 'known-label', `Where should ${product.name} run?`));
  for (const [value, title] of fields.target.options) {
    const label = node('label', 'target-choice'), input = node('input'); input.type = 'radio'; input.name = 'installation-target'; input.value = value; input.checked = draft.target === value;
    input.onchange = () => { setAnswer('target', value); renderPreservingFocus(); $('#target-' + value)?.focus(); }; input.id = 'target-' + value;
    const tick = node('span', 'target-tick', '✓'); tick.setAttribute('aria-hidden', 'true'); label.append(input, tick);
    if (value === 'remote') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); icon.classList.add('value-icon'); icon.setAttribute('aria-hidden', 'true'); use.setAttribute('href', '#value-cloudflare'); icon.append(use); label.append(icon);
    }
    const copy = node('span', 'choice-copy', title); if (container.closest('#fields')) copy.append(node('small', 'help', value === 'local' ? 'Uses the machine running this installer, for testing. Keep its terminal open.' : `Publish ${product.name} online for your team.`)); label.append(copy); choices.append(label);
  }
  container.append(choices);
}
function openGroup(id) {
  if (activeGroup !== id) history.push({ id: activeGroup, editing: editingGroup });
  selectGroup(id, true); emailNow = ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider); tokenEditing = false;
  render(); focusGroup();
}
function focusGroup() { $('#heading').focus(); }
function renderKnown() {
  const container = $('#known'); container.replaceChildren();
  const model = setupModel(draft, state.known), providers = state.known?.providers || {};
  for (const definition of setupGroups) {
    if (definition.id === activeGroup && definition.kind === 'hosting') continue;
    const group = node('section', 'known-group ' + definition.id); group.setAttribute('aria-label', definition.title);
    const header = node('header', 'known-group-header'), icon = node('span', 'category-icon'); icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#group-' + definition.id); svg.append(use); icon.append(svg);
    const edit = node('button', 'edit', 'Edit'); edit.type = 'button'; edit.setAttribute('aria-label', 'Edit ' + definition.title); edit.onclick = () => openGroup(definition.id);
    header.append(icon, node('h3', 'known-group-title', definition.title), edit);
    const body = node('div', 'known-group-body'); group.append(header, body);
    for (const key of definition.keys.filter(key => model.complete.includes(key) && !(definition.id === activeGroup && visibleKeys.has(key)))) {
      let value = displayValue(key, draft[key]);
      if (!value && key !== 'password') continue;
      if (key === 'password') value = 'Password securely provided';
      if (fields[key].type === 'password' && key !== 'password') continue;
      if (key === 'accountId') value = providers.cloudflare?.accounts?.find(account => account.id === draft[key])?.name || value;
      if (key === 'emailProvider' && draft[key] === 'later') value = 'Set up later';
      if (['prefix', 'apiToken'].includes(key)) continue;
      knownRow(body, key, value, state.known?.suggestedFields?.includes(key) && !changed.has(key) ? 'Suggested default · editable' : '', false);
    }
    if (definition.id === 'hosting') for (const provider of ['cloudflare', 'github']) {
      if (provider === 'cloudflare' && draft.target !== 'remote') continue;
      if (providerReady(provider)) knownRow(body, provider === 'github' ? 'GitHub' : 'Cloudflare', providers[provider]?.authenticated ? providers[provider]?.account?.login || 'Connected' : 'API token provided', '', false);
    }
    if (body.children.length) container.append(group);
  }
}

function providerCard(provider, container = $('#fields')) {
  const info = state.known?.providers?.[provider] || {}, connection = state.connection?.provider === provider ? state.connection : null;
  const card = node('div', 'field connection-row'), title = provider === 'github' ? (info.authenticated ? 'Change GitHub connection' : 'Connect GitHub') : info.authenticated ? 'Change Cloudflare connection' : 'Connect Cloudflare'; card.dataset.provider = provider; card.append(node('h3', 'field-title', title));
  card.append(node('p', 'help', provider === 'github' ? (info.authenticated ? 'This account comes from GitHub CLI sign-in. Sign in with the account you want to use; this updates the active GitHub CLI connection on this computer.' : 'Show the GitHub account and repository for this installation. You can install without connecting GitHub.') : info.authenticated ? 'Sign in with the Cloudflare account you want to use. This updates the Wrangler connection on this computer.' : draft.target === 'local' ? 'For Cloudflare hosting. Not needed to run on this computer.' : draft.target === 'remote' ? 'Connect your account or supply an API token to install on Cloudflare.' : 'Required if you install on Cloudflare.'));
  const connecting = connection && ['starting', 'awaiting_browser', 'refreshing', 'running'].includes(connection.state), actions = node('div', 'connection-actions');
  if (info.installed !== false) {
    const button = node('button', 'secondary', connecting ? 'Connecting…' : info.authenticated ? provider === 'github' ? 'Sign in to GitHub' : 'Sign in to Cloudflare' : 'Connect'); button.type = 'button'; button.id = 'connect-' + provider; button.disabled = Boolean(connecting);
    button.onclick = async () => { button.disabled = true; error(); try { await request('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) }); await poll(); } catch (cause) { error(cause.message); button.disabled = false; } }; actions.append(button);
  } else card.append(node('p', 'help', 'The connection tool is not installed on this computer.'));
  if (provider === 'cloudflare' && draft.target === 'remote') { const alternative = node('button', 'edit', 'Use an API token'); alternative.type = 'button'; alternative.onclick = () => { tokenEditing = true; render(); $('#apiToken')?.focus(); }; actions.append(alternative); }
  card.append(actions);
  if (connection) {
    const text = { starting: 'Starting sign-in…', awaiting_browser: 'Complete sign-in in your browser.', refreshing: 'Checking the connection…', connected: 'Connection confirmed.', auth_required: 'Sign-in was not confirmed. Try connecting again.', failed: 'Connection failed. Check your installer terminal.' }[connection.state] || connection.state;
    card.append(node('p', 'status', text));
    if (connection.deviceCode) { card.append(node('p', '', `One-time code: ${connection.deviceCode}`)); if (connection.verificationUrl === 'https://github.com/login/device') { const link = node('a', 'edit', 'Open GitHub device sign-in ↗'); link.href = connection.verificationUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); } }
  }
  if (provider === 'cloudflare' && tokenEditing) missingField('apiToken', card);
  container.append(card);
}
function providerReady(provider) {
  return state.known?.providers?.[provider]?.authenticated || (provider === 'cloudflare' && (fields.apiToken?.valid(draft.apiToken) || secretReady('apiToken', draft, state.known)));
}
function renderHosting() {
  const hosting = hostingModel(draft, state.known);
  const unit = node('section', 'hosting-unit target-question'); unit.setAttribute('aria-label', 'Hosting & connections'); $('#fields').append(unit);
  {
    unit.dataset.editing = 'true'; targetChoices(unit);
    if (draft.target === 'remote') {
      if (!hosting.accessReady || tokenEditing) providerCard('cloudflare', unit);
      else { unit.append(node('p', 'status', 'Cloudflare connected')); const change = node('button', 'edit', 'Change Cloudflare connection'); change.type = 'button'; change.onclick = () => { tokenEditing = true; renderPreservingFocus(); }; unit.append(change); }
      if (hosting.accessReady) hostingAccountShown = true;
      if (hostingAccountShown) {
        missingField('accountId', unit);
        if (resolver.status.pending) { const progress = node('p', 'status', 'Finding your team workspace address…'); progress.setAttribute('role', 'status'); unit.append(progress); }
        if (resolver.status.error) {
          const notice = node('p', 'error', resolver.status.error); notice.setAttribute('role', 'alert'); unit.append(notice);
          const retry = node('button', 'edit', 'Try again'); retry.type = 'button'; retry.onclick = () => resolver?.schedule(true); unit.append(retry);
        }
        if (draft.appOrigin) unit.append(node('p', 'status', 'Team workspace address: ' + draft.appOrigin));
        const advanced = node('details', 'advanced'); advanced.append(node('summary', '', 'Advanced settings'));
        for (const [key, mode, title] of [['prefix', 'prefixMode', 'Use a custom resource name'], ['appOrigin', 'addressMode', 'Use a custom team workspace address']]) {
          const label = node('label', 'advanced-toggle'), toggle = node('input'); toggle.type = 'checkbox'; toggle.id = mode; toggle.checked = draft[mode] === 'custom';
          toggle.onchange = () => { setAnswer(mode, toggle.checked ? 'custom' : 'automatic'); if (!toggle.checked && key === 'appOrigin') setAnswer(key, ''); renderPreservingFocus(); resolver?.schedule(true); };
          label.append(toggle, node('span', '', title)); advanced.append(label);
          if (toggle.checked) missingField(key, advanced);
        }
        advanced.open = draft.prefixMode === 'custom' || draft.addressMode === 'custom'; unit.append(advanced);
      }
    }
  }
  if (features.github) providerCard('github', unit);
}
function choiceGroup(container, legend, options, selected, onChange) {
  const group = node('fieldset', 'target-choices'); group.append(node('legend', '', legend));
  for (const [value, text] of options) {
    const label = node('label', 'target-choice'), input = node('input'); input.type = 'radio'; input.name = legend; input.value = value; input.id = 'choice-' + value; input.checked = value === selected;
    input.onchange = () => { onChange(value); renderPreservingFocus(); }; const tick = node('span', 'target-tick', '✓'); tick.setAttribute('aria-hidden', 'true'); label.append(input, tick, node('span', '', text)); group.append(label);
  }
  container.append(group);
}
function renderEmail() {
  const unit = node('section', 'email-unit'); unit.setAttribute('aria-label', `Email from ${product.name}`); $('#fields').append(unit);
  choiceGroup(unit, `Email from ${product.name}`, [['now', 'Set up email now'], ['later', 'Set up later']], draft.emailProvider === 'later' && !emailNow ? 'later' : emailNow || ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider) ? 'now' : '', value => { emailNow = value === 'now'; setAnswer('emailProvider', value === 'later' ? 'later' : ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider) ? draft.emailProvider : ''); });
  unit.append(node('p', 'help', `Choose how ${product.name} sends email. Hosting sign-in does not set up email sending.`));
  if (emailNow || ['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider)) {
    choiceGroup(unit, 'Email service', [['cloudflare', 'Cloudflare Email Sending'], ['resend', 'Resend'], ['sendgrid', 'SendGrid']], draft.emailProvider, value => setAnswer('emailProvider', value));
    if (['cloudflare', 'resend', 'sendgrid'].includes(draft.emailProvider)) {
      const scope = draft.emailProvider + ':' + (draft.emailAccountId || '');
      if (scope !== emailFieldsScope) { emailVisibleKeys.clear(); emailFieldsScope = scope; }
      for (const key of emailModel(draft, state.known).keys) if (key !== 'emailProvider') emailVisibleKeys.add(key);
      for (const key of emailVisibleKeys) missingField(key, unit);
    }
  }
}
function refreshStatus() {
  const model = setupModel(draft, state.known), group = setupGroups.find(group => group.id === activeGroup);
  $('#continue').hidden = !group; $('#approve').hidden = Boolean(group);
  $('#continue').disabled = busy || !group?.complete(draft, state.known);
  $('#approve').disabled = busy || !model.ready;
  $('#fields .review-correction')?.remove();
  if (!activeGroup && !model.ready) { const fix = node('button', 'secondary review-correction', 'Complete missing details'); fix.type = 'button'; fix.onclick = () => { selectGroup(nextIncompleteGroup(draft, state.known)); render(); focusGroup(); }; $('#fields').append(fix); }
  $('#back').hidden = !history.length;
  $('#progress').textContent = setupProgress(draft, state.known, { active: activeGroup, visited: visitedGroups, editing: editingGroup });
  renderKnown();
}
function render() {
  const container = $('#fields'); container.replaceChildren();
  const group = setupGroups.find(group => group.id === activeGroup);
  $('#heading').textContent = group?.title || 'Ready to install';
  if (group && group.kind !== 'hosting') for (const key of group.keys) {
    if (setupModel(draft, state.known).missing.includes(key)) { visibleKeys.add(key); if (key === 'password') passwordEditing = true; }
    if (!visibleKeys.has(key)) continue;
    if (key === 'password' && secretReady(key, draft, state.known) && !draft.password && !passwordEditing) {
      const row = node('div', 'status', 'Password securely provided');
      const change = node('button', 'edit', 'Change password'); change.type = 'button'; change.onclick = () => { passwordEditing = true; render(); $('#password').focus(); }; row.append(change); container.append(row);
    } else missingField(key);
  }
  if (group?.kind === 'hosting') { if (features.hosting) renderHosting(); if (features.email) renderEmail(); }
  if (!group) container.append(node('p', 'ready-summary', readySummary(draft)));
  refreshStatus();
}
function renderPreservingFocus() {
  const active = document.activeElement, focused = active?.id, start = active?.selectionStart, end = active?.selectionEnd;
  render(); const next = focused && document.getElementById(focused);
  if (next) { next.focus(); if (start !== null && start !== undefined) { try { next.setSelectionRange(start, end); } catch {} } }
  else if (focused) ($('#accountId') || $('#fields input, #fields select, #fields button') || $('#approve'))?.focus();
}
function applyState(next) {
  art?.update(next);
  updateActivity(next.activity, next.agent);
  const changedProviders = JSON.stringify([state.known?.providers, state.connection, state.known?.secretReadiness]) !== JSON.stringify([next.known?.providers, next.connection, next.known?.secretReadiness]); state = next; $('#loading').hidden = true;
  const agentDraft = mergeAgentDraft(draft, next, agentRevision, pendingSave), agentChanged = initialized && agentDraft !== draft;
  if (Number.isFinite(next.lastUpdate?.revision)) agentRevision = Math.max(agentRevision, next.lastUpdate.revision);
  if (!initialized) { draft = initialDraft(next); for (const key of ['prefixMode', 'addressMode']) if (features.hosting && draft[key] !== next.draft?.[key]) pendingSave.add(key); if (pendingSave.size) scheduleSave(); initialized = true; selectGroup(nextIncompleteGroup(draft, next.known)); render(); resolver?.schedule(); }
  else if (agentChanged && next.phase === 'ready') { const appliedKeys = Object.keys(agentDraft).filter(key => agentDraft[key] !== draft[key]); if (fields.accountId?.valid(draft.accountId) && agentDraft.accountId !== draft.accountId) agentDraft.apiToken = ''; draft = normalizeAutomaticDraft(agentDraft); for (const key of appliedKeys) changed.delete(key); renderPreservingFocus(); }
  else if (changedProviders && next.phase === 'ready') {
    const provider = next.known?.providers?.cloudflare, accounts = provider?.accounts || [];
    if (provider?.authenticated && accounts.length && draft.accountId && !accounts.some(account => account.id === draft.accountId)) setAnswer('accountId', '');
    if (features.hosting && !draft.accountId && accounts.length === 1) setAnswer('accountId', accounts[0].id);
    renderPreservingFocus();
  }
  resolver?.schedule();
  const active = next.phase !== 'ready'; $('#form').hidden = active; $('#installation').hidden = !active; if (!active) return;
  busy = true; $('#heading').hidden = false;
  $('#heading').textContent = next.phase === 'complete' ? `${product.name} is ready` : next.phase === 'failed' ? 'Installation needs attention' : `Installing ${product.name}`;
  $('#current-step').textContent = next.step || next.phase; $('#logs').textContent = (next.logs || []).map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'); $('#failed-note').hidden = next.phase !== 'failed'; if (next.error) error(next.error);
  if (next.phase === 'complete' && next.appUrl) { try { const url = new URL(next.appUrl); if (['http:', 'https:'].includes(url.protocol)) { $('#open').href = url.href; $('#open').hidden = false; } } catch { error('The application address is invalid. Check the installer terminal.'); } }
}
async function poll() { clearTimeout(timer); try { const next = await request('/api/state'); applyState(next); if (!['complete', 'failed'].includes(next.phase)) timer = setTimeout(poll, 1500); } catch (cause) { error(cause.message + ' Keep the installer terminal open.'); timer = setTimeout(poll, 3000); } }
$('#form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; error();
  try { await art?.commit(); } catch (cause) { error(cause.message); return; }
  if (activeGroup) {
    const group = setupGroups.find(group => group.id === activeGroup);
    if (!group.complete(draft, state.known)) return;
    history.push({ id: activeGroup, editing: editingGroup }); selectGroup(nextIncompleteGroup(draft, state.known)); tokenEditing = false; render(); focusGroup(); return;
  }
  const model = setupModel(draft, state.known); if (!model.ready) { selectGroup(nextIncompleteGroup(draft, state.known)); render(); (model.missing[0] === 'target' ? $('#target-local') : $('#' + model.missing[0]))?.focus(); return; }
  busy = true; $('#approve').disabled = true; clearTimeout(saveTimer); const data = installInput(draft);
  try { await request('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); for (const key of Object.keys(fields).filter(key => fields[key].type === 'password')) draft[key] = ''; await poll(); }
  catch (cause) { error(cause.message); busy = false; refreshStatus(); }
  finally { for (const key of Object.keys(fields).filter(key => fields[key].type === 'password')) { data[key] = ''; draft[key] = ''; } if (data.emailConfiguration) data.emailConfiguration.apiKey = ''; }
};
poll();

$('#back').onclick = () => { const previous = history.pop(); selectGroup(previous.id, true, previous.editing); render(); focusGroup(); };
