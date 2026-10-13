import {readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {privateDirectory,readPrivateFile,writePrivateFile} from '@runeditrun/rer/private-files';
export async function installationReceipt(root,input){
 const descriptor=JSON.parse(await readFile(join(root,'rer-project.json'),'utf8'));
 const identity={projectId:descriptor.projectId,sourceRepository:descriptor.sourceRepository,checkout:await realpath(root),target:input.target,ownerEmail:input.ownerEmail.toLowerCase(),mailProvider:input.mailProvider,mailFrom:input.mailFrom,...(input.target==='hosted'?{appOrigin:input.appOrigin,pageHost:input.pageHost,accountId:input.accountId,resourcePrefix:input.resourcePrefix,hosting:input.hosting}:{})};
 const directory=await privateDirectory(root,['.seed','installer']);
 const path=join(directory,input.target+'-receipt.json');
 let previous;
 try{previous=JSON.parse(await readPrivateFile(path));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&input.target==='local'&&!Object.hasOwn(previous.identity,'mailProvider')&&!Object.hasOwn(previous.identity,'mailFrom')){
  // Earlier local receipts did not bind sender choices. Recover them from the
  // private runtime configuration, never from new answers or guessed defaults.
  const configuration=JSON.parse(await readPrivateFile(join(directory,'runtime','wrangler.json')));
  previous.identity={...previous.identity,mailProvider:configuration.vars?.MAIL_PROVIDER,mailFrom:configuration.vars?.MAIL_FROM_ADDRESS};
 }
 if(previous&&(Object.keys(previous.identity).length!==Object.keys(identity).length||Object.entries(identity).some(([key,value])=>previous.identity[key]!==value)))throw Error('Saved setup belongs to another owner, mail configuration, target or source. Preserve it and use a separate checkout for a new installation.');
 const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const receipt=previous??{schema:1,identity,sourceRevision,completed:false};
 await writePrivateFile(path,JSON.stringify({...receipt,lastAttemptSourceRevision:sourceRevision}));
 return {complete:async()=>writePrivateFile(path,JSON.stringify({...receipt,lastAttemptSourceRevision:sourceRevision,completed:true}))};
}
