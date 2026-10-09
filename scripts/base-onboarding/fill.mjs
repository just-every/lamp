import { validateAgentActivity } from './activity.mjs';
import { readAnswers, readSecrets } from './prefill.mjs';
export async function fill(seed){
if(process.argv.includes('--help')){console.log('Fill an existing local installer without installing anything.\nnode scripts/installer-fill.mjs --url http://127.0.0.1:PORT [--session SESSION_ID] [--inspect] [--file answers.json] [--secrets-stdin] [--status checking|needs_input|complete --topic workspace|owner|hosting|email|setup]\nAnswers files accept only nonsecret fields. Credentials are optional JSON via stdin only.');process.exit(0)}
const args=process.argv.slice(2);let url,file,status,topic,sessionId,secrets=false,inspect=false;
for(let i=0;i<args.length;i++){if(args[i]==='--url')url=args[++i];else if(args[i]==='--session'){sessionId=args[++i];if(!sessionId||sessionId.startsWith('--'))throw Error('Provide the session ID from the connection prompt.');}else if(args[i]==='--inspect')inspect=true;else if(args[i]==='--file')file=args[++i];else if(args[i]==='--status')status=args[++i];else if(args[i]==='--topic')topic=args[++i];else if(args[i]==='--secrets-stdin')secrets=true;else throw Error('Use --help for supported options.');}
if(status||topic)validateAgentActivity({phase:status,topic});
if(!url||(!file&&!secrets&&!status&&!inspect))throw Error('Provide --url and --inspect, --file, --secrets-stdin or --status with --topic.');
const target=new URL(url);if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!target.port||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Use the exact loopback installer origin printed by its launcher.');
const page=await fetch(target,{redirect:'error'});if(!page.ok)throw Error('The local installer is unavailable.');const html=await page.text();const nonce=html.match(/name="installer-token" content="([a-f0-9]+)"/)?.[1];const cookie=page.headers.get('set-cookie')?.split(';')[0];if(!nonce||!cookie)throw Error('The address is not a compatible local installer.');
const headers={'Content-Type':'application/json','X-Installer-Token':nonce,Cookie:cookie,Origin:target.origin};
async function submit(path,input){const response=await fetch(new URL(path,target),{method:'POST',headers,body:JSON.stringify(input),redirect:'error'});if(!response.ok)throw Error('The installer rejected the supplied fields; no installation was started.');return response.json();}
const response=await fetch(new URL('/api/state',target),{headers,redirect:'error'});if(!response.ok)throw Error('Cannot read installer state.');
const state=await response.json();
if(state.known?.product!==seed.product)throw Error('This installer belongs to another seed.');
if(sessionId&&sessionId!==state.sessionId)throw Error('The installer session changed. Copy a new connection prompt from the open installer.');
let revision=state.lastUpdate.revision;
if(inspect)console.log(JSON.stringify({draft:state.draft,sources:state.sources,phase:state.phase,agent:state.agent},null,2));
if(file)revision=(await submit('/api/prefill',await readAnswers(file,seed.model))).revision;
if(secrets){let input=await readSecrets(process.stdin);await submit('/api/secrets',{revision,secrets:input});input=null;}
if(status)await submit('/api/activity',{phase:status,topic});
if(file||secrets||status)console.log('Setup details or activity supplied. Review the open installer; no installation or provider action was started.');

}
