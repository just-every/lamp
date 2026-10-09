import assert from "node:assert/strict";

// Observe native dictionary lookup without replacing fetch or its transport.
const fields = ["method", "headers", "body", "referrer", "referrerPolicy", "mode", "credentials", "cache", "redirect", "integrity", "keepalive", "signal", "window", "duplex", "dispatcher", "priority"];

export function observedInit(values, shape = "own", throws = {}) {
  const trace = [];
  const owner = {};
  const init = shape === "inherited" ? Object.create(owner) : shape === "callable" ? function options() {} : owner;
  const descriptors = shape === "inherited" ? owner : init;
  for (const key of fields) {
    Object.defineProperty(descriptors, key, {
      enumerable: shape !== "non-enumerable",
      get() {
        assert.equal(this, init, `${key} getter receiver`);
        trace.push(key);
        if (Object.hasOwn(throws, key)) throw throws[key];
        return values[key];
      },
    });
  }
  return { init, trace };
}

export function applicationRequest(receipt) {
  const { connection, headers, ...request } = receipt;
  const { connection: connectionHeader, ...applicationHeaders } = headers;
  return { ...request, headers: applicationHeaders };
}

export async function rejection(operation) {
  try { await operation(); } catch (error) { return error; }
  assert.fail("expected native request rejection");
}
