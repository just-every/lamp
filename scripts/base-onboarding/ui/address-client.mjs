
// Resolve an address from real Cloudflare account information, never a guessed URL.
export function addressResolver({ read, request, answer, changed, model: {fields,derivePrefix,secretReady} }) {
  let timer, lastKey = '', generation = 0;
  const status = { pending: false, error: '' };
  function schedule(force = false) {
    const { draft, known } = read();
    const prefix = draft.prefixMode === 'custom' ? draft.prefix : derivePrefix(draft.name);
    if (draft.prefixMode !== 'custom' && draft.prefix !== prefix) answer('prefix', prefix);
    if (draft.target !== 'remote' || draft.addressMode === 'custom') { clearTimeout(timer); generation++; lastKey = ''; status.pending = false; status.error = ''; return; }
    const ready = fields.name.valid(draft.name) && fields.accountId.valid(draft.accountId) && (known.providers?.cloudflare?.authenticated || draft.apiToken || secretReady('apiToken', draft, known));
    if (!ready) { clearTimeout(timer); generation++; lastKey = ''; status.pending = false; status.error = ''; if (draft.appOrigin) answer('appOrigin', ''); return; }
    const key = JSON.stringify([draft.name, draft.accountId, prefix, draft.apiToken || '', known.providers?.cloudflare?.authenticated, secretReady('apiToken', draft, known)]);
    if (!force && key === lastKey) return;
    clearTimeout(timer); lastKey = key; const version = ++generation;
    if (draft.appOrigin) answer('appOrigin', '');
    status.pending = true; status.error = ''; changed();
    timer = setTimeout(async () => {
      try {
        const payload = { name: draft.name, accountId: draft.accountId };
        if (draft.prefixMode === 'custom') payload.prefix = draft.prefix;
        if (draft.apiToken) payload.apiToken = draft.apiToken;
        const result = await request('/api/address', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const current = read().draft;
        if (version !== generation || current.addressMode === 'custom' || current.target !== 'remote') return;
        if (current.prefixMode !== 'custom') answer('prefix', result.prefix);
        answer('appOrigin', result.appOrigin);
      } catch (cause) { if (version === generation) status.error = cause.message; }
      finally { if (version === generation) { status.pending = false; changed(); } }
    }, 400);
  }
  return { schedule, status };
}
