import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

// Compile only the exact mail feature source. DEV is a compiler constant, as in
// Vite; no application binding/environment flag is used to impersonate it.
export async function compileMailModules(development) {
  const output = await mkdtemp(resolve('.t073-u5-modules-'));
  const files = ['features/dev-outbox/access', 'features/dev-outbox/repository', 'features/dev-outbox/routes', 'platform/mail/development', 'platform/mail/sender'];
  try {
    for (const name of files) {
      const source = await readFile(`src/core/${name}.ts`, 'utf8');
      const compiled = stripTypeScriptTypes(source.replaceAll('import.meta.env', JSON.stringify({ DEV: development })), { mode: 'strip' }).replace(/from (["'])(\.[^"']+)\1/g, (_match, quote, specifier) => `from ${quote}${specifier}.mjs${quote}`);
      const file = join(output, `${name}.mjs`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, compiled);
    }
    return {
      access: await import(pathToFileURL(join(output, 'features/dev-outbox/access.mjs')).href),
      routes: await import(pathToFileURL(join(output, 'features/dev-outbox/routes.mjs')).href),
      repository: await import(pathToFileURL(join(output, 'features/dev-outbox/repository.mjs')).href),
      mail: await import(pathToFileURL(join(output, 'platform/mail/development.mjs')).href),
      close: () => rm(output, { recursive: true, force: true }),
    };
  } catch (error) { await rm(output, { recursive: true, force: true }); throw error; }
}
