import { MailPreparationError, MailUnavailableError, type MailMessage, type MailSender, type SentMail } from './sender';
import type { MailSendRepository } from './repository';

const text = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2,'0')).join('');
const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256',text(value)));
async function hmac(key: BufferSource, value: string) {
  return crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']),text(value));
}
function base64(value: string) {
  let bytes='';for(const byte of text(value))bytes+=String.fromCharCode(byte);return btoa(bytes);
}
function reject(message: string, retryable = false, providerMessageId?: string) {
  return Object.assign(new Error(message),{retryable,...(providerMessageId?{providerMessageId}:{})});
}
interface SesCredentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
function credentials(value: string | undefined): SesCredentials | null {
  if(!value)return null;
  let parsed: unknown;try{parsed=JSON.parse(value);}catch{throw new Error('The SES provider key must be JSON containing accessKeyId and secretAccessKey.');}
  if(!parsed||typeof parsed!=='object'||!('accessKeyId' in parsed)||typeof parsed.accessKeyId!=='string'||!parsed.accessKeyId||!('secretAccessKey' in parsed)||typeof parsed.secretAccessKey!=='string'||!parsed.secretAccessKey||('sessionToken' in parsed&&typeof parsed.sessionToken!=='string'))throw new Error('The SES provider key must contain accessKeyId and secretAccessKey, with an optional sessionToken.');
  return parsed as SesCredentials;
}
function mime(message: MailMessage, boundary: string) {
  const headers: Record<string,string> = {From:message.from,To:message.to,Subject:`=?UTF-8?B?${base64(message.subject)}?=`,...(message.replyTo?{'Reply-To':message.replyTo}:{}),...message.headers,'MIME-Version':'1.0'};
  for(const [name,value]of Object.entries(headers))if(!/^[A-Za-z0-9-]+$/.test(name)||/[\r\n]/.test(value))throw new Error('Mail headers must not contain line breaks.');
  const part=(kind:string,body:string)=>`Content-Type: ${kind}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(body).match(/.{1,76}/g)?.join('\r\n')??''}`;
  const body=message.html?`--${boundary}\r\n${part('text/plain',message.text)}\r\n--${boundary}\r\n${part('text/html',message.html)}\r\n--${boundary}--\r\n`:part('text/plain',message.text);
  if(message.html)headers['Content-Type']=`multipart/alternative; boundary="${boundary}"`;
  return `${Object.entries(headers).map(([name,value])=>`${name}: ${value}`).join('\r\n')}\r\n\r\n${body}`;
}

async function sesRequest(configuration: { region: string; credentials: SesCredentials }, method: 'GET'|'POST', path: string, body = '') {
  const { region, credentials } = configuration, host = `email.${region}.amazonaws.com`;
  const timestamp=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=timestamp.slice(0,8),scope=`${day}/${region}/ses/aws4_request`;
  const headers:Record<string,string>={'content-type':'application/json','host':host,'x-amz-date':timestamp,...(credentials.sessionToken?{'x-amz-security-token':credentials.sessionToken}:{})};
  const names=Object.keys(headers).sort(),signedHeaders=names.join(';');
  const canonical=`${method}\n${path}\n\n${names.map(name=>`${name}:${headers[name].trim()}\n`).join('')}\n${signedHeaders}\n${await digest(body)}`;
  const toSign=`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await digest(canonical)}`;
  const dayKey=await hmac(text(`AWS4${credentials.secretAccessKey}`),day),regionKey=await hmac(dayKey,region),serviceKey=await hmac(regionKey,'ses'),signingKey=await hmac(serviceKey,'aws4_request');
  headers.authorization=`AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hex(await hmac(signingKey,toSign))}`;
  delete headers.host;
  return fetch(`https://${host}${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(20_000),headers,...(method==='POST'?{body}:{})});
}
export async function verifySesDomain(configuration: { apiKey: string; region: string }, domain: string) {
  const key=credentials(configuration.apiKey);
  if(!key||!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(configuration.region))throw new Error('SES credentials and region must be configured.');
  const response=await sesRequest({region:configuration.region,credentials:key},'GET',`/v2/email/identities/${encodeURIComponent(domain)}`);
  if(!response.ok)throw new Error('The SES sender check could not read this identity.');
  const result=await response.json() as { VerifiedForSendingStatus?: boolean; DkimAttributes?: { Status?: string } };
  return result.VerifiedForSendingStatus===true&&result.DkimAttributes?.Status==='SUCCESS';
}

/** SES v2 over SigV4. The local claim prevents replay after an ambiguous send;
 * EmailTags give signed SNS receipts the same installation-local identity. */
export class SesMailSender implements MailSender {
  readonly configured: boolean;
  private readonly credentials: SesCredentials | null;
  constructor(private readonly configuration:{apiKey?:string;fromAddress?:string;region?:string;configurationSet?:string;topicArn?:string},private readonly repository:MailSendRepository){
    this.credentials=credentials(configuration.apiKey);
    if(configuration.region&&!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(configuration.region))throw new Error('SES_REGION must be an AWS region.');
    this.configured=Boolean(this.credentials&&configuration.fromAddress&&configuration.region&&configuration.configurationSet&&configuration.topicArn);
  }
  private async checkConfiguration(){
    const path=`/v2/email/configuration-sets/${encodeURIComponent(this.configuration.configurationSet!)}`,configuration={region:this.configuration.region!,credentials:this.credentials!};
    const [vdmResponse,response]=await Promise.all([sesRequest(configuration,'GET',path),sesRequest(configuration,'GET',`${path}/event-destinations`)]);
    if(!vdmResponse.ok||!response.ok)throw new Error('Grant the SES sending key read access to configuration-set VDM settings and event destinations.');
    const vdm=await vdmResponse.json() as {VdmOptions?:{DashboardOptions?:{EngagementMetrics?:string}}};
    if(vdm.VdmOptions?.DashboardOptions?.EngagementMetrics!=='DISABLED')throw new Error('Explicitly disable SES engagement metrics on the configuration set before sending; inherited or unknown tracking is not allowed.');
    const result=await response.json() as {EventDestinations?:{Enabled?:boolean;MatchingEventTypes?:string[];SnsDestination?:{TopicArn?:string}}[]};
    if(!Array.isArray(result.EventDestinations)||result.EventDestinations.some(destination=>typeof destination.Enabled!=='boolean'||!Array.isArray(destination.MatchingEventTypes)||destination.MatchingEventTypes.some(type=>typeof type!=='string')))throw new Error('SES returned invalid event-destination settings.');
    const enabled=result.EventDestinations.filter(destination=>destination.Enabled);
    if(enabled.some(destination=>destination.MatchingEventTypes!.some(type=>type==='OPEN'||type==='CLICK')))throw new Error('Disable open and click tracking in the SES configuration set before sending.');
    const feedback=new Set(enabled.filter(destination=>destination.SnsDestination?.TopicArn===this.configuration.topicArn).flatMap(destination=>destination.MatchingEventTypes!));
    if(!['DELIVERY','BOUNCE','COMPLAINT'].every(type=>feedback.has(type)))throw new Error('Connect SES delivery, bounce and complaint events to the configured SNS topic before sending.');
  }
  async send(message:MailMessage):Promise<SentMail>{
    if(!this.configured||!this.credentials)throw new MailUnavailableError();
    let id:string,body:string,fingerprint:string,claimed:boolean;
    try{
      id=`ses-${await digest(message.idempotencyKey)}`;
      body=JSON.stringify({ConfigurationSetName:this.configuration.configurationSet,FromEmailAddress:message.from,Destination:{ToAddresses:[message.to]},Content:{Raw:{Data:base64(mime(message,id))}},EmailTags:[{Name:'lamp_message_id',Value:id}]});
      fingerprint=await digest(body);
      claimed=await this.repository.claim(id,fingerprint,new Date().toISOString());
    }catch(error){throw new MailPreparationError(error);}
    if(!claimed){
      const old=await this.repository.get(id);
      if(!old||old.envelope_hash!==fingerprint)throw reject('Mail idempotency key was reused with a different envelope.');
      if(old.state==='accepted')return {providerMessageId:id};
      if(old.state==='sending'&&Date.now()-Date.parse(old.updated_at)<30_000)throw reject('SES request is already in progress.',true);
      throw reject('SES acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.',false,id);
    }
    // Reconcile an existing receipt above before reading mutable settings. A
    // new submission checks both tracking mechanisms on every attempt.
    try{await this.checkConfiguration();}
    catch(error){
      const failure=new MailPreparationError(error);if(error instanceof Error)failure.message=error.message;
      try{await this.repository.releaseRejected(id);}finally{throw Object.assign(failure,{retryable:false});}
    }
    let response:Response;
    try{
      response=await sesRequest({region:this.configuration.region!,credentials:this.credentials},'POST','/v2/email/outbound-emails',body);
    }catch{
      await this.repository.finish(id,'uncertain');
      throw reject('SES acceptance is unconfirmed; automatic resend is disabled to prevent duplicate mail.',false,id);
    }
    if(!response.ok){
      if(response.status===429||response.status>=500){await this.repository.releaseRejected(id);throw Object.assign(reject(`SES rejected mail with ${response.status}.`,true),{failoverSafe:true});}
      await this.repository.finish(id,'rejected');throw reject(`SES rejected mail with ${response.status}.`);
    }
    let receipt:unknown;try{receipt=await response.json();}catch{receipt=null;}
    if(!receipt||typeof receipt!=='object'||!('MessageId'in receipt)||typeof receipt.MessageId!=='string'||!receipt.MessageId){await this.repository.finish(id,'uncertain');throw reject('SES returned no receipt; automatic resend is disabled to prevent duplicate mail.',false,id);}
    await this.repository.finish(id,'accepted',receipt.MessageId);return {providerMessageId:id};
  }
}
