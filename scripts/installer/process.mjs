import {spawn} from 'node:child_process';
import {installationFailure} from '../base-onboarding/failures.mjs';
export function stop(child){if(!child||child.exitCode!==null)return;try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
export function commandFailure(error,tool,step,signal){
 signal?.throwIfAborted();
 return error?.code==='ENOENT'?installationFailure('missing_tool',{tool}):installationFailure('command_failed',{step});
}
export async function execute(root,command,args,signal,step='setup'){
 signal?.throwIfAborted();
 await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{cwd:root,stdio:'inherit',shell:false,detached:true});
  const abort=()=>stop(child);signal?.addEventListener('abort',abort,{once:true});
  const fail=error=>{signal?.removeEventListener('abort',abort);try{reject(commandFailure(error,command===process.execPath?'node':command,step,signal));}catch(cancelled){reject(cancelled);}};
  child.once('error',fail);child.once('exit',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)return fail();code===0?resolve():fail();});
 });
}
