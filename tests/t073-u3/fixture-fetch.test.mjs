import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { fixtureFetch } from "./fixture-fetch.mjs";
import { transportServer } from "./fixtures/transport-harness.mjs";
import { applicationRequest, observedInit, rejection } from "./fixtures/request-init.mjs";

const totals = (receipt) => ({
  connections: receipt.connections.length,
  rawEvents: receipt.connections.reduce((sum, connection) => sum + connection.rawEvents, 0),
  guardedEvents: receipt.connections.reduce((sum, connection) => sum + connection.guardedEvents, 0),
  httpRequests: receipt.requests.length,
});

test("native pooled fetch exposes an idle-connection closure at the real TCP boundary", async (t) => {
  const server = await transportServer(t);
  const warm = await fetch(`${server.origin}/echo`);
  await warm.text();
  await setImmediate();
  const armed = server.control("arm");
  assert.equal(armed.connections.length, 1);
  assert.equal(armed.connections[0].idle, true);
  assert.equal(armed.connections[0].armed, true);
  assert.equal(armed.connections[0].closed, false);
  await assert.rejects(fetch(`${server.origin}/echo`), (error) => {
    assert.equal(error.name, "TypeError");
    assert.equal(error.cause?.code, "UND_ERR_SOCKET");
    return true;
  });
  const receipt = server.control();
  assert.deepEqual(totals(receipt), { connections: 1, rawEvents: 2, guardedEvents: 1, httpRequests: 1 });
  assert.ok(receipt.connections[0].rawBytes > armed.connections[0].rawBytes);
  assert.equal(receipt.connections[0].closed, true);
  t.diagnostic(JSON.stringify(receipt));
});

test("fixture fetch closes the warm connection and makes one fresh request across the same CLI boundary", async (t) => {
  const server = await transportServer(t);
  const nativeFetch = globalThis.fetch;
  const warm = await fixtureFetch(`${server.origin}/echo`);
  const first = await warm.json();
  await setImmediate();
  const armed = server.control("arm");
  assert.equal(armed.connections.length, 1);
  assert.equal(armed.connections[0].closed, true);
  assert.equal(armed.connections[0].armed, false);
  const response = await fixtureFetch(`${server.origin}/echo`);
  const second = await response.json();
  assert.equal(response.status, 200);
  assert.notEqual(first.connection, second.connection);
  const receipt = server.control();
  assert.deepEqual(totals(receipt), { connections: 2, rawEvents: 2, guardedEvents: 0, httpRequests: 2 });
  assert.ok(receipt.connections.every((connection) => connection.closed));
  assert.ok(receipt.requests.every((request) => request.headers.connection === "close"));
  assert.equal(globalThis.fetch, nativeFetch);
  t.diagnostic(JSON.stringify(receipt));
});

test("Request and RequestInit retain URL, method, body and caller-owned headers", async (t) => {
  const server = await transportServer(t);
  const headers = new Headers({ connection: "keep-alive", cookie: "session=fixture", "x-request": "original" });
  const request = new Request(`${server.origin}/echo?exact=a%20b`, { method: "POST", body: "request bytes", headers });
  const response = await fixtureFetch(request);
  assert.ok(response instanceof Response);
  assert.equal(response.bodyUsed, false);
  assert.equal(response.url, request.url);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(response.headers.getSetCookie(), ["first=one; Path=/", "second=two; HttpOnly"]);
  const observed = await response.json();
  assert.equal(observed.url, "/echo?exact=a%20b");
  assert.equal(observed.method, "POST");
  assert.equal(observed.body, "request bytes");
  assert.equal(observed.headers.cookie, "session=fixture");
  assert.equal(observed.headers["x-request"], "original");
  assert.equal(observed.headers.connection, "close");
  assert.equal(headers.get("connection"), "keep-alive");
  assert.equal(request.headers.get("connection"), "keep-alive");
  assert.equal(request.bodyUsed, true);

  for (const override of [new Headers({ "x-override": "yes" }), [["x-override", "yes"]], { "x-override": "yes" }]) {
    const before = [...new Headers(override)];
    const inherited = new Request(`${server.origin}/echo`, { method: "POST", headers: { "x-inherited": "omit" }, body: "old body" });
    const overridden = await fixtureFetch(inherited, { method: "PUT", body: "new body", headers: override });
    const result = await overridden.json();
    assert.equal(result.method, "PUT");
    assert.equal(result.body, "new body");
    assert.equal(result.headers["x-override"], "yes");
    assert.equal(result.headers["x-inherited"], undefined);
    assert.equal(result.headers.connection, "close");
    assert.deepEqual([...new Headers(override)], before);
  }
  const missing = await fixtureFetch(new URL("/missing", server.origin));
  assert.equal(missing.status, 404);
  assert.equal(missing.ok, false);
  assert.equal(missing.headers.get("content-type"), "text/html");
  assert.equal(missing.headers.get("x-fixture"), "native-http");
  assert.equal(await missing.text(), "<h1>Missing</h1>");
  assert.deepEqual(totals(server.control()), { connections: 5, rawEvents: 5, guardedEvents: 0, httpRequests: 5 });
});

test("native response streams remain unconsumed and redirects retain native behavior", async (t) => {
  const server = await transportServer(t);
  const response = await fixtureFetch(`${server.origin}/stream`);
  assert.equal(response.bodyUsed, false);
  assert.equal(response.headers.get("x-native-stream"), "yes");
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first:");
  server.control("finish-streams");
  assert.equal(new TextDecoder().decode((await reader.read()).value), "last");
  assert.equal((await reader.read()).done, true);

  const manual = await fixtureFetch(`${server.origin}/redirect`, { redirect: "manual" });
  assert.equal(manual.status, 302);
  assert.equal(manual.redirected, false);
  assert.equal(manual.url, `${server.origin}/redirect`);
  assert.equal(manual.headers.get("location"), "/echo");
  assert.deepEqual(manual.headers.getSetCookie(), ["first=one; Path=/", "second=two; HttpOnly"]);
  assert.equal(await manual.text(), "redirect body");
  const followed = await fixtureFetch(`${server.origin}/redirect`);
  assert.equal(followed.redirected, true);
  assert.equal(followed.url, `${server.origin}/echo`);
  assert.equal(followed.status, 200);
  await followed.text();
  await assert.rejects(fixtureFetch(`${server.origin}/redirect`, { redirect: "error" }), TypeError);
  const receipt = server.control();
  assert.deepEqual(totals(receipt), { connections: 5, rawEvents: 5, guardedEvents: 0, httpRequests: 5 });
  assert.ok(receipt.requests.every((request) => request.headers.connection === "close"));
});

test("native abort and socket errors propagate without a second attempt", async (t) => {
  const server = await transportServer(t);
  await assert.rejects(fixtureFetch(`${server.origin}/echo`, { headers: { "invalid header": "value" } }), TypeError);
  await assert.rejects(fixtureFetch("invalid URL"), TypeError);
  const reason = new Error("caller cancelled");
  const aborted = AbortSignal.abort(reason);
  await assert.rejects(fixtureFetch(new Request(`${server.origin}/echo`, { signal: aborted })), (error) => error === reason);
  assert.deepEqual(totals(server.control()), { connections: 0, rawEvents: 0, guardedEvents: 0, httpRequests: 0 });

  const controller = new AbortController();
  const streaming = await fixtureFetch(`${server.origin}/stream`, { signal: controller.signal });
  const body = streaming.text();
  controller.abort();
  await assert.rejects(body, { name: "AbortError" });
  await assert.rejects(fixtureFetch(`${server.origin}/disconnect`), (error) => {
    assert.equal(error.name, "TypeError");
    assert.equal(error.cause?.code, "UND_ERR_SOCKET");
    return true;
  });
  const receipt = server.control();
  t.diagnostic(JSON.stringify(receipt));
  // Node may open an empty replacement connection after aborting a response.
  // Count actual TCP writes and parsed HTTP requests separately from sockets.
  const { connections: connectionCount, ...attempts } = totals(receipt);
  assert.deepEqual(attempts, { rawEvents: 2, guardedEvents: 0, httpRequests: 2 });
  assert.equal(receipt.connections.filter((connection) => connection.rawBytes > 0).length, 2);
  assert.ok(connectionCount >= 2);
  for (const connection of receipt.connections.filter((connection) => connection.rawBytes === 0)) {
    assert.equal(connection.rawEvents, 0);
    assert.equal(connection.httpRequests, 0);
  }
});

test("inherited, non-enumerable and callable RequestInit dictionaries retain native lookup and HTTP options", async (t) => {
  const server = await transportServer(t);
  for (const shape of ["inherited", "non-enumerable", "callable"]) {
    const headers = Object.freeze({ connection: "keep-alive", cookie: `session=${shape}`, "x-dictionary": shape });
    const options = {
      method: "PUT", body: `${shape} bytes`, headers, signal: new AbortController().signal,
      redirect: "manual", priority: "high", credentials: "include", cache: "no-store",
      referrer: `${server.origin}/source`, referrerPolicy: "unsafe-url", keepalive: true,
    };
    const native = observedInit(options, shape);
    const adapted = observedInit(options, shape);
    if (shape !== "callable") assert.deepEqual(Object.keys(adapted.init), []);
    const expected = await (await fetch(`${server.origin}/echo`, native.init)).json();
    const actual = await (await fixtureFetch(`${server.origin}/echo`, adapted.init)).json();
    assert.deepEqual(applicationRequest(actual), applicationRequest(expected));
    assert.equal(actual.method, "PUT");
    assert.equal(actual.body, `${shape} bytes`);
    assert.equal(actual.headers.cookie, `session=${shape}`);
    assert.equal(actual.headers.referer, `${server.origin}/source`);
    assert.equal(actual.headers.connection, "close");
    assert.deepEqual(adapted.trace, native.trace);
    assert.equal(adapted.trace.filter((key) => key === "headers").length, 1);
    assert.equal(headers.connection, "keep-alive");
    const redirected = await fixtureFetch(`${server.origin}/redirect`, adapted.init);
    assert.equal(redirected.status, 302);
    await redirected.text();
    t.diagnostic(JSON.stringify({ shape, nativeLookup: native.trace, observed: actual }));
  }
  assert.equal(server.control().requests.length, 9);
});

test("inherited and non-enumerable pre-aborted signals preserve their reason without HTTP attempts", async (t) => {
  const server = await transportServer(t);
  for (const shape of ["inherited", "non-enumerable"]) {
    const reason = new Error(`${shape} caller cancellation`);
    const options = { method: "POST", body: "must not arrive", signal: AbortSignal.abort(reason) };
    const native = observedInit(options, shape);
    const adapted = observedInit(options, shape);
    assert.equal(await rejection(() => fetch(`${server.origin}/echo`, native.init)), reason);
    assert.equal(await rejection(() => fixtureFetch(`${server.origin}/echo`, adapted.init)), reason);
    assert.deepEqual(adapted.trace, native.trace);
  }
  assert.deepEqual(totals(server.control()), { connections: 0, rawEvents: 0, guardedEvents: 0, httpRequests: 0 });
});

test("the headers accessor is read once with its original receiver and Request overrides remain private", async (t) => {
  const server = await transportServer(t);
  for (const shape of ["own", "inherited", "non-enumerable"]) {
    const original = new Request(`${server.origin}/echo`, { method: "POST", body: "old body", headers: { "x-original": "original", connection: "keep-alive" } });
    const headers = new Headers({ cookie: "session=accessor", "x-override": "first", connection: "keep-alive" });
    let reads = 0;
    const owner = { method: "PUT", body: "new body" };
    const init = shape === "inherited" ? Object.create(owner) : owner;
    Object.defineProperty(owner, "headers", {
      enumerable: shape !== "non-enumerable",
      get() {
        assert.equal(this, init);
        assert.equal(++reads, 1);
        return headers;
      },
    });
    const response = await fixtureFetch(original, init);
    assert.ok(response instanceof Response);
    assert.equal(response.bodyUsed, false);
    const actual = await response.json();
    assert.equal(reads, 1);
    assert.equal(actual.method, "PUT");
    assert.equal(actual.body, "new body");
    assert.equal(actual.headers.cookie, "session=accessor");
    assert.equal(actual.headers["x-override"], "first");
    assert.equal(actual.headers["x-original"], undefined);
    assert.equal(actual.headers.connection, "close");
    assert.equal(original.headers.get("connection"), "keep-alive");
    assert.equal(headers.get("connection"), "keep-alive");
    assert.equal(await original.text(), "old body");
  }
  assert.equal(server.control().requests.length, 3);
});

test("native dictionary conversion side effects, getter errors and validation order are preserved", async (t) => {
  const server = await transportServer(t);
  const marker = new Error("original getter error");
  const cases = [
    { values: {}, throws: { headers: marker } },
    { values: {}, throws: { body: marker, headers: new Error("headers must not be read") } },
    // Header name validation occurs after all RequestInit dictionary getters.
    { values: { headers: { "invalid header": "value" } }, throws: { method: marker } },
    { values: { headers: { "invalid header": "value" } }, throws: {} },
    { values: { method: "POST", body: "bytes", priority: "invalid" }, throws: {} },
    { values: { method: "POST", body: "bytes", duplex: "invalid" }, throws: {} },
  ];
  for (const { values, throws } of cases) {
    const native = observedInit(values, "own", throws);
    const adapted = observedInit(values, "own", throws);
    const expected = await rejection(() => fetch(`${server.origin}/echo`, native.init));
    const actual = await rejection(() => fixtureFetch(`${server.origin}/echo`, adapted.init));
    if (expected === marker) assert.equal(actual, marker);
    else {
      assert.equal(actual.constructor, expected.constructor);
      assert.equal(actual.message, expected.message);
    }
    assert.deepEqual(adapted.trace, native.trace);
    t.diagnostic(JSON.stringify({ nativeLookup: native.trace, error: actual.message }));
  }
  assert.deepEqual(totals(server.control()), { connections: 0, rawEvents: 0, guardedEvents: 0, httpRequests: 0 });
});

test("native nullish dictionaries and invalid primitives keep native acceptance and rejection", async (t) => {
  const server = await transportServer(t);
  for (const init of [undefined, null]) {
    const response = await fixtureFetch(`${server.origin}/echo`, init);
    assert.equal((await response.json()).headers.connection, "close");
  }
  for (const init of [false, 1, "options", 1n, Symbol("options")]) {
    const expected = await rejection(() => fetch(`${server.origin}/echo`, init));
    const actual = await rejection(() => fixtureFetch(`${server.origin}/echo`, init));
    assert.equal(actual.constructor, expected.constructor);
    assert.equal(actual.message, expected.message);
  }
  assert.deepEqual(totals(server.control()), { connections: 2, rawEvents: 2, guardedEvents: 0, httpRequests: 2 });
});

test("native dispatcher extensions, streaming duplex and global transport identity survive conversion", async (t) => {
  const server = await transportServer(t);
  const nativeFetch = globalThis.fetch;
  // Node exposes its actual native dispatcher here; this forwards real dispatches.
  const nativeDispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
  assert.equal(typeof nativeDispatcher?.dispatch, "function");
  let dispatches = 0;
  const dispatcher = {
    dispatch(options, handler) {
      dispatches += 1;
      return nativeDispatcher.dispatch(options, handler);
    },
  };
  for (const shape of ["inherited", "non-enumerable"]) {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`${shape} stream`)); controller.close(); } });
    const { init, trace } = observedInit({ method: "POST", body, duplex: "half", dispatcher, priority: "low" }, shape);
    const actual = await (await fixtureFetch(`${server.origin}/echo`, init)).json();
    assert.equal(actual.method, "POST");
    assert.equal(actual.body, `${shape} stream`);
    assert.equal(actual.headers.connection, "close");
    assert.equal(trace.filter((key) => key === "dispatcher").length, 1);
    assert.equal(trace.filter((key) => key === "duplex").length, 1);
  }
  const request = new Request(`${server.origin}/echo`, { dispatcher });
  await (await fixtureFetch(request)).text();
  assert.equal(dispatches, 3);
  assert.equal(server.control().requests.length, 3);
  assert.equal(globalThis.fetch, nativeFetch);
  assert.equal(globalThis[Symbol.for("undici.globalDispatcher.1")], nativeDispatcher);
});

test("native input conversion precedes dictionary lookup and ignores unrelated getters", async (t) => {
  const server = await transportServer(t);
  for (const transport of [fetch, fixtureFetch]) {
    const trace = [];
    const input = { toString() { trace.push("input"); return `${server.origin}/echo`; } };
    const init = Object.freeze({
      method: "POST", body: "frozen options", headers: Object.freeze({ cookie: "session=frozen" }),
      get unrelated() { assert.fail("native RequestInit does not read unknown fields"); },
      get signal() { trace.push("signal"); return undefined; },
    });
    const actual = await (await transport(input, init)).json();
    assert.equal(actual.method, "POST");
    assert.equal(actual.body, "frozen options");
    assert.equal(actual.headers.cookie, "session=frozen");
    assert.deepEqual(trace, ["input", "signal"]);
    const reason = new Error("input conversion failed");
    const invalidInput = { toString() { throw reason; } };
    assert.equal(await rejection(() => transport(invalidInput, { get headers() { assert.fail("input conversion must be first"); } })), reason);
  }
  assert.equal(server.control().requests.length, 2);
});
