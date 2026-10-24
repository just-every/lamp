import {verifyLampMailDns} from './mail-dns';
import {mailConfiguration} from './mail-config';
import type {ResourcePlan,RevisionInput} from './contract';
const allowed=['MAIL_FROM','MAIL_RELAY_URL','MAIL_FROM_ADDRESS','MAIL_PROVIDER','MAIL_DKIM_SELECTOR','MAIL_SECONDARY_PROVIDER','MAILGUN_REGION','SES_REGION','SES_CONFIGURATION_SET','SES_EVENT_TOPIC_ARN','SENDGRID_WEBHOOK_PUBLIC_KEY','AI_PROVIDER_URL','AI_PROVIDER_MODEL'];
export async function revisePlan(plan:ResourcePlan,input:RevisionInput,request:typeof fetch=fetch){
 for(const [name,value]of Object.entries(input.publicVariables??{})){
  if(!allowed.includes(name)&&value!==plan.publicVariables[name])throw Error(`Cannot edit initial or assigned setting ${name}`);
  if(typeof value!=='string'||value.length>16384)throw Error('Invalid runtime value');
 }
 for(const name of allowed){const value=input.publicVariables?.[name];if(value===undefined)continue;if(value)plan.publicVariables[name]=value;else delete plan.publicVariables[name];}
 const v=plan.publicVariables;
 const mail=mailConfiguration(v);
 for(const key of ['MAIL_FROM','MAIL_RELAY_URL','MAIL_DKIM_SELECTOR'])delete v[key];
 Object.assign(v,mail.publicVariables);
 plan.secretNames=plan.secretNames.filter(name=>!['MAIL_API_KEY','MAIL_PROVIDER_API_KEY','MAIL_SECONDARY_API_KEY','MAILGUN_WEBHOOK_SIGNING_KEY','POSTMARK_WEBHOOK_SECRET','RESEND_WEBHOOK_SECRET','AI_PROVIDER_API_KEY'].includes(name));
 for(const name of [mail.secretName,'SUBSCRIBER_TOKEN_SECRET','WEBHOOK_SIGNING_SECRET',...mail.webhookSecrets,...(mail.secondary?['MAIL_SECONDARY_API_KEY']:[]),...(v.AI_PROVIDER_URL?['AI_PROVIDER_API_KEY']:[])])if(!plan.secretNames.includes(name))plan.secretNames.push(name);
 if(mail.dkimSelector)await verifyLampMailDns(mail.from,mail.dkimSelector,request);
}
