import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execute} from '../scripts/installer/process.mjs';
import {installationFailureMessage} from '../scripts/base-onboarding/failures.mjs';
test('real missing npm and child exit become safe actionable failures; abort remains cancellation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lamp-command-'));const original=process.env.PATH;
 try{
  process.env.PATH=root;
  await assert.rejects(execute(root,'npm',['--private-credential=do-not-render'],undefined,'dependencies'),error=>{const message=installationFailureMessage(error);assert.match(message,/npm was not found.*PATH/);assert.doesNotMatch(message,/do-not-render/);return true;});
  await assert.rejects(execute(root,process.execPath,['-e','process.exit(9)'],undefined,'build'),error=>{assert.match(installationFailureMessage(error),/building the application/);return true;});
  const abort=new AbortController();abort.abort();await assert.rejects(execute(root,process.execPath,['-e','process.exit(0)'],abort.signal,'setup'),{name:'AbortError'});
 }finally{process.env.PATH=original;await rm(root,{recursive:true,force:true});}
});
