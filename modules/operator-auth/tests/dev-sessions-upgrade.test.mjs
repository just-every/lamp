import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { runtime, read, cookieFor, cookies, DEV_KEY } from './dev-runtime.mjs';

const seedMigration = name => readFile(new URL(`../../../default-seed/migrations/core/${name}`, import.meta.url), 'utf8');
// Every migration the reference applied before 0007: the schema of current main.
const priorMain = (await readdir(new URL('../../../default-seed/migrations/core/', import.meta.url))).filter(name => name.endsWith('.sql') && name < '0007').sort();
const tables = ['oa_bootstrap', 'oa_external_identities', 'oa_first_run', 'oa_invitation_cancellations', 'oa_limits', 'oa_operators', 'oa_sessions', 'oa_tokens'];
async function snapshot(db) {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results])));
}
const schemaOf = async db => (await db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE tbl_name='oa_sessions' ORDER BY type,name").all()).results;
const status = async (r, letter) => (await r.call('/auth/session', { cookie: cookieFor(letter.repeat(43)) })).status;

test('a populated store upgrades with identical rows; native sessions survive and legacy OIDC needs new provider admission', async () => {
  const r = await runtime([...await Promise.all(priorMain.map(seedMigration)), await read('./fixtures/dev-sessions/rows.sql')], { externalIssuers: ['https://idp.example.com'] });
  try {
    const migration = await read('../accounts/schema/dev-sessions.sql');
    assert.equal(await seedMigration('0007_dev_sessions.sql'), migration, 'the reference applies the module migration under its own next number');
    const before = await snapshot(r.db), structure = await schemaOf(r.db);
    assert.equal(priorMain.length, 6);
    assert.deepEqual([...new Set(before.oa_sessions.map(row => row.kind))].sort(), ['native', 'oidc', 'password', 'review'], 'every old session kind is present');
    await assert.rejects(r.db.prepare("UPDATE oa_sessions SET kind='dev' WHERE id='s-native'").run(), /CHECK/, 'the old store refuses dev sessions');
    assert.deepEqual(await r.db.prepare('SELECT 1 FROM oa_sessions').all().then(rows => rows.results.length), 7);
    // The applied statement count equals the file's own count (apply-sql.mjs).
    const { applySql } = await import('./apply-sql.mjs');
    const applied = await applySql(r.db, migration);
    assert.equal(applied.appliedStatements, applied.statementCount);
    // Current handlers require the later additive migrations too. Provider
    // admission is off on upgrade and needs provenance for a fresh sign-in.
    for (const name of ['domain-rules-step-up.sql', 'provider-control.sql', 'provider-pins.sql']) await applySql(r.db, await read('../accounts/schema/' + name));
    assert.deepEqual(await snapshot(r.db), before, 'every row and column, including ids and expiries, is unchanged');
    assert.deepEqual(await schemaOf(r.db), structure, 'the operator index and both unique indexes are rebuilt under their names');
    for (const letter of ['N', 'R', 'P']) assert.equal(await status(r, letter), 200, `the ${letter} session is still valid`);
    assert.equal(await status(r, 'O'), 401, 'a legacy provider session cannot bypass owner opt-in');
    assert.equal((await r.call('/auth/settings/identity', { method: 'POST', cookie: cookieFor('N'.repeat(43)), input: { idpSignIn: true } })).status, 200);
    assert.equal(await status(r, 'O'), 401, 'owner opt-in does not invent missing provider session provenance');
    assert.deepEqual(await snapshot(r.db), before, 'provider controls preserve every historical row and expiry');
    for (const letter of ['V', 'E', 'G']) assert.equal(await status(r, letter), 401, `the ${letter} session stays revoked, expired or fenced`);
    // Constraints survive the rebuild: CHECK, UNIQUE token hash and source link, and foreign keys.
    const row = before.oa_sessions.find(s => s.id === 's-native');
    await assert.rejects(r.db.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES('x','y','owner',1,'bogus',1,2)").run(), /CHECK/);
    await assert.rejects(r.db.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES('x',?,'owner',1,'native',1,2)").bind(row.token_hash).run(), /UNIQUE/);
    await assert.rejects(r.db.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at) VALUES('x','y','owner',1,'native','t-magic',1,2)").run(), /UNIQUE/);
    await assert.rejects(r.db.prepare("INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,created_at,expires_at) VALUES('x','y','nobody',1,'native',1,2)").run(), /FOREIGN KEY/);
    // The upgraded store admits a real dev session behind the key gate.
    const entered = await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY });
    assert.equal(entered.status, 303);
    assert.equal((await r.db.prepare("SELECT count(*) AS n FROM oa_sessions WHERE kind='dev'").first()).n, 1);
    assert.equal((await r.call('/auth/session', { cookie: cookies(entered) })).status, 200);
  } finally { await r.close(); }
});

test('a fresh store from the current schema admits dev sessions, and the migration is also safe after it', async () => {
  for (const schemas of [[await read('../accounts/schema/operator-auth.sql')], [await read('../accounts/schema/operator-auth.sql'), await read('../accounts/schema/dev-sessions.sql')]]) {
    const r = await runtime(schemas);
    try {
      await r.db.prepare("INSERT INTO oa_operators(id,email,display_name,role,status,created_at) VALUES('owner','owner@example.com','Owner','owner','active',1)").run();
      const entered = await r.call('/auth/dev/enter?as=owner', { key: DEV_KEY });
      assert.equal(entered.status, 303);
      const session = await r.call('/auth/session', { cookie: cookies(entered) });
      assert.equal(session.status, 200);
      assert.equal((await session.json()).kind, 'dev');
    } finally { await r.close(); }
  }
});
