import assert from 'node:assert/strict';

// Save and independently read through the same authenticated doors operators use.
export async function savedInternalNote(runtime, incidentId, body) {
  const path = `/api/app/incidents/${incidentId}`;
  const saved = await runtime.api(`${path}/internal-notes`, { method: 'POST', body: JSON.stringify({ body }) });
  assert.equal(saved.status, 201, saved.text);
  const read = await runtime.api(path);
  assert.equal(read.status, 200, read.text);
  const notes = read.body.incident.internalNotes.filter(note => note.body === body);
  assert.equal(notes.length, 1, 'the authenticated operator reads the exact saved private note');
  assert.equal((await runtime.raw(path)).status, 401, 'an anonymous caller cannot read operator notes');
  assert.equal((await runtime.raw(new URL(path, runtime.publicOrigin).href)).status, 404, 'the public host exposes no operator-note read door');
  return notes[0].body;
}
