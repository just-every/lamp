import {assertArtifactPath} from './delivery/artifact-paths.mjs';
import {deploymentSpec} from './delivery/deployment-spec.mjs';
import {specInputs,extraMigrationDirectories} from './delivery/spec-inputs.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// This producer runs only in the credential-free build. Its output is untrusted
// data: the independent delivery service validates every byte and owns bindings.
export async function collectFiles(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      assertArtifactPath(relative(directory, child));
      if (entry.isSymbolicLink()) throw new Error(`Artifact cannot contain symlinks: ${child}`);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) {
        const bytes = await readFile(child);
        files.push({ path: relative(directory, child).split('\\').join('/'), contentBase64: bytes.toString('base64') });
      } else throw new Error(`Unsupported artifact entry: ${child}`);
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function mimeType(path) {
  const extension = path.split('.').pop();
  return ({ js: 'application/javascript', css: 'text/css', html: 'text/html', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2' })[extension] ?? 'application/octet-stream';
}

export async function produceArtifact({ root = process.cwd(), output = 'delivery-artifact/lamp-worker-artifact.json' } = {}) {
  const modules = (await collectFiles(join(root, 'dist/server'))).filter(file => file.path !== 'wrangler.json' && !file.path.endsWith('.map'));
  if (!modules.some(file => file.path === 'index.js')) throw new Error('Build did not emit dist/server/index.js.');
  if (modules.some(file => file.path === 'rer-entry.js')) throw new Error('Build uses reserved rer-entry.js module name.');
  modules.push({ path: 'rer-entry.js', contentBase64: (await readFile(new URL('./delivery/rer-entry.template.mjs', import.meta.url))).toString('base64') });
  const artifact = { schema: 1, deploymentSpec: await deploymentSpec(root,{...specInputs,extraMigrationDirectories:extraMigrationDirectories(root)}), mainModule: 'rer-entry.js',
    modules: modules.map(file => ({ name: file.path, contentBase64: file.contentBase64, type: file.path.endsWith('.wasm') ? 'compiled-wasm' : file.path.endsWith('.js') ? 'esm' : 'text' })),
    assets: (await collectFiles(join(root, 'dist/client'))).map(file => ({ path: '/' + file.path, contentBase64: file.contentBase64, contentType: mimeType(file.path) })) };
  const destination = resolve(root, output);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, `${JSON.stringify(artifact)}\n`, { flag: 'wx' });
  return destination;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  produceArtifact().then(path => console.log(path)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
