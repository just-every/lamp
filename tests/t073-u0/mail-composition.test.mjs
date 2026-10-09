import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');

async function composition(development) {
  const result = await build({entryPoints:['src/core/app/mail.ts'],bundle:true,format:'esm',platform:'node',write:false,define:{'import.meta.env.DEV':String(development)}});
  return {source:result.outputFiles[0].text,module:await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)};
}
const bindings = {
  LAMP_PAGE_HOST:'127.0.0.1', LAMP_APP_HOST:'127.0.0.1', MAIL_FROM_ADDRESS:'lamp@localhost.invalid',
  // These capability objects must not be used by a composition-only check.
  LAMP_DEV_OUTBOX:{put(){throw Error('unexpected storage');},get(){throw Error('unexpected storage');}}, DB:{},
};

test('development mail composition requires an explicit actual request or background context', async () => {
  const {module:{createAppMailTransport}} = await composition(true);
  assert.equal(createAppMailTransport(bindings, undefined).sender.configured, false, 'missing request is not implicit background capture');
  assert.equal(createAppMailTransport(bindings, undefined, new Request('http://127.0.0.1/signin/request')).sender.configured, true);
  assert.equal(createAppMailTransport(bindings, undefined, 'background').sender.configured, true);
  assert.equal(createAppMailTransport(bindings, undefined, new Request('https://public.example/signin/request')).sender.configured, false);
  assert.equal(createAppMailTransport(bindings, undefined, new Request('http://127.0.0.1/signin/request',{headers:{Forwarded:'host=public.example'}})).sender.configured, false);
  const extension = {configured:true,send(){throw Error('extension must not run');}};
  assert.throws(() => createAppMailTransport(bindings, extension, new Request('http://127.0.0.1/signin/request')), /cannot be combined/);
});

test('production mail composition cannot select local capture even with local bindings and flags', async () => {
  const {source,module:{createAppMailTransport,prepareAppMailBindings,notificationOrigin}} = await composition(false);
  for (const context of [undefined, 'background', new Request('http://127.0.0.1/signin/request')]) {
    const flags = {...bindings,LAMP_LOCAL_MAIL:true,LAMP_DEV_MAIL:true};
    assert.equal(createAppMailTransport(flags, undefined, context).sender.configured, false);
    assert.equal(await prepareAppMailBindings(flags, context), flags);
    assert.equal(await notificationOrigin(flags), "https://127.0.0.1");
    assert.equal(createAppMailTransport(flags, undefined, context).capturesLocally, false);
  }
  assert.doesNotMatch(source, /LAMP_DEV_OUTBOX|configuration\/subscriber-token-secret|envelopes\//, 'development envelope storage is removed from production composition');
});

test('local background notification origin fails until the actual public origin is persisted', async () => {
  const {module:{notificationOrigin}} = await composition(true);
  const missingOrigin = {...bindings,LAMP_DEV_OUTBOX:{async get(){return null;}}};
  await assert.rejects(notificationOrigin(missingOrigin), /Open the configured local public page/);
  const persistedOrigin = {...bindings,LAMP_DEV_OUTBOX:{async get(){return {async text(){return 'http://127.0.0.1:55403';}};}}};
  assert.equal(await notificationOrigin(persistedOrigin), 'http://127.0.0.1:55403');
});
