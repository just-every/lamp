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

export async function localSignIn(context){
 const {origin,store,root}=context;
 // Base completes the authenticated one-click entry after the app is ready.
 // A demo must never inspect the ordinary installation's owner/state.
 if(context.verb==='dev')return new URL('/app',origin).href;
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
