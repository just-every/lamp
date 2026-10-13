import assert from "node:assert/strict";

// Test clients follow the same read/acknowledged-version/write protocol as the
// operator. Explicit preconditions are retained for stale-client assertions.
export async function withDraftVersion(path, init, read) {
  if(!['GET','HEAD'].includes(init.method??'GET')){const headers=new Headers(init.headers);if(!headers.has('Origin')&&process.env.AUTH_ORIGIN)headers.set('Origin',process.env.AUTH_ORIGIN);init={...init,headers:Object.fromEntries(headers)};}
  const match = path.match(/^\/api\/app\/incidents\/([^/]+)\/(draft|publish|draft\/(?:schedule|review|correction)|templates\/[^/]+\/apply)$/);
  if (!match || !["POST", "PUT"].includes(init.method)) return init;
  const headers = new Headers(init.headers);
  if (headers.has("If-Match")) return init;
  const response = await read(`/api/app/incidents/${match[1]}`);
  assert.equal(response.status, 200, "Read the native incident before a draft mutation");
  const { incident } = await response.json();
  headers.set("If-Match", `${incident.draft?.id ?? "-"}:${incident.updates.length}`);
  return { ...init, headers: Object.fromEntries(headers) };
}
