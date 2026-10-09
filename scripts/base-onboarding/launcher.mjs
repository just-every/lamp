import { spawn } from 'node:child_process';
import { readAnswers, readSecrets } from './prefill.mjs';
import { startInstaller } from './server.mjs';
export async function launch(root,seed){
if(process.argv.includes('--help')){console.log(`Launch the standalone ${seed.product} installer before installing app dependencies.\nUsage: node scripts/install.mjs [--port <local-port>] [--no-open] [--agent] [--no-prefill | --resume] [--answers answers.json] [--secrets-stdin]`);process.exit(0)}
let noOpen=false,port=0,answersPath,secrets=false,noPrefill=false,resume=false,agent=false;
const args=process.argv.slice(2);
for(let index=0;index<args.length;index++){
 if(args[index]==='--no-open')noOpen=true;
 else if(args[index]==='--port'&&/^\d+$/.test(args[index+1]||''))port=Number(args[++index]);
 else if(args[index]==='--answers'&&args[index+1])answersPath=args[++index];
 else if(args[index]==='--secrets-stdin')secrets=true;
 else if(args[index]==='--no-prefill')noPrefill=true;
 else if(args[index]==='--agent')agent=true;
 else if(args[index]==='--resume')resume=true;
 else throw Error('Use --help for installer options.');
}
if(noPrefill&&(answersPath||secrets))throw Error('--no-prefill cannot be combined with supplied answers or secrets.');
if(noPrefill&&resume)throw Error('Choose --no-prefill for a new empty session or --resume for saved answers.');
const answers=answersPath?await readAnswers(answersPath,seed.model):undefined;
let secretInput=secrets?await readSecrets(process.stdin):undefined;
const server=await startInstaller(root,{seed,port,answers,secretInput,noPrefill,resume,agent});secretInput=undefined;
console.log(`${seed.product} installer: ${server.origin}\nKeep this terminal open while installing and using the local app.`);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await server.close();process.exit()});

if(!noOpen){const tool=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';const child=spawn(tool,[server.origin],{stdio:'ignore',shell:false});const fallback=()=>console.log('Open the installer URL above in your browser.');child.on('error',fallback);child.on('exit',code=>{if(code)fallback()});}

return server;
}
