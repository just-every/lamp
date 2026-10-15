import assert from "node:assert/strict";
import { Hono } from "hono";

export function assertSubscriberIsolation(headers, origin) {
  const directives = new Map((headers.get("content-security-policy") ?? "").split(";").map(value => {
    const [name, ...sources] = value.trim().split(/\s+/);
    return [name, sources];
  }));
  for (const name of ["default-src", "script-src", "style-src", "img-src", "connect-src", "form-action", "base-uri"]) {
    assert.deepEqual(directives.get(name), [origin], `${name} allows only this deployment origin`);
  }
  assert.deepEqual(directives.get("frame-ancestors"), ["'none'"]);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
  assert.equal(headers.get("cache-control"), "no-store");
  assert.equal(headers.get("x-robots-tag"), "noindex");
  assert.equal(headers.get("set-cookie"), null);
}

export async function exerciseSubscriberIsolation({ db, createSubscriberRepository, createSubscribersService, registerSubscriberRoutes, createPublicWriteRateLimiter, createMail }) {
  // Exercise the policy against more than a hard-coded production hostname.
  const origin = "https://subscriber-pages.example.test:8443";
  const mail = createMail();
  const options = { mail, fromAddress: "lamp@example.test", tokenSecret: "synthetic-fixture-isolation-secret" };
  const makeApp = (serviceOptions, limited = false) => {
    const app = new Hono();
    registerSubscriberRoutes(app, createSubscribersService(createSubscriberRepository(db), serviceOptions), limited ? { rateLimiter: createPublicWriteRateLimiter(db) } : {});
    return app;
  };
  const app = makeApp(options);
  const post = body => ({ method: "POST", body: new URLSearchParams(body) });
  async function html(path, init = {}, status = 200, target = app) {
    const response = await target.request(origin + path, { ...init, headers: { Accept: "text/html", ...init.headers } });
    assert.equal(response.status, status);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assertSubscriberIsolation(response.headers, origin);
    const body = await response.text();
    return body;
  }
  function mailedPath(kind) {
    const link = mail.messages.at(-1).text.match(new RegExp(`https://[^\\s]+/${kind}/[^\\s]+`));
    assert.ok(Boolean(link), "mail carries the required subscription action");
    return new URL(link[0]).pathname;
  }
  const email = "isolation-reader@example.test";
  const neutral = await html("/subscribe", post({ email }), 202);
  assert.equal(await html("/subscribe", post({ email }), 202), neutral);
  const confirm = mailedPath("confirm-subscription");
  const unsubscribe = mailedPath("unsubscribe");
  await html(confirm);
  await html(confirm, {}, 404);
  assert.equal(await html("/subscribe", post({ email }), 202), neutral);
  const manage = mailedPath("manage");
  await html(manage);
  await html(manage, post({}));
  await html(unsubscribe);
  await html(unsubscribe, post({ action: "unsubscribe" }));
  await html(unsubscribe, post({ action: "unsubscribe" }), 404);
  await html(manage, {}, 404);
  await html(manage, post({}), 404);
  await html("/confirm-subscription/invalid", {}, 404);
  await html("/manage/invalid", {}, 404);
  await html("/manage/invalid", post({}), 404);
  await html("/unsubscribe/invalid");
  await html("/unsubscribe/invalid", post({ action: "unsubscribe" }), 404);
  await html("/subscribe", post({ email: "invalid" }), 400);
  await html("/subscribe", { ...post({ email }), headers: { "Sec-Fetch-Site": "cross-site" } }, 403);
  await html("/subscribe", post({ email }), 503, makeApp({}));

  const limitedApp = makeApp(options, true);
  const cases = [
    ["/subscribe", post({ email: "invalid" })],
    ["/confirm-subscription/rate-case", {}],
    ["/manage/rate-case", {}],
    ["/unsubscribe/rate-case", {}],
    // Token form posts are limited too.
    ["/manage/rate-case", post({})],
    ["/unsubscribe/rate-case", post({})],
  ];
  for (const [path, init] of cases) {
    let limited = false;
    // Bound the probe without asserting the configured limit's numeric value.
    // The limiter's window is fixed per minute, so probe each case on its own
    // rather than expecting a later request to land in the same window.
    for (let attempt = 0; attempt < 100 && !limited; attempt++) {
      const response = await limitedApp.request(origin + path, { ...init, headers: { Accept: "text/html", "CF-Connecting-IP": "192.0.2.81" } });
      assertSubscriberIsolation(response.headers, origin);
      limited = response.status === 429;
      if (limited) assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
      await response.text();
    }
    assert.equal(limited, true, "the real D1 limiter produces an isolated HTML outcome");
  }
}
