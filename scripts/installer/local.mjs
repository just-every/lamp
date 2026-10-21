import {access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {localInstaller} from '@runeditrun/rer/local-installer';
import {readSettings} from '@runeditrun/rer/adapter-settings';
import {writePrivateFile} from '@runeditrun/rer/internal/onboarding/private-files.mjs';
import {commandAdapter as createCommandAdapter} from '@runeditrun/rer/adapter';
import {localPortability} from '@runeditrun/rer/portability';
import {coreMigrationPrefix,pageInitializer} from '../platform-ledger.mjs';
import {nativeOwner} from './bootstrap.mjs';
import {localSignIn} from './signin.mjs';
import {lampDeploy} from './deploy.mjs';
import {validateAnswers} from './validation.mjs';
import {localHosts} from './local-hosts.mjs';
import * as model from './ui/seed.mjs';

const exists=path=>access(path).then(()=>true,()=>false);

// Local state from before the rer CLI lived under deploy/.
// Never adopt, move or delete it silently: name the owner's choice instead.
async function legacyState({root}){
 for(const legacy of ['deploy/.wrangler','deploy/.dev.vars']){
  if(await exists(join(root,legacy)))throw Error(`Earlier local Lamp data is at ${legacy}. Keep it by moving deploy/.wrangler to .wrangler and deploy/.dev.vars to .dev.vars, or remove ${legacy} to start fresh, then run setup again.`);
 }
}

// Development silently suppresses mail. Setup and preview execute the
// production artifact and never request mail from a provider.
const environment=(context,extra={})=>({...process.env,...context.env,...context.vars,LAMP_DISABLE_INSPECTOR:'true',WRANGLER_SEND_METRICS:'false',X_LOCAL_EXPLORER:'false',RER_DEV_ORIGIN:context.origin,RER_DEV_KEY:context.devKey,RER_DEV_IDENTITY:context.devLogin?'off':'on',...(context.demo ? {RER_DEMO:'1',RER_DEMO_EXPIRES:context.demo.ends,RER_STATE_DIR:context.demo.state} : {}),...extra});
const listen=context=>String(context.runtimePort??(new URL(context.origin).port||80));
// dev:app applies new migrations, serves Vite and opens the page host once so
// notification links know the page origin.
const vite=async context=>{
 await localHosts(context);
 return ['node',['scripts/dev.mjs','--port',listen(context)],{env:environment(context)}];
};
const preview=async context=>{
 await localHosts(context);
 return [process.execPath,[fileURLToPath(new URL(import.meta.resolve('@runeditrun/rer/production-runtime')))],{env:{...environment(context),RER_RUNTIME_PORT:listen(context),RER_RUNTIME_HOST:context.runtimePort?'127.0.0.1':new URL(context.origin).hostname.replace(/^\[|\]$/g,''),RER_ORIGIN_KEY:'LAMP_LOCAL_ORIGIN',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'}}];
};

export const adapter=localInstaller({
 node:'22.20.0',features:{...model.features,hosting:false},
 guard:legacyState,prepare:async context=>{
  await legacyState(context);
  await validateAnswers(context.input,context.store);
  // Earlier installs saved a second origin that Base does not move with --port.
  // Keep one saved authority; auth derives its local origin from that binding.
  const saved=await readSettings(context.root,{file:'.dev.vars'});
  if(Object.hasOwn(saved.values,'AUTH_ORIGIN')){
   const text=saved.text.replace(/^[\t ]*(?:export[\t ]+)?AUTH_ORIGIN[\t ]*=[^\r\n]*(?:\r?\n|$)/gm,'');
   const cleaned=parseEnv(text);
   if(Object.hasOwn(cleaned,'AUTH_ORIGIN')||Object.entries(saved.values).some(([key,value])=>key!=='AUTH_ORIGIN'&&cleaned[key]!==value))
    throw Error('Could not remove the legacy AUTH_ORIGIN assignment without changing other settings. Remove that assignment from .dev.vars, then run setup again.');
   await writePrivateFile(saved.path,text);
  }
 },
 // Transfers have no setup answers; preserve saved settings and check legacy state.
 prepareData:legacyState,
 secrets:{keepExisting:true,originKey:'LAMP_LOCAL_ORIGIN',values:context=>({LAMP_LOCAL_ORIGIN:context.origin,AUTH_LOCAL:'true'})},
 build:['pnpm',['run','build:app']],
 migrate:context=>['node',['scripts/migrate-local.mjs'],{env:environment(context)}],
 start:preview,owner:nativeOwner,signIn:localSignIn,
});

// This is the archive format's product identity, not the repository identifier
// (scripts/installer/archive-policy.mjs keeps it stable for earlier exports).
// rer export --target remote runs Lamp's hosted archive tool for the deployed
// install (rer adds --remote --environment production --out FILE).
// A RER Managed destination keeps Platform's ledger: core-<file> by hash, plus the
// per-installation page initializer, which seeds data and has no schema file.
const transfer={hostedExport:['node','scripts/export.mjs'],...localPortability({database:'DB',platformMigrations:{prefix:coreMigrationPrefix,dataOnly:[pageInitializer]},buckets:{SNAPSHOTS:'SNAPSHOTS'},policyModule:new URL('./archive-policy.mjs',import.meta.url),transient:['move-in import custody (resume and undo stay on the original installation)','operator sessions and one-use sign-in links','queued job deliveries in flight','public snapshot cache (rebuilt from D1 and R2)']})};

// Declare installed documents explicitly: the Lobby at / does not link to all
// docs. Read the publishing manifest so new pages enter hydration checks too.
const docs=JSON.parse(await readFile(new URL('../../docs/site.json',import.meta.url),'utf8'));

export const commandAdapter=createCommandAdapter(adapter,{
 product:model.product.name,dev:vite,preview,
 publicPages:['/','/docs',...docs.sections.flatMap(section=>section.pages.map(page=>`/docs/${page.slug}`))],
 devIdentity:{entry:'src/server.dev.ts',output:['dist'],emailLinkTest:'tests/e2e/auth-adoption-journey.test.mjs'},verify:['pnpm',['run','verify:app']],deploy:lampDeploy(adapter),
 portability:transfer,generatedOutputs:['src/routeTree.gen.ts'],
 site:{entry:'src/site/pages.tsx',output:'dist/site',declaration:'deploy-site.json',config:'vite.site.config.ts'},
 setup:{manifestFile:'rer-setup.json'},browserModule:'scripts/installer/ui/seed.mjs',
 input:{names:{email:'SETUP_OPERATOR_EMAIL',name:'OWNER_DISPLAY_NAME'},defaults:async()=>({target:'local',OWNER_DISPLAY_NAME:'Owner',LAMP_PAGE_NAME:'Status',LAMP_PAGE_TAGLINE:'Current service status',LAMP_PAGE_TIMEZONE:'UTC'})},
});

// Read after rer applies --env-file: each provider keeps its actual credential
// mapping for the shared production-auth preflight and hosted-output checks.
Object.defineProperty(commandAdapter, 'deployDeclaration', {
 enumerable: true,
 get: () => process.argv.includes('--demo') ? 'deploy.json'
  : process.env.MAIL_PROVIDER?.trim() === 'rer' ? 'hosted-check-managed.json' : 'hosted-check.json',
});
