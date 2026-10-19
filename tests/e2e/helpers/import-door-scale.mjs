import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = family => readdirSync(`tests/fixtures/statuspage/${family}`).map(name => ({ name, text: readFileSync(`tests/fixtures/statuspage/${family}/${name}`, 'utf8') }));
// Sixty synthetic incidents on the small page, keeping its components and subscribers.
const sixty = () => files('small').map(file => {
  if (file.name !== 'incidents.json') return file;
  const seed = JSON.parse(file.text)[0];
  return { name: file.name, text: JSON.stringify(Array.from({ length: 60 }, (_, n) => {
    const id = `s${String(n).padStart(10, '0')}`;
    return { ...structuredClone(seed), id, shortlink: `https://stspg.io/${id}`, name: `Synthetic incident ${n}`, incident_updates: seed.incident_updates.map((update, k) => ({ ...update, id: `${id}u${k + 1}`, incident_id: id })) };
  })) };
});
/** The large page repeated: each copy's incidents, updates and subscribers take new ids and addresses. */
const scaled = times => files('large').map(file => {
  if (!['incidents.json', 'incidents-2.json', 'subscribers.json'].includes(file.name)) return file;
  const rows = JSON.parse(file.text), copies = [rows];
  for (let n = 1; n < times; n++) copies.push(rows.map(row => {
    if (file.name === 'subscribers.json') return { ...row, id: `${row.id}x${n}`, ...(row.email ? { email: row.email.replace('@', `+x${n}@`) } : {}) };
    const id = `${row.id}x${n}`.slice(0, 20);
    return { ...structuredClone(row), id, shortlink: `https://stspg.io/${id}`, name: `${row.name} x${n}`, incident_updates: row.incident_updates.map((update, k) => ({ ...update, id: `${id}u${k + 1}`, incident_id: id })) };
  }));
  return { name: file.name, text: JSON.stringify(copies.flat()) };
});
/** The small page with text in every shape a real export can carry: U+0000,
 * lone surrogates, an emoji at the 250-character cut, combining marks and
 * right-to-left text. */
const characters = () => files('small').map(file => {
  const rows = JSON.parse(file.text);
  if (file.name === 'components.json') rows[0].description = 'Komponent\u0000 ✓ 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 \u202e';
  else if (file.name === 'incidents.json') {
    rows[0].name = 'Null\u0000 byte, עברית مرحبا \u200f\u202e, e\u0301 a\u0308, 🙏🏽 👨‍👩‍👧';
    rows[0].incident_updates[0].body = 'Lone \ud83d high and \ude4f low surrogates, NUL\u0000 inside.';
    rows[1].incident_updates[0].body = `${'x'.repeat(248)}🙏 Thanks for your patience ${'y'.repeat(480)}🚀 end`;
  } else return file;
  return { name: file.name, text: JSON.stringify(rows) };
});
/** The same export with some incidents renamed at the source and some added. */
function variant(base, { rename = [], add = 0, tag }) {
  const changed = base.map(file => ({ ...file }));
  const file = changed.find(file => file.name === 'incidents.json');
  const incidents = JSON.parse(file.text);
  for (const index of rename) incidents[index] = { ...incidents[index], name: `${incidents[index].name} (${tag})` };
  for (let n = 0; n < add; n++) {
    const added = structuredClone(incidents[0]), id = `a${tag}${n}`;
    Object.assign(added, { id, shortlink: `https://stspg.io/${id}`, name: `Added ${tag} ${n}`, incident_updates: added.incident_updates.map((update, k) => ({ ...update, id: `${id}u${k + 1}`, incident_id: id })) });
    incidents.push(added);
  }
  file.text = JSON.stringify(incidents);
  return { files: changed, incidents };
}

/** A real-size door import and its repeat imports: reconcile, catch-up and a
 * bounded catch-up through the HTTP door, with native edits still fenced. */
export async function importDoorScale({ runtime, door, owner }) {
  const directory = `${runtime.state}/v3/d1/miniflare-D1DatabaseObject`;
  const db = new DatabaseSync(`${directory}/${readdirSync(directory).find(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite')}`, { readOnly: true });
  const rows = (sql, ...params) => db.prepare(sql).all(...params).map(row => ({ ...row }));
  const native = () => JSON.stringify(rows("SELECT (SELECT json_group_array(json_array(id,reference,title,deleted_at)) FROM (SELECT * FROM incidents ORDER BY id)) incidents,(SELECT count(*) FROM incident_updates) updates,(SELECT count(*) FROM components) components,(SELECT json_group_array(json_array(id,state)) FROM (SELECT * FROM subscribers ORDER BY id)) subscribers,(SELECT json_group_array(json_array(kind,id,revision)) FROM (SELECT kind,id,revision FROM statuspage_import_targets UNION ALL SELECT 'source',id,revision FROM statuspage_import_source_targets ORDER BY 1,2)) targets"));
  const upload = async (exportFiles, name) => {
    const bytes = Buffer.from(JSON.stringify({ source: 'statuspage', files: exportFiles }));
    let uploadId;
    for (let offset = 0, index = 0; offset < bytes.length; offset += 65536, index++) {
      const chunk = bytes.subarray(offset, offset + 65536);
      const uploaded = await door('uploads', 'statuspage', { ...(uploadId ? { uploadId } : {}), name, bundleSha256: hash(bytes), totalBytes: bytes.length, totalChunks: Math.ceil(bytes.length / 65536), index, chunkSha256: hash(chunk), base64: chunk.toString('base64') });
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body)); uploadId = uploaded.body.uploadId;
    }
    return uploadId;
  };
  const plan = async (exportFiles, name, body = {}, extra = {}) => door('plan', 'statuspage', { uploadId: await upload(exportFiles, name), ...body }, extra);
  const apply = async (planned, extra = {}) => {
    const approval = { fingerprint: planned.body.fingerprint, approvalRecordId: randomUUID(), approvedAt: new Date().toISOString(), ...extra };
    let applied;
    for (let round = 0; round < 40; round++) {
      applied = await door('apply', 'statuspage', { planId: planned.body.planId, reviewedFingerprint: planned.body.fingerprint }, approval);
      assert.equal(applied.status, 200, JSON.stringify(applied.body));
      if (applied.body.job.state === 'completed') return applied;
    }
    assert.fail(`apply did not complete: ${applied.body.job.state}`);
  };
  const undo = async planId => {
    let undone;
    for (let round = 0; round < 40; round++) {
      undone = await door('undo', 'statuspage', { planId });
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      if (undone.body.state === 'cancelled' || undone.body.job?.state === 'undone') return undone;
    }
    assert.fail(`undo did not finish: ${undone.body.job?.state}`);
  };
  const keys = differences => differences.map(key => JSON.parse(key)[0]).sort();
  try {
    const empty = native();
    // The large page: 124 source records.
    const large = files('large');
    const basePlan = await plan(large, 'large.json');
    assert.equal(basePlan.status, 200, JSON.stringify(basePlan.body));
    await apply(basePlan);
    const reconciled = await door('reconcile', 'statuspage', { planId: basePlan.body.planId });
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body)); assert.equal(reconciled.body.ok, true);
    assert.equal(reconciled.body.counts.sourceRecords, basePlan.body.summary.sourceRecords);
    assert.equal(reconciled.body.counts.nativeTargets, rows('SELECT (SELECT count(*) FROM statuspage_import_targets)+(SELECT count(*) FROM statuspage_import_source_targets) AS n')[0].n, 'reconcile counts every native target the server holds');
    const baseline = native();
    const catchup = variant(large, { rename: [1], add: 1, tag: 'c' });
    const renamed = rows('SELECT id,reference FROM incidents WHERE title=?', JSON.parse(large.find(file => file.name === 'incidents.json').text)[1].name);
    assert.equal(renamed.length, 1);
    const caught = await plan(catchup.files, 'large-catchup.json', { catchup: true });
    assert.equal(caught.status, 200, JSON.stringify(caught.body));
    assert.deepEqual([keys(caught.body.differences.additions), keys(caught.body.differences.replacements), caught.body.differences.conflicts], [['incident'], ['incident', 'metadata'], []]);
    assert.equal(native(), baseline, 'catch-up planning makes no native writes');
    await apply(caught);
    const after = rows('SELECT id,reference,title FROM incidents WHERE id=?', renamed[0].id)[0];
    assert.deepEqual(after, { ...renamed[0], title: catchup.incidents[1].name }, 'the replaced incident keeps its id and public reference');
    assert.equal(rows("SELECT count(*) AS n FROM incidents WHERE title='Added c 0'")[0].n, 1);
    assert.equal(rows('SELECT count(*) AS n FROM incidents')[0].n, JSON.parse(JSON.parse(baseline)[0].incidents).length + 1);
    await undo(caught.body.planId);
    assert.equal(native(), baseline, 'catch-up undo restores the large import');
    const addition = await plan(variant(large, { add: 1, tag: 'n' }).files, 'large-addition.json', { catchup: true });
    assert.equal(addition.status, 200, JSON.stringify(addition.body)); assert.deepEqual(keys(addition.body.differences.additions), ['incident']);
    assert.equal((await undo(addition.body.planId)).body.state, 'cancelled');
    const standing = { approvalRecordId: randomUUID(), approvedAt: new Date().toISOString(), catchup: 'bounded' };
    const boundedLarge = await plan(variant(large, { rename: [1], add: 1, tag: 'b' }).files, 'large-bounded.json', { catchup: true }, standing);
    assert.equal(boundedLarge.status, 200, JSON.stringify(boundedLarge.body));
    assert.equal((await undo(boundedLarge.body.planId)).body.state, 'cancelled');
    await undo(basePlan.body.planId);
    assert.equal(native(), empty, 'undo removes the large import');

    // Every character a real export carries imports, reconciles, catches up and undoes.
    const text = characters();
    const textPlan = await plan(text, 'characters.json');
    assert.equal(textPlan.status, 200, JSON.stringify(textPlan.body));
    await apply(textPlan);
    const bytes = rows('SELECT hex(title) AS h FROM incidents UNION ALL SELECT hex(description) FROM components UNION ALL SELECT hex(customer_impact) FROM incident_updates UNION ALL SELECT hex(details) FROM incident_updates').map(row => Buffer.from(row.h, 'hex'));
    assert.ok(bytes.every(value => Buffer.from(value.toString('utf8')).equals(value)), 'every stored text is valid UTF-8');
    assert.equal(bytes.filter(value => value.includes(0)).length, 3, 'U+0000 is stored, not cut');
    assert.ok(bytes.some(value => value.equals(Buffer.from(`${'x'.repeat(248)}🙏…`))), 'the 250-character cut keeps a whole emoji');
    assert.ok(bytes.some(value => value.toString('utf8').startsWith('Lone \ufffd high and \ufffd low')), 'lone surrogates read as U+FFFD');
    const textReconciled = await door('reconcile', 'statuspage', { planId: textPlan.body.planId });
    assert.equal(textReconciled.status, 200, JSON.stringify(textReconciled.body)); assert.equal(textReconciled.body.ok, true);
    const textBaseline = native();
    const textCaught = await plan(variant(text, { rename: [0, 1], add: 1, tag: 'u' }).files, 'characters-catchup.json', { catchup: true });
    assert.equal(textCaught.status, 200, JSON.stringify(textCaught.body));
    assert.deepEqual([keys(textCaught.body.differences.additions), keys(textCaught.body.differences.replacements), textCaught.body.differences.conflicts], [['incident'], ['incident', 'incident', 'metadata'], []]);
    await apply(textCaught);
    const textCaughtUp = await door('reconcile', 'statuspage', { planId: textCaught.body.planId });
    assert.equal(textCaughtUp.status, 200, JSON.stringify(textCaughtUp.body)); assert.equal(textCaughtUp.body.ok, true);
    await undo(textCaught.body.planId);
    assert.equal(native(), textBaseline, 'catch-up undo restores every character');
    assert.equal((await door('reconcile', 'statuspage', { planId: textPlan.body.planId })).body.ok, true);
    await undo(textPlan.body.planId);
    assert.equal(native(), empty, 'undo removes every character import');

    // Three large pages: one read per target made undo's first round exceed a request's D1 queries.
    const bigPlan = await plan(scaled(3), 'large-x3.json');
    assert.equal(bigPlan.status, 200, JSON.stringify(bigPlan.body));
    await apply(bigPlan);
    assert.equal(rows('SELECT (SELECT count(*) FROM statuspage_import_targets)+(SELECT count(*) FROM statuspage_import_source_targets) AS n')[0].n, bigPlan.body.summary.created, 'every planned target was written');
    await undo(bigPlan.body.planId);
    assert.equal(native(), empty, 'undo removes the scaled import');

    // Sixty incidents with subscribers: a bounded grant admits one addition and
    // one unedited replacement; past the bound or after a native edit it refuses.
    const page = sixty();
    const sixtyPlan = await plan(page, 'sixty.json');
    assert.equal(sixtyPlan.status, 200, JSON.stringify(sixtyPlan.body));
    await apply(sixtyPlan);
    const held = native();
    const over = await plan(variant(page, { rename: [1, 2, 3], add: 1, tag: 'o' }).files, 'sixty-over.json', { catchup: true }, standing);
    assert.deepEqual([over.status, over.body.error], [409, 'catchup_requires_proposal:change_must_be_under_five_percent']);
    const bounded = await plan(variant(page, { rename: [1], add: 1, tag: 'b' }).files, 'sixty-bounded.json', { catchup: true }, standing);
    assert.equal(bounded.status, 200, JSON.stringify(bounded.body));
    assert.deepEqual([keys(bounded.body.differences.additions), keys(bounded.body.differences.replacements), bounded.body.differences.conflicts, bounded.body.differences.gone], [['incident'], ['incident', 'metadata'], [], []]);
    assert.equal(bounded.body.differences.unchanged.filter(key => JSON.parse(key)[0] === 'subscriber').length, rows('SELECT count(*) AS n FROM subscribers')[0].n, 'already-imported subscribers are unchanged');
    assert.equal(native(), held, 'bounded planning makes no native writes');
    await apply(bounded, { catchup: 'bounded', approvalRecordId: standing.approvalRecordId, approvedAt: standing.approvedAt });
    assert.equal(rows("SELECT count(*) AS n FROM incidents WHERE title='Synthetic incident 1 (b)'")[0].n, 1);
    assert.equal((await door('reconcile', 'statuspage', { planId: bounded.body.planId })).body.ok, true);
    await undo(bounded.body.planId);
    assert.equal(native(), held, 'bounded catch-up undo restores the previous import');
    const edited = rows("SELECT id FROM incidents WHERE title='Synthetic incident 3'")[0].id;
    assert.equal((await owner(`/api/app/incidents/${edited}`, { reason: 'Owner edit after the move-in' }, 'DELETE')).status, 200);
    const fenced = await plan(variant(page, { rename: [3], tag: 'e' }).files, 'sixty-edited.json', { catchup: true }, standing);
    assert.deepEqual([fenced.status, fenced.body.error], [409, 'catchup_requires_proposal:native_or_mapping_conflict']);
    const reviewed = await plan(variant(page, { rename: [3], tag: 'e' }).files, 'sixty-edited.json', { catchup: true });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.ok(reviewed.body.rejected.some(row => row.reason.startsWith('Native edit conflict')), 'an owner edit is never replaced');
    await undo(reviewed.body.planId);
    await undo(sixtyPlan.body.planId);
    console.log('Door at size: 124-record import reconciled, caught up and undone; every character shape reconciled, caught up and undone; a three-page import applied and undone; bounded catch-up of 60 incidents with subscribers admitted, applied and undone; over-bound and owner-edited catch-ups refused.');
  } finally { db.close(); }
}
