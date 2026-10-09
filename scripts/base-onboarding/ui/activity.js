// This view owns only the sidebar status; polling never replaces form controls.
export function activityStatus(container, { request, clipboard = container.ownerDocument.defaultView?.navigator?.clipboard } = {}) {
  const document = container.ownerDocument;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  container.className = 'agent-activity known-group';
  const header = node('div', 'known-group-header');
  const title = node('h2', 'known-group-title', 'Preparing setup');
  header.append(title);
  container.setAttribute('aria-label', 'Preparing setup');
  const latest = node('p', 'agent-activity-message', '');
  latest.hidden = true;
  latest.setAttribute('role', 'status');
  latest.setAttribute('aria-live', 'polite');
  latest.setAttribute('aria-atomic', 'true');
  const history = node('details', 'agent-activity-history');
  history.hidden = true;
  history.append(node('summary', '', 'Recent updates'));
  const list = node('ul', 'agent-activity-events');
  history.append(list);
  const connect = node('button', 'agent-connect', 'Connect an agent');
  connect.type = 'button'; connect.hidden = true;
  const working = node('span', 'agent-working'); working.hidden = true;
  const spinner = node('span', 'agent-working-spinner'); spinner.setAttribute('aria-hidden', 'true');
  working.append(spinner, node('span', '', 'Working'));
  header.append(connect, working);
  const dialog = node('dialog', 'agent-handoff');
  dialog.setAttribute('aria-labelledby', 'agent-handoff-title');
  dialog.setAttribute('aria-describedby', 'agent-handoff-description');
  const dialogTitle = node('h2', '', 'Connect an agent'); dialogTitle.id = 'agent-handoff-title';
  const description = node('p', 'help', 'Give this prompt to a coding agent running on this computer to connect it to this setup session.'); description.id = 'agent-handoff-description';
  const label = node('label', 'visually-hidden', 'Connection prompt'); label.htmlFor = 'agent-handoff-prompt';
  const prompt = node('textarea', 'input'); prompt.id = 'agent-handoff-prompt'; prompt.readOnly = true; prompt.rows = 8; prompt.spellcheck = false;
  const notice = node('p', 'status'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const actions = node('div', 'agent-handoff-actions');
  const copy = node('button', 'primary', 'Copy prompt'); copy.type = 'button'; copy.disabled = true;
  const close = node('button', 'secondary', 'Close'); close.type = 'button'; close.autofocus = true;
  actions.append(copy, close); dialog.append(dialogTitle, description, label, prompt, notice, actions);
  container.append(header, latest, history, dialog);
  connect.onclick = async () => {
    prompt.value = ''; copy.disabled = true; notice.textContent = 'Loading connection prompt…';
    dialog.showModal();
    try {
      const result = await request('/api/agent-handoff');
      if (typeof result.prompt !== 'string' || !result.prompt.trim()) throw Error('The installer did not return a connection prompt.');
      prompt.value = result.prompt; copy.disabled = false; notice.textContent = '';
    } catch (cause) { notice.textContent = cause.message || 'Unable to load the connection prompt.'; }
  };
  copy.onclick = async () => {
    try {
      if (!clipboard?.writeText) throw Error('Clipboard access is unavailable. Select and copy the prompt above.');
      await clipboard.writeText(prompt.value); notice.textContent = 'Prompt copied. Paste it into your coding agent.';
    } catch { notice.textContent = 'Could not copy automatically. Select and copy the prompt above.'; prompt.focus(); prompt.select(); }
  };
  close.onclick = () => dialog.close();
  let historySignature = '', latestId = -1;
  return (activity, agent) => {
    const attached = agent?.mode === 'connected' && agent.attached === true;
    const manual = agent?.mode === 'manual';
    const heading = attached ? 'Agent status' : manual ? 'Manual setup' : 'Preparing setup';
    if (title.textContent !== heading) { title.textContent = heading; container.setAttribute('aria-label', heading); }
    connect.hidden = !manual; latest.hidden = !attached && !manual && agent?.mode !== 'connecting';
    if (!attached) {
      working.hidden = true; header.setAttribute('aria-busy', 'false');
      container.dataset.phase = manual ? 'manual' : agent?.mode === 'connecting' ? 'connecting' : 'preparing';
      const message = manual ? 'Complete the setup steps to get started.' : agent?.mode === 'connecting' ? 'Waiting for your agent' : '';
      if (latest.textContent !== message) latest.textContent = message;
      history.hidden = true; return;
    }
    const events = Array.isArray(activity) ? activity.filter(event => event && typeof event.message === 'string' && event.message.trim()) : [];
    const current = events.at(-1);
    if (latestId >= 0 && (!Number.isFinite(current?.id) || current.id < latestId)) return;
    if (Number.isFinite(current?.id)) latestId = current.id;
    const message = current?.message || 'Waiting for setup updates';
    // Keep the live region unchanged on identical polls, including new IDs with identical text.
    if (latest.textContent !== message) latest.textContent = message;
    const phase = current?.phase || 'waiting';
    container.dataset.phase = phase;
    working.hidden = phase !== 'checking';
    header.setAttribute('aria-busy', String(phase === 'checking'));
    const recent = events.slice(-4, -1).reverse();
    const signature = JSON.stringify(recent.map(event => [event.id, event.message]));
    if (signature !== historySignature) {
      list.replaceChildren(...recent.map(event => node('li', '', event.message)));
      historySignature = signature;
    }
    history.hidden = !recent.length;
  };
}
