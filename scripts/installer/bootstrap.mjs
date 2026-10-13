import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {setupPageSettingsStatement} from '../ops-config.mjs';

// Base claims identity. Lamp initializes only its product settings.
export async function nativeOwner(context){
 const {origin,input,vars,signal,store}=context;
 const status=await fetch(new URL('/setup/status',origin),{signal,redirect:'error'});
 await status.body?.cancel();
 if(status.status===200){await store.step('Existing owner and page preserved');return;}
 if(![409,503].includes(status.status))throw context.fail('setup');
 if(status.status===409){
  const claimed=await fetch(new URL('/auth/bootstrap',origin),{method:'POST',signal,redirect:'manual',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:vars.SETUP_TOKEN,displayName:input.OWNER_DISPLAY_NAME,returnTo:'/setup'})});
  await claimed.body?.cancel();if(claimed.status!==303)throw context.fail('setup');
 }
 const bindings={...JSON.parse(await readFile(join(context.root,'dist/server/wrangler.json'),'utf8')).vars,...vars};
 const config={pageName:input.LAMP_PAGE_NAME,pageTagline:input.LAMP_PAGE_TAGLINE,pageAccentColor:'#2563eb',pageTimezone:input.LAMP_PAGE_TIMEZONE,pageHost:bindings.LAMP_PAGE_HOST,mailFromAddress:bindings.MAIL_FROM_ADDRESS};
 await context.run('Saving the status page','pnpm',['exec','wrangler','d1','execute','DB','--local','--config',join(context.root,'wrangler.jsonc'),'--persist-to',join(context.root,'.wrangler/state'),'--command',setupPageSettingsStatement(config)],{cwd:context.root,step:'setup'});
 const health=await fetch(new URL('/health',origin),{signal,redirect:'error'});await health.body?.cancel();
 await store.step('Owner and page are ready');
}
