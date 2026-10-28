import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Native installation journeys exercise setup's settings, migrations, owner
// claim and production runtime using the candidate already compiled by Verify.
// Only their disposable checkout replaces its build command with this artifact
// materialization; the edition's real build recipe remains unchanged.
export async function installSharedBuild(sourceRoot, installationRoot) {
  const source = resolve(sourceRoot, 'dist');
  const script = 'scripts/verification/reuse-journey-build.mjs';
  await mkdir(join(installationRoot, 'scripts/verification'), { recursive: true });
  await writeFile(join(installationRoot, script), `import { cp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const source = ${JSON.stringify(source)};
const config = JSON.parse(await readFile(join(source, 'server/wrangler.json'), 'utf8'));
if (!(await stat(resolve(source, 'server', config.main))).isFile()) throw Error('The shared candidate Worker is missing.');
if (!(await stat(resolve(source, 'server', config.assets.directory))).isDirectory()) throw Error('The shared candidate browser assets are missing.');
const target = resolve('dist');
if (source === target) throw Error('A native journey must own its disposable build output.');
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log('Reused the candidate production build for this installation.');
`);
  const packagePath = join(installationRoot, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.scripts['build:app'] = `node ${script}`;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}
