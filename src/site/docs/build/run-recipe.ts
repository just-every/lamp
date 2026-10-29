import { PATHS, startLine } from '../../../base/run-site';
import { run } from '../../run';

// Keep the Markdown readable on GitHub while the built guide uses the chooser's
// current repository, command and requirements. The legacy install page is untouched.
export function runRecipe(markdown: string): string {
  const block = /<!-- rer:recipe -->[\s\S]*?<!-- \/rer:recipe -->/;
  if (!block.test(markdown)) throw new Error('Getting started needs its rer:recipe block.');
  const recipe = [
    '```sh', startLine(run), '```', '', PATHS.self.requirements, '',
    'Already have Node 22 or later?', '', '```sh', run.clone, '```',
  ].join('\n');
  return markdown.replace(block, recipe);
}
