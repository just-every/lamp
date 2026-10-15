import { createRequire } from 'node:module';
const { build } = createRequire(createRequire(import.meta.url).resolve('wrangler'))('esbuild');
export async function compileAccess(development) {
  const result = await build({ entryPoints: ['src/core/platform/development/access.ts'], bundle: true, format: 'esm', platform: 'node', write: false, define: { 'import.meta.env.DEV': String(development) } });
  return { access: await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`), close() {} };
}
