import { checkRunData, type RunData } from '../base/run-site';

// Every string and command of the run site's /run page (Base's runPageHtml). Step 2 runs the clone line through the
// installed rer (`rer dev just-every/run-lamp`), which makes the folder its restart note's `cd run-lamp` names.
export const run: RunData = checkRunData({
  name: 'Lamp',
  repository: 'https://github.com/just-every/run-lamp',
  clone: 'npx -y @runeditrun/rer dev just-every/run-lamp',
  folder: 'run-lamp',
  requirements: 'Runs on macOS, Linux or Windows with WSL2, with git. The installer brings Node when it is missing, and rer brings pnpm.',
  licence: 'MIT',
  docs: true,
  hosted: [],
});
