import { createOperatorAuth, createAuthHandler } from '@runeditrun/rer/modules/operator-auth';
export const secret='test-only-operator-session-secret-aaaaaaaaaaaaaaaa';
export const setupToken='test-only-setup-token-bbbbbbbbbbbbbbbbbbbbbbbbb';
export function authFixture(db,{origin='https://app.example.test',owner='owner@example.test',review}={}) {
 const messages=[];
 const auth=createOperatorAuth({db,config:{origin,local:origin.startsWith('http:'),OWNER_EMAIL:owner,SESSION_SECRET:secret,SETUP_TOKEN:setupToken,MAIL_FROM:'lamp@example.test',linkSeconds:1200,...(review?{review}:{}),branding:{productName:'Lamp'}},clientIp:()=> 'test-network-edge',mailSender:{async send(message){messages.push(message);return {status:'accepted',provider:'test-network-edge',providerMessageId:null};}}});
 const handle=createAuthHandler(auth);
 const request=(path,{method='GET',body,cookie}={})=>new Request(origin+path,{method,headers:{Host:new URL(origin).host,Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 async function signIn(email=owner) {
  const before=messages.length;await auth.requestMagicLink(request('/auth/magic-link',{method:'POST'}),{email});
  if(messages.length===before)throw Error('No link delivered');
  const token=new URL(messages.at(-1).text.match(/https?:\/\/[^\s]+/)[0]).searchParams.get('token');
  const confirmed=await handle(request('/auth/confirm',{method:'POST',body:{token}}));
  if(confirmed.status!==303)throw Error('Confirmation failed');
  return confirmed.headers.get('set-cookie').split(';')[0];
 }
 return {auth,handle,request,signIn,messages,origin};
}
