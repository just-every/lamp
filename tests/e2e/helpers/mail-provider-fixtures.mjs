import assert from 'node:assert/strict';
import { createHash, createHmac, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sesCredentials={accessKeyId:'synthetic-lamp-access-1',secretAccessKey:'synthetic-lamp-secret-1',sessionToken:'synthetic-lamp-session-1'};
export const sesTopic='arn:aws:sns:us-east-1:000000000000:synthetic-lamp-events-1';
export const sesCertificateUrl='https://sns.us-east-1.amazonaws.com/SimpleNotificationService-synthetic-lamp-1.pem';
export const postmarkSecret='synthetic-lamp-postmark-events-secret-1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();

export async function sesSigningFixture(){
  const directory=await mkdtemp(join(tmpdir(),'synthetic-lamp-sns-'));
  try{
    const key=join(directory,'key.pem'),certificate=join(directory,'certificate.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',certificate,'-days','1','-subj','/CN=synthetic-lamp-1'],{stdio:'ignore'});
    return {key:await readFile(key,'utf8'),certificate:await readFile(certificate,'utf8'),close:()=>rm(directory,{recursive:true,force:true})};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}

export function verifySesRequest(request,raw){
  const authorization=request.headers.get('authorization');
  const match=/^AWS4-HMAC-SHA256 Credential=([^/]+)\/([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]{64})$/.exec(authorization??'');
  assert.ok(match,'SES requests use SigV4');
  assert.equal(match[1],sesCredentials.accessKeyId);
  assert.equal(request.headers.get('x-amz-security-token'),sesCredentials.sessionToken);
  const url=new URL(request.url),names=match[3].split(';');
  const canonical=[request.method,url.pathname,url.search.slice(1),names.map(name=>`${name}:${name==='host'?url.host:request.headers.get(name).trim()}\n`).join(''),match[3],hash(raw)].join('\n');
  const date=request.headers.get('x-amz-date'),[day,region,service,ending]=match[2].split('/');
  assert.equal(service,'ses');assert.equal(ending,'aws4_request');
  const signingKey=hmac(hmac(hmac(hmac('AWS4'+sesCredentials.secretAccessKey,day),region),'ses'),'aws4_request');
  assert.equal(match[4],hmac(signingKey,`AWS4-HMAC-SHA256\n${date}\n${match[2]}\n${hash(canonical)}`).toString('hex'));
}

export function normalizeSesMessage(body){
  assert.equal(body.ConfigurationSetName,'synthetic-lamp-config-1');
  const mime=Buffer.from(body.Content.Raw.Data,'base64').toString('utf8');
  const plain=mime.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/);
  assert.ok(plain,'SES raw MIME has a complete UTF-8 text part');
  return {to:body.Destination.ToAddresses[0],id:body.EmailTags.find(tag=>tag.Name==='lamp_message_id').Value,text:Buffer.from(plain[1].replaceAll('\r\n',''),'base64').toString('utf8'),messageId:mime.match(/(?:^|\r\n)Message-ID: ([^\r\n]+)/)?.[1]};
}

export function snsBounce(id,fixture){
  const event={Type:'Notification',MessageId:'synthetic-lamp-sns-bounce-1',TopicArn:sesTopic,Message:JSON.stringify({eventType:'Bounce',mail:{tags:{lamp_message_id:[id]}},bounce:{bounceType:'Permanent'}}),Timestamp:new Date().toISOString(),SignatureVersion:'2',SigningCertURL:sesCertificateUrl,Signature:''};
  const canonical=['Message','MessageId','Timestamp','TopicArn','Type'].map(name=>`${name}\n${event[name]}\n`).join('');
  event.Signature=sign('RSA-SHA256',Buffer.from(canonical),fixture.key).toString('base64');
  return event;
}
