import {createOperatorAuth} from '@runeditrun/rer/modules/operator-auth';
import {createUlid} from '../ops-config.mjs';
import {sqlDatabase} from './database.mjs';
export const refusal='A sign-in link could not be created. Check the operator address and installation.';
export async function issueSignInLink({email,origin,execute,sessionSecret,now=Date.now()}) {
 const db=sqlDatabase(execute);let link;
 const auth=createOperatorAuth({db,clock:()=>now,config:{origin,local:new URL(origin).protocol==='http:',OWNER_EMAIL:email,SESSION_SECRET:sessionSecret,MAIL_FROM:'terminal@operator.invalid',linkSeconds:1200,branding:{productName:'Lamp'}},clientIp:()=> 'owner-terminal',
  mailSender:{async send(message){
   const candidate=message.text.match(/https?:\/\/[^\s]+/)?.[0];if(!candidate)throw Error(refusal);
   const timestamp=new Date(now).toISOString();
   await db.prepare("INSERT INTO audit_entries(id,entity_type,entity_id,action,operator_id,payload_json,created_at,updated_at) SELECT ?,'operator',operator_id,'sign-in link created from the command line',operator_id,'{}',?,? FROM oa_tokens WHERE id=?").bind(createUlid(),timestamp,timestamp,message.deliveryId).run();
   link=candidate;return {status:'accepted',provider:'owner-terminal',providerMessageId:null};
  }} });
 await auth.requestMagicLink(new Request(origin+'/auth/magic-link',{method:'POST',headers:{Origin:origin,Host:new URL(origin).host}}),{email});
 if(!link)throw Error(refusal);return link;
}
