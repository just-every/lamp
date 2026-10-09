
const contextKeys = ['allowedOrigin', 'name', 'primaryColor'];
const signature = draft => JSON.stringify(contextKeys.map(key => draft[key]));

// Art is requested only when the user commits a changed workspace field.
export function workspaceArt({ request, read, save, model: {fields} }) {
  let dirty = false, attached = false, lastRequested = '', committing = Promise.resolve();
  return {
    update(state) { attached = state.agent?.attached === true; },
    edited(key) { if (contextKeys.includes(key)) dirty = true; },
    commit() {
      committing = committing.catch(() => {}).then(async () => {
        if (!dirty) return;
        const draft = read(), current = signature(draft);
        await save();
        if (signature(read()) !== current) return;
        if (!attached) return;
        if (!contextKeys.every(key => fields[key].valid(draft[key]))) return;
        if (current === lastRequested) { dirty = false; return; }
        await request('/api/workspace-art', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        lastRequested = current;
        if (signature(read()) === current) dirty = false;
      });
      return committing;
    },
  };
}
