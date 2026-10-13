import type { Plugin } from 'vite';
import { buildDocs } from './site.ts';

// The docs, cut from docs/site.json and the repository Markdown it names when Vite loads them, so neither the Worker nor
// the browser ever parses Markdown. Two virtual modules: `virtual:lamp-docs` exports the repository's web address and the
// sections (each page's title and summary), which the navigation needs in the browser too; `virtual:lamp-docs/bodies`
// exports every page's body HTML and contents list, which only the server reads (body.ts), so the page text never ships
// in the browser bundle. A broken link, a missing file or an unaccounted section fails the build, and a Markdown edit
// reloads the docs routes in `vite dev`.

export const docsModuleId = 'virtual:lamp-docs';
export const docsBodiesModuleId = 'virtual:lamp-docs/bodies';
const prefix = '\0';

export function docsSite(): Plugin {
  let root = process.cwd();
  return {
    name: 'lamp:docs',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      if (id === docsModuleId || id === docsBodiesModuleId) return `${prefix}${id}`;
    },
    load(id) {
      if (id !== `${prefix}${docsModuleId}` && id !== `${prefix}${docsBodiesModuleId}`) return;
      const site = buildDocs(root);
      for (const file of site.files) this.addWatchFile(file);
      if (id.endsWith('/bodies')) return `export const bodies = ${JSON.stringify(site.bodies)};\n`;
      return `export const repository = ${JSON.stringify(site.repository)};\nexport const sections = ${JSON.stringify(site.sections)};\n`;
    },
  };
}
