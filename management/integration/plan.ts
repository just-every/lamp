import {verifyLampMailDns} from './mail-dns';
import recipe from './recipe.json';
import type {IntegrationHost,ResourcePlan,Environment} from './contract';
const sqlValue=(value:string)=>value.replaceAll("'","''");
export function createPlanGenerator({sha256,validatePlan}:IntegrationHost){return async function generateLampPlan(installationId:string,environment:'production'|'preview',config:Record<string,unknown>,request:typeof fetch=fetch):Promise<ResourcePlan>{
 const required=(key:string,pattern?:RegExp)=>{const value=config[key];if(typeof value!=='string'||!value.trim()||(pattern&&!pattern.test(value)))throw new Error(`Invalid or missing ${key}`);return value.trim();};
 const host=/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
 const page=required('LAMP_PAGE_HOST',host),app=required('LAMP_APP_HOST',host);if(page===app)throw new Error('Public and operator hosts must differ');
 const name=required('LAMP_PAGE_NAME'),tagline=required('LAMP_PAGE_TAGLINE'),timezone=required('LAMP_PAGE_TIMEZONE'),accent=required('LAMP_ACCENT_COLOR',/^#[0-9a-fA-F]{6}$/),mail=required('MAIL_FROM_ADDRESS',email),owner=required('SETUP_OPERATOR_EMAIL',email),provider=required('MAIL_PROVIDER',/^(resend|sendgrid)$/);new Intl.DateTimeFormat('en',{timeZone:timezone});
 const selector=required('MAIL_DKIM_SELECTOR',/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/);
 const plan=structuredClone(recipe) as ResourcePlan;plan.environment=environment;const prefix=`rer-${(await sha256(installationId)).slice(0,16)}-${environment==='production'?'prod':'preview'}-`;plan.workerName=prefix+'lamp';for(const resource of plan.resources)resource.name=prefix+({DB:'db',SNAPSHOTS:'snapshots',JOBS:'jobs'}[resource.binding]??resource.binding.toLowerCase());
 const values:Record<string,string>={'page.recipe.invalid':page,'mail@recipe.invalid':mail,'RER_RECIPE_NAME':name,'RER_RECIPE_TAGLINE':tagline,'Australia/Brisbane':timezone,'#112233':accent,'owner@recipe.invalid':owner,'RER_RECIPE_OWNER_ID':Array.from(crypto.getRandomValues(new Uint8Array(26)),n=>'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[n%32]).join(''),'RER_RECIPE_TIMESTAMP':new Date().toISOString()};
 const initial=plan.migrations.at(-1)!;initial.sql=initial.sql.replace(/page\.recipe\.invalid|mail@recipe\.invalid|RER_RECIPE_NAME|RER_RECIPE_TAGLINE|Australia\/Brisbane|#112233|owner@recipe\.invalid|RER_RECIPE_OWNER_ID|RER_RECIPE_TIMESTAMP/g,key=>sqlValue(values[key]));initial.sha256=await sha256(initial.sql);
 plan.publicVariables={LAMP_PAGE_HOST:page,LAMP_APP_HOST:app,MAIL_FROM_ADDRESS:mail,MAIL_PROVIDER:provider,MAIL_DKIM_SELECTOR:selector};for(const key of ['SENDGRID_WEBHOOK_PUBLIC_KEY','AI_PROVIDER_URL','AI_PROVIDER_MODEL'])if(config[key])plan.publicVariables[key]=required(key);
 if(config.RER_MANAGEMENT_ORIGIN){const origin=new URL(required('RER_MANAGEMENT_ORIGIN'));if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error('Management origin must be HTTPS');plan.publicVariables.RER_MANAGEMENT_ORIGIN=origin.origin;plan.publicVariables.RER_INSTALLATION_ID=installationId;}
 plan.secretNames=['MAIL_PROVIDER_API_KEY','SUBSCRIBER_TOKEN_SECRET','WEBHOOK_SIGNING_SECRET'];if(provider==='resend')plan.secretNames.push('RESEND_WEBHOOK_SECRET');if(config.AI_PROVIDER_URL)plan.secretNames.push('AI_PROVIDER_API_KEY');
 if(environment==='preview'){if(!Array.isArray(config.controlledProviders)||!config.controlledProviders.length||config.controlledProviders.some(v=>typeof v!=='string'))throw new Error('Controlled preview provider accounts required');plan.schedules=[];plan.queueConsumers=[];plan.previewEffects={schedulesDisabled:true,controlledProviders:config.controlledProviders as string[]};}
 await validatePlan(plan);await verifyLampMailDns(mail,selector,request);return plan;
}

}
