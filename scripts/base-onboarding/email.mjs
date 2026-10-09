const address=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const providers=['cloudflare','resend','sendgrid'];
export function normalizeEmail(input={},env={}){
 const provider=input.provider||env.EMAIL_PROVIDER||(env.EMAIL_API_KEY?'resend':'later');
 if(![...providers,'later'].includes(provider))throw new Error('Choose Cloudflare Email Sending, Resend, SendGrid, or set up email later.');
 if(provider==='later')return {provider};
 const configuredProvider=env.EMAIL_PROVIDER||(env.EMAIL_API_KEY?'resend':'later');
 const configuredAccount=String(env.EMAIL_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 const from=String(input.from||env.EMAIL_FROM||'').trim(),accountId=String(input.accountId||env.EMAIL_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||'').trim(),apiKey=String(input.apiKey||(provider===configuredProvider&&(provider!=='cloudflare'||accountId===configuredAccount)?env.EMAIL_API_KEY:'')||'').trim();
 if(!address.test(from))throw new Error('Enter a sender email address on your sending domain.');
 if(!apiKey)throw new Error('Add an email sending API token.');
 if(provider==='cloudflare'&&!/^[a-f0-9]{32}$/i.test(accountId))throw new Error('Choose the Cloudflare account that owns the sending domain.');
 return {provider,from,accountId:provider==='cloudflare'?accountId:'',apiKey};
}
export function emailEnvironment(config){
 if(config.provider==='later')return {};
 return {EMAIL_PROVIDER:config.provider,EMAIL_FROM:config.from,EMAIL_API_KEY:config.apiKey,...(config.provider==='cloudflare'?{EMAIL_ACCOUNT_ID:config.accountId}:{})};
}
export function emailMetadata(env={}){
 const provider=env.EMAIL_PROVIDER||(env.EMAIL_API_KEY?'resend':'later'),from=typeof env.EMAIL_FROM==='string'?env.EMAIL_FROM:'',accountId=env.EMAIL_ACCOUNT_ID||env.CLOUDFLARE_ACCOUNT_ID||'';
 const credentialPresent=Boolean(env.EMAIL_API_KEY),configured=credentialPresent&&address.test(from)&&providers.includes(provider)&&(provider!=='cloudflare'||/^[a-f0-9]{32}$/i.test(accountId));
 const requirements=provider==='cloudflare'?['Workers Paid and Email Sending access are required for customer email.','Onboard the sender domain in Cloudflare Email Sending; Cloudflare DNS is required.','Use a dedicated API token with Email Sending: Edit permission.','Email Routing is separate; verified-destination-only sending is not general customer delivery.']:provider==='sendgrid'?['Verify the sender domain in SendGrid before sending.','Use a SendGrid Mail Send API key with mail.send permission.','Configure SendGrid Inbound Parse separately when customer replies must return to the native inbound route.']:provider==='resend'?['Verify your sender domain in Resend.','Use a Resend sending API key.']:['Choose a provider and sender before enabling email.'];
 return {provider,from,domain:address.test(from)?from.split('@')[1]:'',accountId,credentialPresent,configuration:configured?'configured':'missing',domainVerification:'not_checked',outbound:'not_tested',inbound:'not_configured',magicLinks:false,requirements};
}
