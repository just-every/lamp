import {access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {localInstaller} from '@runeditrun/rer/local-installer';
import {commandAdapter as createCommandAdapter} from '@runeditrun/rer/adapter';
import {localPortability} from '@runeditrun/rer/portability';
import {nativeOwner} from './bootstrap.mjs';
import {localSignIn} from './signin.mjs';
import {lampDeploy} from './deploy.mjs';
import {validateAnswers} from './validation.mjs';
import * as model from './ui/seed.mjs';

const exists=path=>access(path).then(()=>true,()=>false);

// Local state from before the rer CLI lived under deploy/.
// Never adopt, move or delete it silently: name the owner's choice instead.
async function legacyState({root}){
 for(const legacy of ['deploy/.wrangler','deploy/.dev.vars']){
  if(await exists(join(root,legacy)))throw Error(`Earlier local Lamp data is at ${legacy}. Keep it by moving deploy/.wrangler to .wrangler and deploy/.dev.vars to .dev.vars, or remove ${legacy} to start fresh, then run setup again.`);
 }
}

// Development captures mail in Lamp's outbox. Setup and preview execute the
// production artifact and never request mail from a provider.
const environment=(context,extra={})=>({...process.env,...context.env,...context.vars,LAMP_DEV_OUTBOX_MODE:'local',LAMP_DISABLE_INSPECTOR:'true',WRANGLER_SEND_METRICS:'false',X_LOCAL_EXPLORER:'false',RER_DEV_ORIGIN:context.origin,RER_DEV_KEY:context.devKey,RER_DEV_IDENTITY:context.devLogin?'off':'on',...(context.demo ? {RER_DEMO:'1',RER_DEMO_EXPIRES:context.demo.ends,RER_STATE_DIR:context.demo.state} : {}),...extra});
const listen=context=>String(context.runtimePort??(new URL(context.origin).port||80));
// dev:app applies new migrations, serves Vite and opens the page host once so
// notification links know the page origin.
const vite=context=>['node',['scripts/dev.mjs','--port',listen(context)],{env:environment(context)}];
const preview=context=>[process.execPath,[fileURLToPath(new URL(import.meta.resolve('@runeditrun/rer/production-runtime')))],{env:{...environment(context),RER_RUNTIME_PORT:listen(context),RER_RUNTIME_HOST:context.runtimePort?'127.0.0.1':new URL(context.origin).hostname.replace(/^\[|\]$/g,''),RER_ORIGIN_KEY:'LAMP_LOCAL_ORIGIN',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'}}];

export const adapter=localInstaller({
 node:'22.20.0',features:{...model.features,hosting:false},
 guard:legacyState,prepare:async context=>{
  await legacyState(context);
  await validateAnswers(context.input,context.store);
 },
 // Transfers have no setup answers; preserve saved settings and check legacy state.
 prepareData:legacyState,
 secrets:{keepExisting:true,originKey:'LAMP_LOCAL_ORIGIN',values:context=>({LAMP_LOCAL_ORIGIN:context.origin,AUTH_ORIGIN:context.origin,AUTH_LOCAL:'true'})},
 build:['pnpm',['run','build:app']],
 migrate:context=>['node',['scripts/migrate-local.mjs'],{env:environment(context)}],
 start:preview,owner:nativeOwner,signIn:localSignIn,
});

// Base import-kit custody holds source copies and replay authority: resume and
// undo of a move-in stay on the installation that ran it.
const importCustody=['ik_batches','ik_d1_assertions','ik_d1_creation_plans','ik_d1_custody_revisions','ik_d1_custody_states','ik_d1_entries','ik_d1_erased_sources','ik_d1_erased_targets','ik_d1_history','ik_d1_indexed_jobs','ik_d1_native_staging','ik_d1_native_staging_index','ik_d1_native_staging_values','ik_d1_original_chunks','ik_d1_plan_chunks','ik_d1_plan_index','ik_d1_preparation_receipts','ik_d1_publication_fences','ik_d1_reversal_reports','ik_d1_staging','ik_d1_staging_chunks','ik_d1_staging_headers','ik_d1_staging_index','ik_d1_staging_originals','ik_d1_staging_pages','ik_d1_stream_origins','ik_d1_stream_pages','ik_d1_stream_revisions','ik_d1_streams','ik_jobs','ik_original_sets','ik_originals','ik_provenance','ik_sources','ik_stages','ik_targets'];

// Durable Base identity and consumed-claim state must travel with Lamp's product
// attribution. Base excludes oa_/oc_ by default; keep only durable authority,
// never sessions, links, credentials or pending setup/dependency approvals.
// Base still forces restored provider links to re-link and sign-in to remain off.
const operatorContinuity=['oa_operators','oa_bootstrap','oa_external_identities','oa_invitation_cancellations','oa_domain_rules','oa_auth_settings','oa_auth_audit','oa_identity_providers','oa_logout_events','oc_owner_claims','oc_idp_grants'];

// This is the archive format's product identity, not the repository identifier.
// Keep it stable so exports made before the repository rename still restore.
const transfer=localPortability({database:'DB',buckets:{SNAPSHOTS:'SNAPSHOTS'},policy:{product:'just-every/lamp',buckets:{SNAPSHOTS:{}},replaceableTables:['public_snapshot_work','snapshot_build_control','reference_counters'],includeTables:operatorContinuity,excludeTables:['oa_sessions','oa_tokens','oa_step_up_challenges','oa_credentials','oa_dev_credentials',...importCustody],requiredConfiguration:['SETUP_TOKEN','SESSION_SECRET','SUBSCRIBER_TOKEN_SECRET','WEBHOOK_SIGNING_SECRET']},transient:['development outbox','move-in import custody (resume and undo stay on the original installation)','operator sessions and one-use sign-in links','queued job deliveries in flight','public snapshot cache (rebuilt from D1 and R2)']});

// Declare installed documents explicitly: the Lobby at / does not link to all
// docs. Read the publishing manifest so new pages enter hydration checks too.
const docs=JSON.parse(await readFile(new URL('../../docs/site.json',import.meta.url),'utf8'));

export const commandAdapter=createCommandAdapter(adapter,{
 product:model.product.name,dev:vite,preview,
 publicPages:['/','/docs',...docs.sections.flatMap(section=>section.pages.map(page=>`/docs/${page.slug}`))],
 devIdentity:{entry:'src/server.dev.ts',output:['dist'],emailLinkTest:'tests/e2e/auth-adoption-journey.test.mjs'},verify:['pnpm',['run','verify:app']],deploy:lampDeploy(adapter),deployDeclaration:process.argv.includes('--demo')?'deploy.json':'hosted-check.json',
 portability:transfer,generatedOutputs:['src/routeTree.gen.ts'],
 site:{entry:'src/site/pages.tsx',output:'dist/site',declaration:'deploy-site.json',config:'vite.site.config.ts'},
 setup:{manifestFile:'rer-setup.json'},browserModule:'scripts/installer/ui/seed.mjs',
 input:{names:{email:'SETUP_OPERATOR_EMAIL',name:'OWNER_DISPLAY_NAME'},defaults:async()=>({target:'local',OWNER_DISPLAY_NAME:'Owner',LAMP_PAGE_NAME:'Status',LAMP_PAGE_TAGLINE:'Current service status',LAMP_PAGE_TIMEZONE:'UTC'})},
});
