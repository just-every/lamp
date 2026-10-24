const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const selector=/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/;

export function mailConfiguration(config:Record<string,unknown>){
 const required=(name:string,pattern?:RegExp)=>{
  const value=config[name];
  if(typeof value!=='string'||!value.trim()||(pattern&&!pattern.test(value.trim())))throw Error(`Invalid or missing ${name}`);
  return value.trim();
 };
 const provider=required('MAIL_PROVIDER',/^(rer|resend|sendgrid|mailgun|ses|postmark)$/);
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
 const secondary=config.MAIL_SECONDARY_PROVIDER;
 if(secondary!==undefined&&secondary!==''){
  if(typeof secondary!=='string'||!['resend','sendgrid','mailgun','ses','postmark'].includes(secondary)||secondary===provider||provider==='rer')throw Error('MAIL_SECONDARY_PROVIDER must name a different direct provider');
  publicVariables.MAIL_SECONDARY_PROVIDER=secondary;
 }
 if(config.MAILGUN_REGION){publicVariables.MAILGUN_REGION=required('MAILGUN_REGION',/^(us|eu)$/);}
 if([provider,secondary].includes('ses')){
  publicVariables.SES_REGION=required('SES_REGION',/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/);
  publicVariables.SES_CONFIGURATION_SET=required('SES_CONFIGURATION_SET',/^[A-Za-z0-9_-]{1,64}$/);
  publicVariables.SES_EVENT_TOPIC_ARN=required('SES_EVENT_TOPIC_ARN',/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]+$/);
 }
 const webhookSecrets=[provider,secondary].includes('mailgun')?['MAILGUN_WEBHOOK_SIGNING_KEY']:[];
 if([provider,secondary].includes('postmark'))webhookSecrets.push('POSTMARK_WEBHOOK_SECRET');
 if([provider,secondary].includes('resend'))webhookSecrets.push('RESEND_WEBHOOK_SECRET');
 return {provider,from,dkimSelector,publicVariables,secondary,webhookSecrets,secretName:provider==='rer'?'MAIL_API_KEY':'MAIL_PROVIDER_API_KEY'};
}
