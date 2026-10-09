import {verifyLampMailDns} from './mail-dns';
import type {ResourcePlan,RevisionInput} from './contract';
const allowed=['MAIL_FROM_ADDRESS','MAIL_PROVIDER','MAIL_DKIM_SELECTOR','SENDGRID_WEBHOOK_PUBLIC_KEY','AI_PROVIDER_URL','AI_PROVIDER_MODEL'];
export async function revisePlan(plan:ResourcePlan,input:RevisionInput,request:typeof fetch=fetch){
 for(const [name,value]of Object.entries(input.publicVariables??{})){
  if(!allowed.includes(name)&&value!==plan.publicVariables[name])throw Error(`Cannot edit initial or assigned setting ${name}`);
  if(typeof value!=='string'||value.length>16384)throw Error('Invalid runtime value');
 }
 for(const name of allowed){const value=input.publicVariables?.[name];if(value===undefined)continue;if(value)plan.publicVariables[name]=value;else delete plan.publicVariables[name];}
 const v=plan.publicVariables;
 if(!['resend','sendgrid'].includes(v.MAIL_PROVIDER))throw Error('Choose Resend or SendGrid');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.MAIL_FROM_ADDRESS??''))throw Error('Sender email is required');
 if(!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(v.MAIL_DKIM_SELECTOR??''))throw Error('Sender DKIM selector is required');
 plan.secretNames=plan.secretNames.filter(name=>!['RESEND_WEBHOOK_SECRET','AI_PROVIDER_API_KEY'].includes(name));
 for(const name of ['MAIL_PROVIDER_API_KEY','SUBSCRIBER_TOKEN_SECRET','WEBHOOK_SIGNING_SECRET',...(v.MAIL_PROVIDER==='resend'?['RESEND_WEBHOOK_SECRET']:[]),...(v.AI_PROVIDER_URL?['AI_PROVIDER_API_KEY']:[])])if(!plan.secretNames.includes(name))plan.secretNames.push(name);
 await verifyLampMailDns(v.MAIL_FROM_ADDRESS,v.MAIL_DKIM_SELECTOR,request);
}
