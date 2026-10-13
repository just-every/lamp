// Pause a real D1 token write after it commits. The old split revoke/lookup
// path pauses between those operations; the atomic path pauses after its batch.
// All statements and returned rows come from the migrated workerd database.
export function holdConfirmationWrite(db, subscriberId) {
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  const statements = new WeakMap();
  let armed = true;
  const matches = ({ sql, args }) => /(?:UPDATE|INSERT INTO)\s+["`]?subscriber_tokens/i.test(sql) && args.includes('confirm') && args.includes(subscriberId);
  async function hold() {
    if (!armed) return;
    armed = false; entered.resolve(); await released.promise;
  }
  function wrap(native, sql, args = []) {
    const proxy = new Proxy(native, { get(target, property) {
      if (property === 'bind') return (...values) => wrap(target.bind(...values), sql, values);
      const value = Reflect.get(target, property);
      if (['run', 'all', 'raw', 'first'].includes(property)) return async (...values) => {
        const result = await value.apply(target, values);
        if (matches({ sql, args })) await hold();
        return result;
      };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    statements.set(proxy, { native, sql, args });
    return proxy;
  }
  return {
    binding: new Proxy(db, { get(target, property) {
      if (property === 'prepare') return sql => wrap(target.prepare(sql), sql);
      if (property === 'batch') return async batch => {
        const metadata = batch.map(statement => statements.get(statement));
        const result = await target.batch(batch.map((statement, i) => metadata[i]?.native ?? statement));
        if (metadata.some(statement => statement && matches(statement))) await hold();
        return result;
      };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    } }),
    async wait() {
      let timeout;
      try { await Promise.race([entered.promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Confirmation write was not reached')), 10_000); })]); }
      finally { clearTimeout(timeout); }
    },
    release: () => released.resolve(),
  };
}
