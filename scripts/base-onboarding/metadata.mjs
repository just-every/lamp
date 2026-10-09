import { execFile } from 'node:child_process';
const command=(root,tool,args)=>new Promise(resolve=>execFile(tool,args,{cwd:root,timeout:8000,maxBuffer:10000},(error,stdout)=>resolve(error?null:stdout.trim())));
export async function metadata(root){
 const [name,email,remote,github]=await Promise.all([command(root,'git',['config','user.name']),command(root,'git',['config','user.email']),command(root,'git',['remote','get-url','origin']),command(root,'gh',['api','user','--jq','.login'])]);
 let repository=null;if(remote){const match=remote.match(/github\.com[:/]([^\s?#]+?)(?:\.git)?$/);if(match)repository=match[1]}
 return {name,email,repository,githubAccount:github,cloudflareAccount:process.env.CLOUDFLARE_ACCOUNT_ID||null,cloudflareAuthentication:process.env.CLOUDFLARE_API_TOKEN?'environment-token':'not-checked',nodeWarning:process.versions.node.split('.').map(Number).some(Number.isNaN)?null:(Number(process.versions.node.split('.')[0])===26&&Number(process.versions.node.split('.')[1])<8?'This checkout recommends Node 26.8.1 or later.':null)};
}
