import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validCompiledLiveEditSnapshot} from '../src/editor/live-edit-contracts.ts';
const snapshot=JSON.parse(readFileSync(new URL('../src/editor/visual-edits.json',import.meta.url),'utf8'));
if(!validCompiledLiveEditSnapshot(snapshot))throw new Error('Invalid compiled visual-edits.json; refusing visual verification.');
if (process.argv[2] === '--source-only') {
  console.log(`Validated ${snapshot.edits.length} compiled visual edits at revision ${snapshot.revision}.`);
  process.exit(0);
}
for(const command of ['source:check','typecheck','build'])execFileSync('pnpm',[command],{stdio:'inherit'});
execFileSync(process.execPath,['--test','--test-name-pattern=compiled visual edits','tests/e2e/publishing-browser.test.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['--test','--test-name-pattern=compiled visual edits','tests/e2e/publishing-browser.test.mjs'],{stdio:'inherit',env:{...process.env,RER_VISUAL_HEADING_PROBE:'1'}});
console.log(`Visual verification passed for ${snapshot.edits.length} compiled edits at revision ${snapshot.revision}.`);
