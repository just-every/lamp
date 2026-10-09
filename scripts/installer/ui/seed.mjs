export const product = {name:'Lamp',slugPrefix:'lamp'};
export const branding = {...product,accent:'#163c60'};
export const features = {hosting:false,email:false,github:false,artwork:false};
const text=max=>value=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export const fields = {
 target:{label:'Installation',options:[['local','Run on this computer'],['independent','Finish an independent RER deployment']],valid:value=>['local','independent'].includes(value)},
 appOrigin:{label:'Operator application address',type:'url',help:'The operator address assigned by your independent RER installation. The status page has its own address.',optional:true,valid:value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password;}catch{return false;}}},
 ownerEmail:{label:'Your operator email',type:'email',valid:value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)},
 displayName:{label:'Your name',valid:text(120)},
 pageName:{label:'Status page name',valid:text(120)},
 tagline:{label:'Page description',valid:text(280)},
 timezone:{label:'Page timezone',help:'For example, Australia/Brisbane or UTC.',valid:value=>{try{return Boolean(value)&&Boolean(new Intl.DateTimeFormat('en',{timeZone:value}));}catch{return false;}}},
 mailProvider:{label:'Mail provider',options:[['resend','Resend'],['sendgrid','SendGrid']],valid:value=>['resend','sendgrid'].includes(value)},
 mailFrom:{label:'Verified sender address',type:'email',help:'Configure sender DNS with your selected provider before installing.',valid:value=>typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)},
 mailApiKey:{label:'Mail provider API key',type:'password',optional:true,help:'Used only by the local Worker. Never sent to RER or stored in browser drafts.',valid:text(1_000)},
 bootstrapSecret:{label:'Independent installation setup secret',type:'password',optional:true,help:'The LAMP_BOOTSTRAP_SECRET securely provided for your independent installation.',valid:value=>typeof value==='string'&&value.length>=32&&value.length<=400},
};
export const safeKeys=Object.keys(fields).filter(key=>fields[key].type!=='password');
export const secretScopes={mailApiKey:['mailProvider','mailFrom','ownerEmail','target'],bootstrapSecret:['appOrigin','ownerEmail','target']};
export const requiredKeys=draft=>['target','ownerEmail','displayName','pageName','tagline','timezone','mailProvider','mailFrom',...(draft.target==='independent'?['appOrigin','bootstrapSecret']:['mailApiKey'])];
export const setupGroups=[{id:'owner',title:'Your status page',keys:['ownerEmail','displayName','pageName','tagline','timezone']},{id:'installation',title:'Where Lamp runs',keys:['target','appOrigin','bootstrapSecret']},{id:'mail',title:'Sign-in and subscriber mail',keys:['mailProvider','mailFrom','mailApiKey']}];
export const initialValues=()=>({target:'local',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,mailProvider:'resend'});
export const readySummary=draft=>draft.target==='local'?`${draft.pageName} will build and run on this computer. Your provider sends real sign-in and subscriber email.`:`Initialize ${draft.pageName} at your independent operator address. Provider secrets must already be configured there.`;
