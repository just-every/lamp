import { X509Certificate } from 'node:crypto';
import { z } from 'zod';
import type { DeliveriesService } from './service';

const notificationSchema=z.object({Type:z.literal('Notification'),MessageId:z.string().min(1).max(1000),TopicArn:z.string().min(1).max(1000),Message:z.string().max(256*1024),Timestamp:z.string().datetime(),Subject:z.string().max(1000).optional(),SignatureVersion:z.literal('2'),Signature:z.string().max(8192),SigningCertURL:z.string().url()});
const messageSchema=z.object({eventType:z.enum(['Bounce','Complaint','Delivery']).optional(),notificationType:z.enum(['Bounce','Complaint','Delivery']).optional(),mail:z.object({tags:z.object({lamp_message_id:z.array(z.string()).length(1)})}),bounce:z.object({bounceType:z.string()}).optional()}).refine(value=>Boolean(value.eventType||value.notificationType)&&(!value.eventType||!value.notificationType||value.eventType===value.notificationType));

/** SNS signs the exact SES message. Only the configured topic and its regional
 * HTTPS AWS certificate endpoint are trusted; subscription confirmation is an
 * explicit owner action, never a network write from this intake door. */
export async function handleSesEvents(request:Request,topicArn:string|undefined,service:DeliveriesService){
  if(!topicArn)return new Response('Mail delivery webhooks are not configured.',{status:503});
  const raw=await request.text();if(new TextEncoder().encode(raw).length>512*1024)return new Response('Mail provider event is too large.',{status:413});
  let value:unknown;try{value=JSON.parse(raw);}catch{return new Response('Malformed mail provider event.',{status:400});}
  const parsed=notificationSchema.safeParse(value);
  if(!parsed.success)return new Response('Malformed or unsupported SNS notification.',{status:400});
  const event=parsed.data,region=/^arn:aws:sns:([a-z]{2}(?:-gov)?-[a-z]+-\d):\d{12}:[A-Za-z0-9_-]+$/.exec(topicArn)?.[1];
  let verified=false;
  try{
    const url=new URL(event.SigningCertURL);
    if(!region||event.TopicArn!==topicArn||url.protocol!=='https:'||url.hostname!==`sns.${region}.amazonaws.com`||url.port||url.username||url.password||url.search||url.hash||!/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname)||Date.parse(event.Timestamp)>Date.now()+5*60_000)throw new Error();
    const response=await fetch(url.href,{redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok||Number(response.headers.get('content-length')??0)>32*1024)throw new Error();
    const pem=await response.text();if(new TextEncoder().encode(pem).length>32*1024)throw new Error();
    const certificate=new X509Certificate(pem);
    if(Date.now()<Date.parse(certificate.validFrom)||Date.now()>Date.parse(certificate.validTo))throw new Error();
    const key=await crypto.subtle.importKey('spki',certificate.publicKey.export({format:'der',type:'spki'}),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const names=['Message','MessageId',...(event.Subject===undefined?[]:['Subject']),'Timestamp','TopicArn','Type'] as const;
    const canonical=names.map(name=>`${name}\n${event[name as keyof typeof event]}\n`).join('');
    verified=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,Uint8Array.from(atob(event.Signature),character=>character.charCodeAt(0)),new TextEncoder().encode(canonical));
  }catch{verified=false;}
  if(!verified)return new Response('Invalid mail provider signature.',{status:401});
  let message:unknown;try{message=JSON.parse(event.Message);}catch{return new Response('Malformed SES event.',{status:400});}
  const ses=messageSchema.safeParse(message);if(!ses.success)return new Response('Malformed SES event.',{status:400});
  const providerMessageId=ses.data.mail.tags.lamp_message_id[0]!;
  const type=ses.data.eventType??ses.data.notificationType;
  if(providerMessageId.startsWith('ses-'))await service.handleProviderEvent({id:`ses/${event.MessageId}`,providerMessageId,type:type==='Delivery'?'delivered':type==='Complaint'?'complained':'bounced',hardBounce:ses.data.bounce?.bounceType==='Permanent'});
  return new Response(null,{status:200});
}
