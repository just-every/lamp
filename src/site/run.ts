import { checkRunData, type RunData } from '../base/run-site';

// Every string and command of the run site's /run page (Base's runPageHtml). The clone names its folder so step 2's
// `cd lamp` is the folder it makes.
export const run: RunData = checkRunData({
  name: 'Lamp',
  repository: 'https://github.com/just-every/run-lamp',
  clone: 'git clone https://github.com/just-every/run-lamp.git lamp',
  folder: 'lamp',
  requirements: 'Needs Node 22 or later and pnpm 10.12.4, on macOS, Linux or Windows with WSL2.',
  licence: 'MIT',
  docs: true,
  hosted: [],
});
