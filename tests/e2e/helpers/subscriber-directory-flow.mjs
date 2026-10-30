import assert from 'node:assert/strict';
import { openSubscriberManagementFixture, pageOrigin } from './subscriber-management-fixture.mjs';

/** Reconcile a populated operator directory against identities retained at Add,
 * rather than treating one expected record on the next page as complete proof. */
export async function subscriberDirectoryFlow() {
  const fixture = await openSubscriberManagementFixture();
  const { api, post, raw } = fixture;
  try {
    const first = await fixture.createComponent('Synthetic Lamp directory API');
    const second = await fixture.createComponent('Synthetic Lamp directory dashboard');
    const expected = new Map();
    const links = new Map();
    for (let index = 0; index < 106; index++) {
      const suffix = String(index).padStart(3, '0');
      const channel = index % 2 === 0 ? 'email' : 'webhook';
      const address = [`synthetic-lamp-directory-${suffix}`, 'example.test'].join('@');
      const destination = channel === 'email' ? address : `https://receiver.example.test/synthetic-lamp-directory-${suffix}`;
      const componentIds = index % 3 === 0 ? [] : index % 3 === 1 ? [first.id] : [first.id, second.id];
      const response = await post('/api/app/subscribers', {
        channel, componentIds,
        ...(channel === 'email' ? { email: address } : { destination, contactEmail: address }),
      });
      assert.equal(response.status, 201, response.text);
      assert.equal(response.body.created, true);
      assert.equal(response.body.confirmationSent, true);
      const { id } = response.body.subscriber;
      assert.ok(id && !expected.has(id), 'each native Add returns a distinct subscriber identity');
      expected.set(id, { channel, destination, contactEmail: channel === 'webhook' ? address : null,
        state: 'pending', selectionMode: componentIds.length ? 'selected' : 'all',
        componentIds: [...componentIds].sort(), deactivationReason: null, deactivatedAt: null });
      const messages = fixture.messagesFor(address);
      assert.equal(messages.length, 1);
      const confirmation = messages[0].text.match(/https?:\/\/\S+\/confirm-subscription\/\S+/)?.[0];
      const unsubscribe = messages[0].text.match(/https?:\/\/\S+\/unsubscribe\/\S+/)?.[0];
      const manage = messages[0].text.match(/https?:\/\/\S+\/manage\/\S+/)?.[0];
      assert.ok(confirmation && unsubscribe && manage, 'native confirmation mail carries the recipient authority');
      links.set(id, { confirmation, unsubscribe, manage });
      if (index % 3 !== 0) {
        assert.equal((await raw(confirmation)).status, 200);
        expected.get(id).state = 'active';
      }
      if (index % 3 === 2) {
        const after = Date.now();
        const stopped = await raw(unsubscribe, { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin },
          body: 'List-Unsubscribe=One-Click' });
        assert.equal(stopped.status, 200, await stopped.text());
        Object.assign(expected.get(id), { state: 'deactivated', deactivationReason: 'unsubscribed',
          deactivatedAt: { after, before: Date.now() } });
      }
    }

    async function reconcileDirectory() {
      const actual = [];
      for (let offset = 0; offset < expected.size; offset += 100) {
        const response = await api(`/api/app/subscribers?limit=100&offset=${offset}`);
        assert.equal(response.status, 200, response.text);
        assert.equal(response.body.limit, 100);
        assert.equal(response.body.offset, offset);
        assert.equal(response.body.hasMore, offset + 100 < expected.size);
        assert.equal(response.body.subscribers.length, Math.min(100, expected.size - offset));
        actual.push(...response.body.subscribers);
      }
      const ids = actual.map(row => row.id);
      assert.equal(new Set(ids).size, ids.length, 'no identity occurs on two operator pages');
      assert.deepEqual([...ids].sort(), [...expected.keys()].sort(), 'every created subscriber is reachable exactly once');
      for (const row of actual) {
        const wanted = expected.get(row.id);
        for (const key of ['channel', 'destination', 'contactEmail', 'state', 'selectionMode', 'deactivationReason']) {
          assert.equal(row[key], wanted[key], `${row.id}: native list preserves ${key}`);
        }
        assert.deepEqual(row.componentSelections.map(selection => selection.componentId).sort(), wanted.componentIds,
          `${row.id}: native list preserves the exact selected component identities`);
        if (wanted.deactivatedAt) {
          const instant = Date.parse(row.deactivatedAt);
          assert.ok(instant >= wanted.deactivatedAt.after && instant <= wanted.deactivatedAt.before,
            `${row.id}: deactivation instant is bounded by the independent request clock`);
        } else assert.equal(row.deactivatedAt, null, 'pending and active rows have no deactivation instant');
      }
    }
    await reconcileDirectory();
    await reconcileDirectory();

    // Erasure is already checked across every retained table in subscriberAddFlow.
    // Also replay this directory's captured authority after the ordinary delete.
    for (const channel of ['email', 'webhook']) {
      const [id, wanted] = [...expected].find(([, row]) => row.channel === channel && row.state === 'active');
      const captured = links.get(id);
      const personalValues = [wanted.destination, wanted.contactEmail].filter(Boolean);
      const denied = await raw(`/api/app/subscribers/${id}`, { method: 'DELETE', headers: { Origin: fixture.appOrigin } });
      assert.equal(denied.status, 401, 'anonymous erasure is refused');
      await denied.body?.cancel();
      await reconcileDirectory();
      const after = Date.now();
      assert.equal((await api(`/api/app/subscribers/${id}`, { method: 'DELETE' })).status, 204);
      Object.assign(wanted, { destination: `deleted:${id}`, contactEmail: null, state: 'deactivated',
        deactivationReason: 'deleted by operator',
        deactivatedAt: { after, before: Date.now() } });
      for (const link of [captured.confirmation, captured.manage]) {
        const refused = await raw(link);
        assert.equal(refused.status, 404, 'captured authority cannot expose or revive an erased subscriber');
        await refused.body?.cancel();
      }
      const changed = await raw(captured.manage, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin },
        body: new URLSearchParams({ componentId: second.id }).toString() });
      assert.equal(changed.status, 404, 'captured management authority cannot change an erased subscriber');
      await changed.body?.cancel();
      for (const [table, data] of await fixture.databaseState()) for (const value of personalValues) {
        assert.ok(!data.includes(value), `directory erasure leaves no destination or contact in ${table}`);
      }
      const replay = await raw(captured.unsubscribe, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: pageOrigin },
        body: 'List-Unsubscribe=One-Click' });
      assert.equal(replay.status, 404, 'an erased subscriber has no remaining unsubscribe authority');
      await replay.body?.cancel();
    }
    await reconcileDirectory();
  } finally { await fixture.close(); }
}
