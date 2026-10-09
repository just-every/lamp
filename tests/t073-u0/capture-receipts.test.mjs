import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRuntime, executeSql, migrate, loadTypescript, databaseSnapshot } from './runtime.mjs';

const { createDeliveryRepository } = await loadTypescript('src/core/features/deliveries/repository.ts');
const schemaObjects = async db => (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE type IN ('index','trigger') ORDER BY name").all()).results;

test('NOTIFY-004 NOTIFY-005 capture migration preserves prior delivery evidence and stops local retry/reconciliation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lamp-t073-capture-'));
  let runtime = openRuntime(directory);
  try {
    let db = await runtime.getD1Database('DB');
    await migrate(db, name => name < '0014');
    await executeSql(db, await readFile('tests/t073-u0/prior-data.sql', 'utf8'));
    const before = await databaseSnapshot(db);
    const objects = await schemaObjects(db);
    const keys = (await db.prepare('PRAGMA foreign_key_list(notification_delivery_attempts)').all()).results;
    await executeSql(db, await readFile('migrations/core/0014_local_capture_receipts.sql', 'utf8'));
    const after = await databaseSnapshot(db);
    assert.ok(after.notification_delivery_attempts.every(row => row.local_capture_id === null));
    after.notification_delivery_attempts = after.notification_delivery_attempts.map(({local_capture_id, ...oldColumns}) => oldColumns);
    assert.deepEqual(after, before, 'all prior data and provider receipts survive unchanged');
    assert.deepEqual(await schemaObjects(db), objects);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_list(notification_delivery_attempts)').all()).results, keys);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    await db.prepare(`INSERT INTO notification_deliveries
      (id,subscriber_id,incident_update_id,channel,outcome,queued_at,notification_event_id,created_at,updated_at)
      VALUES ('local','subscriber','resolved','email','queued','2026-01-03','local-event','2026-01-03','2026-01-03')`).run();
    let repository = createDeliveryRepository(db);
    assert.equal(await repository.claimDelivery('local', '2026-01-03', '2026-01-02'), true);
    await repository.recordAttempt({id:'local-attempt',deliveryId:'local',attemptNumber:1,attemptedAt:'2026-01-03',providerMessageId:null,error:null,createdAt:'2026-01-03',localCaptureId:'capture-envelope-id'});
    await repository.releaseDeliveryClaim('local');
    const captured = (await repository.listDeliveries({})).find(row => row.id === 'local');
    assert.equal(captured.outcome, 'queued', 'does not invent a provider delivery outcome');
    assert.equal(captured.outcomeAt, null);
    assert.equal(captured.providerAcceptedAt, null);
    assert.equal(captured.localCaptureId, 'capture-envelope-id');
    assert.equal(captured.localCapturedAt, '2026-01-03');
    assert.equal(await repository.claimDelivery('local', '2026-01-05', '2026-01-04'), false);
    assert.deepEqual(await repository.listQueuedDeliveryIdsForEvent('local-event'), []);
    assert.equal(await repository.markProviderOutcome('local', 'delivered', '2026-01-04'), false);
    // Even an unrelated/older provider attempt must not reconcile a captured
    // delivery after a restored database has mixed development/provider history.
    await repository.recordAttempt({id:'earlier-provider',deliveryId:'local',attemptNumber:2,attemptedAt:'2026-01-02',providerMessageId:'prior-provider-id',error:'uncertain',createdAt:'2026-01-02'});
    await repository.isProviderWebhookNew({providerEventId:'prior-event',providerMessageId:'prior-provider-id',eventType:'delivered',hardBounce:false,now:'2026-01-05'});
    assert.equal(await repository.findDeliveryByProviderMessageId('prior-provider-id'), null);
    assert.deepEqual(await repository.listPendingProviderMessageIds(10), []);
    await assert.rejects(repository.recordAttempt({id:'invalid-provider',deliveryId:'local',attemptNumber:3,attemptedAt:'2026-01-03',providerMessageId:'not-a-capture',error:null,createdAt:'2026-01-03',localCaptureId:'capture-invalid'}), /CHECK/);
    await assert.rejects(repository.recordAttempt({id:'invalid-error',deliveryId:'local',attemptNumber:3,attemptedAt:'2026-01-03',providerMessageId:null,error:'failure',createdAt:'2026-01-03',localCaptureId:'capture-invalid'}), /CHECK/);
    await runtime.dispose(); runtime = openRuntime(directory);
    db = await runtime.getD1Database('DB'); repository = createDeliveryRepository(db);
    assert.equal(await repository.claimDelivery('local', '2026-01-07', '2026-01-06'), false);
    assert.equal((await repository.listDeliveries({})).find(row => row.id === 'local').localCaptureId, 'capture-envelope-id');
    const old = (await repository.listDeliveries({})).find(row => row.id === 'delivery');
    assert.equal(old.providerAcceptedAt, '2026-01-02');
    assert.equal(old.localCaptureId, null);
    assert.equal(old.outcome, 'delivered');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await runtime.dispose(); await rm(directory, {recursive:true,force:true}); }
});
