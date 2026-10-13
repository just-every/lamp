import {deploymentConfig} from '../ops-config.mjs';
import {installationFailure} from '@runeditrun/rer/failures';
import {installationReceipt} from './receipt.mjs';
import {nativeSecrets} from './secrets.mjs';

// Base owns the single local/remote target and the Cloudflare connection fields.
// Optional application fields remain in the canonical manifest so local trials
// need no provider; native hosting checks them before provisioning or deployment.
export async function hostLamp({root,input,store,signal}) {
 const credentials={
  CLOUDFLARE_API_TOKEN:input.apiToken,
  MAIL_PROVIDER_API_KEY:input.MAIL_PROVIDER_API_KEY,
 };
 store.addSecrets(credentials);
 const missing=['LAMP_PAGE_HOST','LAMP_HOSTING','LAMP_ACCENT_COLOR','MAIL_PROVIDER','MAIL_FROM_ADDRESS','MAIL_DKIM_SELECTOR','MAIL_PROVIDER_API_KEY'].filter(key=>typeof input[key]!=='string'||!input[key].trim());
 if(missing.length){
  await store.step(`Before Online hosting, open Edit for Online page settings and Online mail settings, then provide: ${missing.join(', ')}.`);
  throw installationFailure('command_failed',{step:'deploy'});
 }
 let config,env;
 try {
  if(input.target!=='remote'||!/^[a-f0-9]{32}$/i.test(input.accountId??'')||typeof input.apiToken!=='string'||!input.apiToken.trim()||/[\r\n\0]/.test(input.apiToken))throw Error();
  if(!/^[a-z][a-z0-9-]{2,39}$/.test(input.prefix??'')||!['custom-domain','workers-dev'].includes(input.LAMP_HOSTING))throw Error();
  const origin=new URL(input.appOrigin);
  if(origin.protocol!=='https:'||origin.origin!==input.appOrigin||origin.username||origin.password||origin.port)throw Error();
  env={...process.env,...credentials,
   CLOUDFLARE_ACCOUNT_ID:input.accountId,
   LAMP_APP_HOST:origin.hostname,LAMP_PAGE_HOST:input.LAMP_PAGE_HOST,
   LAMP_HOSTING:input.LAMP_HOSTING,LAMP_RESOURCE_PREFIX:input.prefix,
   SETUP_OPERATOR_EMAIL:input.SETUP_OPERATOR_EMAIL,OWNER_DISPLAY_NAME:input.OWNER_DISPLAY_NAME,
   LAMP_PAGE_NAME:input.LAMP_PAGE_NAME,LAMP_PAGE_TAGLINE:input.LAMP_PAGE_TAGLINE,
   LAMP_PAGE_TIMEZONE:input.LAMP_PAGE_TIMEZONE,LAMP_ACCENT_COLOR:input.LAMP_ACCENT_COLOR,
   MAIL_PROVIDER:input.MAIL_PROVIDER,MAIL_FROM_ADDRESS:input.MAIL_FROM_ADDRESS,
   MAIL_DKIM_SELECTOR:input.MAIL_DKIM_SELECTOR,
  };
 }catch{
  await store.step('In Hosting & connections, supply a Cloudflare account and API token, resource name and exact HTTPS operator address without a path or port. Select an Online hosting mode in Online page settings. See OPERATIONS.md.');
  throw installationFailure('command_failed',{step:'deploy'});
 }
 try {
  const secrets=await nativeSecrets(root,store,'hosting');
  Object.assign(env,secrets);
  try{config=deploymentConfig(env);}catch(error){
   const fields=['LAMP_PAGE_HOST','LAMP_APP_HOST','LAMP_HOSTING','LAMP_RESOURCE_PREFIX','SETUP_OPERATOR_EMAIL','OWNER_DISPLAY_NAME','LAMP_PAGE_NAME','LAMP_PAGE_TAGLINE','LAMP_PAGE_TIMEZONE','LAMP_ACCENT_COLOR','MAIL_PROVIDER','MAIL_FROM_ADDRESS','MAIL_DKIM_SELECTOR','MAIL_PROVIDER_API_KEY'];
   const field=fields.find(name=>error.message.startsWith(name));
   await store.step(field?`Correct ${field} in Online settings before deploying; see its requirements in OPERATIONS.md.`:'Correct the distinct public and operator hostnames for the selected hosting mode; see OPERATIONS.md.');
   throw installationFailure('command_failed',{step:'deploy'});
  }
  const receipt=await installationReceipt(root,{
   target:'hosted',ownerEmail:config.setupOperatorEmail,mailProvider:config.mailProvider,
   mailFrom:config.mailFromAddress,appOrigin:input.appOrigin,pageHost:config.pageHost,
   accountId:config.accountId,resourcePrefix:config.resourcePrefix,hosting:config.hosting,
  });
  await store.run('Installing locked Lamp dependencies','pnpm',['install','--frozen-lockfile'],{cwd:root,signal});
  // The native deploy command owns input validation, setup/provisioning, migration,
  // build, secret upload and both live health checks. No auth path is replaced.
  await store.run('Deploying Lamp to your Cloudflare account',process.execPath,['scripts/deploy.mjs'],{cwd:root,signal,env});
  await receipt.complete();
  store.state.hostedUrl=input.appOrigin;
  store.state.appUrl=new URL('/signin',input.appOrigin).href;
  await store.step('Lamp is deployed; use ordinary email sign-in at its operator address');
 }catch(error){
  await store.stopCommands(signal);
  throw installationFailure('command_failed',{step:'deploy',diagnostic:error});
 }
}
