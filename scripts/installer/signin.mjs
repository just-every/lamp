import {createHmac} from 'node:crypto';
import {join} from 'node:path';
import {runSignInLink} from '../signin-link.mjs';
import {refusal} from '../signin-link/issue.mjs';
import {sqlDatabase, wranglerDatabase} from '../signin-link/database.mjs';

const database=root=>sqlDatabase(wranglerDatabase({config:join(root,'wrangler.jsonc'),remote:false,persistence:join(root,'.wrangler/state')}));

async function isActiveOperator(root,email){
 return Boolean(await database(root).prepare("SELECT 1 AS active FROM oa_operators WHERE lower(email)=lower(?) AND status='active' LIMIT 1").bind(email).first());
}

// The owner Base treats as the app owner: the setup claim when it is active,
// otherwise the oldest active owner.
async function activeOwner(root){
 const row=await database(root).prepare("SELECT o.email FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.claim_id=o.id WHERE o.role='owner' AND o.status='active' ORDER BY b.claim_id IS NULL,o.created_at,o.id LIMIT 1").first();
 return row?.email;
}

// Lamp's outbox lists its envelopes as JSON; the link is a message there.
async function outboxEnvelopes(context,email){
 const response=await fetch(new URL('/__dev/outbox?format=json',context.origin),{signal:context.signal,headers:context.devKey?{'x-rer-dev-key':context.devKey}:{}});
 if(!response.ok){await response.body?.cancel();throw Error(`The development outbox answered HTTP ${response.status}.`);}
 return (await response.json()).envelopes.filter(envelope=>envelope.message.to.toLowerCase()===email.toLowerCase()).map(envelope=>envelope.id);
}

// Ask the running app for an ordinary sign-in message, as the sign-in page does.
// The local CLI proof keeps this from spending the owner's sign-in rate limit.
async function requestOutboxSignIn(context,email){
 const before=new Set(await outboxEnvelopes(context,email));
 const secret=context.vars.SESSION_SECRET;
 const response=await fetch(new URL('/auth/magic-link',context.origin),{method:'POST',redirect:'manual',signal:context.signal,headers:{Origin:context.origin,'Content-Type':'application/json',...(secret?{'x-rer-local-cli':createHmac('sha256',secret).update('local-cli\0sign-in').digest('hex')}:{})},body:JSON.stringify({email,returnTo:'/app'})});
 await response.body?.cancel();
 if(response.status!==202)throw Error(`The sign-in request answered HTTP ${response.status}.`);
 for(let attempt=0;attempt<50;attempt++){
  const id=(await outboxEnvelopes(context,email)).find(candidate=>!before.has(candidate));
  if(id)return new URL(`/__dev/outbox/${encodeURIComponent(id)}`,context.origin).href;
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw Error('No sign-in message reached the development outbox.');
}

export async function localSignIn(context){
 const {origin,store,root}=context;
 // Ordinary dev entry is handled by Base's declared devIdentity lifecycle.
 const configured=context.signInEmail??context.vars.SETUP_OPERATOR_EMAIL??context.input.SETUP_OPERATOR_EMAIL;
 let owner=await isActiveOperator(root,configured)?configured:null;
 // The setup owner may have removed themselves while another owner remains.
 if(!owner&&!context.signInEmail)owner=await activeOwner(root)??null;
 if(!owner){
  store.report?.(context.signInEmail?refusal:`No sign-in link was made: the setup owner address is no longer an active operator. Open ${origin}/signin and enter your own operator address, or run pnpm signin-link --email <your address>.`);
  throw context.fail('setup');
 }
 const step=owner===configured?'Your one-use sign-in link is ready':`The setup owner can no longer sign in; this one-use sign-in link is for ${owner}, an active owner`;
 // rer dev --login and rer outbox --owner-email point at the development
 // outbox, so the link must be a message there: ask the running app for it.
 if(context.verb==='dev'||context.verb==='outbox'){
  let message;
  try{message=await requestOutboxSignIn(context,owner);}
  catch(error){if(context.signal?.aborted)throw error;store.report?.(error.message);throw context.fail('setup');}
  await store.step(`${step}: it is the newest message in the development outbox`);
  return message;
 }
 // Setup and the browser installer hand the link to the installer page.
 let link='',refused='';
 const result=await runSignInLink(['--email',owner,'--origin',origin,'--config',join(root,'wrangler.jsonc'),'--persist-to',join(root,'.wrangler/state')],{
  settings:context.vars,stdout:{write:value=>{link+=value;}},stderr:{write:value=>{refused+=value;}},
 });
 if(result!==0){if(refused.trim()!==refusal)throw context.fail('setup');store.report?.(refusal);throw context.fail('setup');}
 link=link.trim();
 store.addSecrets?.([link,new URL(link).searchParams.get('token')]);
 await store.step(step);
 return link;
}
