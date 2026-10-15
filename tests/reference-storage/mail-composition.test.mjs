import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');

async function composition(development) {
  const result = await build({entryPoints:['src/core/app/mail.ts'],bundle:true,loader:{'.sql':'text'},format:'esm',platform:'node',write:false,external:['cloudflare:workers'],define:{'import.meta.env.DEV':String(development)}});
  const source = result.outputFiles[0].text.replace(/import \{ env \} from [\"']cloudflare:workers[\"'];/, 'const env = {};');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const bindings = {
  LAMP_PAGE_HOST:'127.0.0.1', LAMP_APP_HOST:'127.0.0.1', MAIL_FROM_ADDRESS:'lamp@localhost.invalid',
  // These capability objects must not be used by a composition-only check.
  RER_DEV_KEY: 'test-only-key', RER_DEV_ORIGIN: 'http://127.0.0.1:55403', DB:{},
};

test('development suppresses mail and production keeps the configured transport', async () => {
  const dev = await composition(true), production = await composition(false);
  const local = dev.createAppMailTransport(bindings);
  assert.equal(local.sender.configured, true);
  assert.deepEqual(await local.sender.send({}), { disposition: 'suppressed' });
  assert.equal(production.createAppMailTransport(bindings).sender.configured, false);
});
