import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentConfig} from '../ops-config.mjs';

// Lamp serves two hostnames (the operator app and the public page), and on
// workers.dev that is two Workers. Base deploy-kit deploys one Worker with one
// origin, so `rer deploy` drives Lamp's own Cloudflare pipeline (DIVERGENCE.md).
export function lampDeploy(lifecycle){
 return async({root,options,store,signal,operationToken})=>{
  const environment=options.environment??'production';
  const temporary=await mkdtemp(join(tmpdir(),'lamp-deploy-'));
  const resultFile=join(temporary,'result.json');
  try{
   const args=['run','deploy:cloudflare','--','--environment',environment,'--result-file',resultFile,...(options.dryRun?['--dry-run']:[])];
   // `rer deploy --rotate-secret NAME` hands a fresh value for NAME; the pipeline keeps
   // every secret the Worker holds unless it is named for replacement.
   await store.run(options.dryRun?'Validating the Lamp deployment locally':'Deploying Lamp to Cloudflare','pnpm',args,{cwd:root,signal,env:{...process.env,RER_LOCAL_OPERATION:operationToken,RER_ROTATE_SECRETS:options.rotateSecret??''}});
   if(options.dryRun){store.report('deploy: dry run complete; no deployment occurred and no provider request was made.');return {dryRun:true,deployed:false};}
   const deployed=JSON.parse(await readFile(resultFile,'utf8'));
   const config=deploymentConfig(process.env,environment);
   // Claim in the hook process so rer can observe the real bootstrap response
   // and link dependencies while the installation's setup token is available.
   const claimed=await fetch(new URL('/auth/bootstrap',deployed.origin),{method:'POST',signal,redirect:'manual',headers:{Origin:deployed.origin,'Content-Type':'application/json'},body:JSON.stringify({token:config.setupToken,displayName:config.setupOperatorDisplayName})});
   await claimed.body?.cancel();
   if(![303,409].includes(claimed.status))throw Error('Owner bootstrap failed after deployment. Inspect the auth configuration.');
   return {...deployed,owner:claimed.status===303?'claimed':'kept'};
  }finally{await rm(temporary,{recursive:true,force:true});}
 };
}
