import { checkRunData, type RunData } from '../base/run-site';

// Every string and command of the run site's /run page (Base's runPageHtml). The one line makes the folder step 2's
// `cd run-lamp` names.
export const run: RunData = checkRunData({
  name: 'Lamp',
  repository: 'https://github.com/just-every/run-lamp',
  clone: 'npx -y @runeditrun/rer dev just-every/run-lamp',
  folder: 'run-lamp',
  requirements: 'Needs Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2.',
  licence: 'MIT',
  docs: true,
  hosted: [],
});
