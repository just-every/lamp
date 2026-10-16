const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const selector=/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;

export function mailConfiguration(config:Record<string,unknown>){
 const required=(name:string,pattern?:RegExp)=>{
  const value=config[name];
  if(typeof value!=='string'||!value.trim()||(pattern&&!pattern.test(value.trim())))throw Error(`Invalid or missing ${name}`);
  return value.trim();
 };
 const provider=required('MAIL_PROVIDER',/^(rer|resend|sendgrid)$/);
 const from=required(provider==='rer'?'MAIL_FROM':'MAIL_FROM_ADDRESS',email);
 const publicVariables:Record<string,string>={MAIL_PROVIDER:provider,MAIL_FROM_ADDRESS:from};
 let dkimSelector:string|undefined;
 if(provider==='rer'){
  const relay=required('MAIL_RELAY_URL');
  let url:URL;
  try{url=new URL(relay);}catch{throw Error('MAIL_RELAY_URL must be an HTTPS URL');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('MAIL_RELAY_URL must be HTTPS without credentials, a query or a fragment');
  publicVariables.MAIL_FROM=from;
  publicVariables.MAIL_RELAY_URL=url.toString();
 }else{
  dkimSelector=required('MAIL_DKIM_SELECTOR',selector);
  publicVariables.MAIL_DKIM_SELECTOR=dkimSelector;
 }
 return {provider,from,dkimSelector,publicVariables,secretName:provider==='rer'?'MAIL_API_KEY':'MAIL_PROVIDER_API_KEY'};
}
