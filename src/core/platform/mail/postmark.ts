import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
const failure=(message:string,retryable=false,providerMessageId?:string)=>Object.assign(new Error(message),{retryable,...(providerMessageId?{providerMessageId}:{})});

/** Postmark's server API has no send idempotency key. A local send claim stays
 * closed after any unconfirmed submission; tracking is explicitly disabled. */
export class PostmarkMailSender implements MailSender {
  readonly configured:boolean;
  constructor(private readonly configuration:{apiKey?:string;fromAddress?:string},private readonly repository:MailSendRepository){this.configured=Boolean(configuration.apiKey&&configuration.fromAddress);}
  async send(message:MailMessage):Promise<SentMail>{
    if(!this.configured)throw new MailUnavailableError();
    let id:string,body:string,fingerprint:string,claimed:boolean;
    try{
      id=`postmark-${await hash(message.idempotencyKey)}`;
      body=JSON.stringify({From:message.from,To:message.to,Subject:message.subject,TextBody:message.text,...(message.html?{HtmlBody:message.html}:{}),...(message.replyTo?{ReplyTo:message.replyTo}:{}),
        Headers:Object.entries(message.headers).map(([Name,Value])=>({Name,Value})),TrackOpens:false,TrackLinks:'None',Metadata:{lamp_message_id:id}});
      fingerprint=await hash(body);claimed=await this.repository.claim(id,fingerprint,new Date().toISOString());
    }catch(error){throw new MailPreparationError(error);}
    if(!claimed){
      const old=await this.repository.get(id);
      if(!old||old.envelope_hash!==fingerprint)throw failure('Mail idempotency key was reused with a different envelope.');
      if(old.state==='accepted')return {providerMessageId:id};
      if(old.state==='sending'&&Date.now()-Date.parse(old.updated_at)<30_000)throw failure('Postmark request is already in progress.',true);
      throw failure('Postmark acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.',false,id);
    }
    let response:Response;
    try{response=await fetch('https://api.postmarkapp.com/email',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20_000),headers:{'X-Postmark-Server-Token':this.configuration.apiKey!,'Content-Type':'application/json',Accept:'application/json'},body});}
    catch{await this.repository.finish(id,'uncertain');throw failure('Postmark acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.',false,id);}
    if(!response.ok){
      if(response.status===429||response.status>=500){await this.repository.releaseRejected(id);throw Object.assign(failure(`Postmark rejected mail with ${response.status}.`,true),{failoverSafe:true});}
      await this.repository.finish(id,'rejected');throw failure(`Postmark rejected mail with ${response.status}.`);
    }
    let result:unknown;try{result=await response.json();}catch{result=null;}
    if(!result||typeof result!=='object'||!('MessageID'in result)||typeof result.MessageID!=='string'||!result.MessageID||!('ErrorCode'in result)||result.ErrorCode!==0){await this.repository.finish(id,'uncertain');throw failure('Postmark returned no successful receipt; automatic resend is disabled to prevent duplicate mail.',false,id);}
    await this.repository.finish(id,'accepted',result.MessageID);return {providerMessageId:id};
  }
}
