import { unlink } from 'node:fs/promises';
import { privateDirectory, readPrivateFile, writePrivateFile } from './private-files.mjs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
export async function installationReceipt(root,origin,scope){
 await privateDirectory(root,['.seed','installer','private']);
 const path=join(root,'.seed/installer/private',createHash('sha256').update(origin).digest('hex')+'.json');
 let saved;try{saved=JSON.parse(await readPrivateFile(path))}catch(error){if(error.code==='ENOENT')return null;throw error}
 if(saved.origin!==origin||typeof saved.token!=='string'||!saved.token)throw Error('The saved installation receipt is invalid. Preserve it and inspect this installation before continuing.');
 if(scope&&(saved.accountId!==scope.accountId||saved.prefix!==scope.prefix))throw Error('The saved installation receipt does not identify this Cloudflare account and Worker. Preserve it and verify the existing installation before continuing.');
 return saved;
}
export async function installationCredential(root,origin,scope){
 const directory=await privateDirectory(root,['.seed','installer','private']);
 const path=join(directory,createHash('sha256').update(origin).digest('hex')+'.json');
 let saved=await installationReceipt(root,origin,scope);let token=saved?.token,deployed=saved?.deployed===true;
 const record=()=>({...saved,origin,token,...(scope?{accountId:scope.accountId,prefix:scope.prefix}:{})});
 if(!token){token=randomBytes(32).toString('hex');try{await writePrivateFile(path,JSON.stringify(record()),true)}catch(error){if(error.code!=='EEXIST')throw error;saved=await installationReceipt(root,origin,scope);token=saved.token;deployed=saved.deployed===true}}
 return {token,deployed,markDeployed:()=>writePrivateFile(path,JSON.stringify({...record(),deployed:true})),clear:()=>unlink(path)};
}
export async function localSetupToken(root,key){
 try{const text=await readPrivateFile(join(root,'.dev.vars'));const line=text.split(/\r?\n/).find(value=>value.slice(0,value.indexOf('=')).trim()===key);if(!line)return undefined;const value=line.slice(line.indexOf('=')+1).trim();return /^['"].*['"]$/.test(value)?value.slice(1,-1):value}catch(error){if(error.code==='ENOENT')return undefined;throw error}
}
export function stopChild(child){if(!child||!child.pid||child.exitCode!==null||child.signalCode!==null)return;try{process.kill(-child.pid,'SIGTERM')}catch{child.kill('SIGTERM')}}
export async function persistLocalEmail(root,variables){
 const path=join(root,'.dev.vars');let content='';try{content=await readPrivateFile(path)}catch(error){if(error.code!=='ENOENT')throw error}
 const lines=content.split(/\r?\n/).filter(line=>!Object.keys(variables).some(key=>line.startsWith(key+'=')));
 await writePrivateFile(path,lines.join('\n').replace(/\n*$/,'\n')+Object.entries(variables).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n');
}
export async function localEmailBindings(root){
 let text;try{text=await readPrivateFile(join(root,'.dev.vars'))}catch(error){if(error.code==='ENOENT')return {};throw error}
 const allowed=new Set(['EMAIL_PROVIDER','EMAIL_FROM','EMAIL_ACCOUNT_ID','EMAIL_API_KEY']);const values={};
 for(const line of text.split(/\r?\n/)){const index=line.indexOf('=');const key=line.slice(0,index).trim();if(index<0||!allowed.has(key))continue;let value=line.slice(index+1).trim();if(value.startsWith('"')){try{value=JSON.parse(value)}catch{continue}}else if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);values[key]=value}
 return values;
}
