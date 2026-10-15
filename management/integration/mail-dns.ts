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
 const tags=(record:string)=>new Map(record.split(';').filter(part=>part.includes('=')).map(part=>{const index=part.indexOf('=');return [part.slice(0,index).trim().toLowerCase(),part.slice(index+1).trim()];}));
 const dkimHost=`${selector}._domainkey.${domain}`,dmarcHost=`_dmarc.${domain}`;
 const checks=[
  {name:dkimHost,label:'DKIM',help:`Add or repair the DKIM record at ${dkimHost}: publish your provider's Domain Authentication CNAME target, or its DKIM TXT record with a non-empty p= public key. Set MAIL_DKIM_SELECTOR to that record's selector.`,valid:(records:string[])=>{
   const keys=records.map(tags).filter(record=>record.has('p'));
   return keys.length===1&&(!keys[0].has('v')||keys[0].get('v')!.toUpperCase()==='DKIM1')&&/^[A-Za-z0-9+/]+={0,2}$/.test(keys[0].get('p')!.replace(/\s/g,''));
  }},
  {name:dmarcHost,label:'DMARC',help:`Add or repair the TXT record at ${dmarcHost} with v=DMARC1; p=none (or your chosen quarantine/reject policy).`,valid:(records:string[])=>{
   const policies=records.filter(record=>/^v=DMARC1\s*(;|$)/i.test(record.trim())).map(tags);
   return policies.length===1&&['none','quarantine','reject'].includes(policies[0].get('p')?.toLowerCase()??'');
  }},
 ];
 // SendGrid authenticates the return-path subdomain with SPF. Aligned DKIM
 // satisfies DMARC without requiring SPF at the visible From domain.
 for(const {name,label,help,valid} of checks){
  try{if(!valid(await txt(name)))throw Error(`No usable ${label} record`);}
  catch(cause){throw Error(`Sender DNS setup needs attention: ${label} at ${name}: ${cause instanceof Error?cause.message:String(cause)}. ${help}`);}
 }
}
