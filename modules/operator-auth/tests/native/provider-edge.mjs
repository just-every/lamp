// Fake dependency provider only at the network edge; signatures, client proof,
// durable one-use codes and the app's public linking protocol remain real.
import { parseIdToken, verifySignature } from '../../identity/oidc/jwt.mjs';
import { openDependencyKey } from '../../../dependencies/sealing.mjs';
import { publicKey } from '../../../dependencies/crypto.mjs';
export function linkEdge(db,issuer,clientId,now,config) {
  const get=async key=>{const row=await db.prepare('SELECT value FROM fixture_state WHERE key=?').bind(key).first();return row?JSON.parse(row.value):null;};
  const put=(key,value)=>db.prepare('INSERT INTO fixture_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
  const gateKey='link-gate:'+issuer;
  async function waitFor(predicate) {
    const until=Date.now()+5000;
    while(!predicate(await get(gateKey))) {
      if(Date.now()>until)throw new Error('Timed out waiting for the test provider gate');
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  }
  return {
    pause() {return put(gateKey,{paused:true,reached:false});},
    ready() {return waitFor(gate=>gate?.reached);},
    release() {return put(gateKey,{paused:false,reached:true});},
    async code() {
      const key=await db.prepare("SELECT private_key FROM rer_dependency_keys WHERE interface='oidc-provider@1'").first();
      const sector=await db.prepare('SELECT sector_id FROM rer_dependency_installation').first();
      const code=crypto.randomUUID();await put('link:'+code,{key:publicKey((await openDependencyKey(config,'oidc-provider@1',key.private_key)).key),sector:sector.sector_id});return code;
    },
    async fetch(uri,init={}) {
      if(uri===issuer+'/.well-known/rer-provider')return Response.json({issuer,interface:'oidc-provider@1',version:1,initiate:issuer+'/link',redeem:issuer+'/redeem',deregister:issuer+'/remove'});
      if(uri===issuer+'/remove')return new Response(null,{status:204});
      if(uri!==issuer+'/redeem')return null;
      if((await get(gateKey))?.paused){await put(gateKey,{paused:true,reached:true});await waitFor(gate=>!gate?.paused);}
      try {
        const input=JSON.parse(init.body),grant=await get('link:'+input.code);
        if(!grant||grant.used)throw Error();
        const parsed=parseIdToken(input.client_assertion,{algorithms:['ES256']});await verifySignature(parsed,{keys:[grant.key]});
        const c=parsed.claims;
        if(c.iss!==input.origin||c.sub!==input.origin||c.aud!==uri||c.code!==input.code||c.callback!==input.callback||c.sector_id!==grant.sector||c.exp<=now()/1000)throw Error();
        await put('link:'+input.code,{...grant,used:true});
        return Response.json({issuer,interface:'oidc-provider@1',origin:input.origin,callback:input.callback,sector_id:grant.sector,client_id:clientId,continuity:'provider-owner'});
      }catch{return Response.json({error:'invalid_link_proof'},{status:403});}
    },
  };
}
