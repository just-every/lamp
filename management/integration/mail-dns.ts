/** Read-only setup parity with Lamp's sender DNS prerequisites. No mail is sent. */
export async function verifyLampMailDns(address:string,selector:string,request:typeof fetch=fetch):Promise<void>{
 const domain=address.slice(address.lastIndexOf('@')+1).toLowerCase();
 async function txt(name:string,seen=new Set<string>()):Promise<string[]>{
  if(seen.has(name)||seen.size>=8)throw Error(`DNS alias loop or excessive chain at ${name}`);
  seen.add(name);
  const url=new URL('https://cloudflare-dns.com/dns-query');url.searchParams.set('name',name);url.searchParams.set('type','TXT');
  const response=await request(url,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`DNS resolver HTTP ${response.status}`);
  const result=await response.json() as {Status?:number;Answer?:{name:string;type:number;data:string}[]};
  if(result.Status!==0)throw Error(`DNS lookup failed (status ${result.Status??'missing'})`);
  const answers=result.Answer??[];
  const records=answers.filter(a=>a.type===16).map(a=>{
   const chunks=a.data.match(/"(?:\\.|[^"\\])*"/g);
   return chunks?chunks.map(chunk=>chunk.slice(1,-1).replace(/\\(.)/g,'$1')).join(''):a.data;
  });
  if(records.length)return records;
  const alias=answers.find(a=>a.type===5&&a.name.replace(/\.$/,'').toLowerCase()===name.toLowerCase());
  if(alias)return txt(alias.data.replace(/\.$/,''),seen);
  throw Error(`No TXT records at ${name}`);
 }
 await Promise.all([
  {name:domain,label:'SPF',valid:(text:string)=>text.includes('v=spf1')},
  {name:`_dmarc.${domain}`,label:'DMARC',valid:(text:string)=>text.includes('v=dmarc1')},
  {name:`${selector}._domainkey.${domain}`,label:'DKIM',valid:(text:string)=>text.includes('v=dkim1')||text.includes('p=')},
 ].map(async({name,label,valid})=>{
  try{if(!valid((await txt(name)).join(' ').toLowerCase()))throw Error(`Required ${label} value missing`);}
  catch(cause){throw Error(`Sender DNS setup needs attention: ${label} at ${name}: ${cause instanceof Error?cause.message:String(cause)}`);}
 }));
}
