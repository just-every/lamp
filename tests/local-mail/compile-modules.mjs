import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile only the exact mail feature source. DEV is a compiler constant, as in
// Vite; no application binding/environment flag is used to impersonate it.
export async function compileMailModules(development) {
  const output = await mkdtemp(resolve(process.env.TMPDIR ?? '.', '.lamp-u5-modules-'));
  const files = ['features/dev-outbox/access', 'features/dev-outbox/repository', 'features/dev-outbox/routes', 'platform/mail/development', 'platform/mail/sender'];
  try {
    for (const name of files) {
      const source = await readFile(`src/core/${name}.ts`, 'utf8');
      const compiled = stripTypeScriptTypes(source.replace("import schema from '../../../../modules/mail/src/development/schema.sql?raw';", 'const schema = '+JSON.stringify(await readFile('modules/mail/src/development/schema.sql','utf8'))+';').replaceAll('../../../../modules/mail/',pathToFileURL(resolve('modules/mail')).href+'/').replaceAll('import.meta.env', JSON.stringify({ DEV: development })), { mode: 'strip' }).replace(/from (["'])(\.[^"']+)\1/g, (_match, quote, specifier) => `from ${quote}${specifier.endsWith('.mjs') ? specifier : `${specifier}.mjs`}${quote}`);
      const file = join(output, `${name}.mjs`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, compiled);
    }
    await copyFile('src/core/features/dev-outbox/subscriber-origin.mjs', join(output, 'features/dev-outbox/subscriber-origin.mjs'));
    await copyFile('src/core/features/dev-outbox/public-read.mjs', join(output, 'features/dev-outbox/public-read.mjs'));
    await mkdir(join(output, 'features/statuspage-import'), { recursive: true });
    await copyFile('src/core/features/statuspage-import/public-paths.mjs', join(output, 'features/statuspage-import/public-paths.mjs'));
    return {
      access: await import(pathToFileURL(join(output, 'features/dev-outbox/access.mjs')).href),
      routes: await import(pathToFileURL(join(output, 'features/dev-outbox/routes.mjs')).href),
      repository: await import(pathToFileURL(join(output, 'features/dev-outbox/repository.mjs')).href),
      mail: await import(pathToFileURL(join(output, 'platform/mail/development.mjs')).href),
      sender: await import(pathToFileURL(join(output, 'platform/mail/sender.mjs')).href),
      close: () => rm(output, { recursive: true, force: true }),
    };
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
}
