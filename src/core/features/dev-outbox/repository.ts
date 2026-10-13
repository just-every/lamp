import type { MailMessage } from '../../platform/mail/sender';

export interface CapturedEnvelope {
  id: string;
  disposition: 'captured';
  capturedAt: string;
  envelopeHash?: string;
  message: MailMessage;
}
import { createD1DevelopmentOutbox, sendDevelopment, type DevelopmentCapture } from '../../../../modules/mail/src/development/index.mjs';
import schema from '../../../../modules/mail/src/development/schema.sql?raw';

export async function mailDigest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function projectCapture(row: DevelopmentCapture): CapturedEnvelope {
 return {id:row.id,disposition:'captured',capturedAt:new Date(row.createdAt).toISOString(),message:{from:row.message.from,to:row.message.to[0],subject:row.message.subject,text:row.message.text??'',...(row.message.html?{html:row.message.html}:{}),headers:row.message.headers??{},idempotencyKey:row.message.deliveryId}};
}
/** Native idempotency claims and private local configuration. The Base D1
 * outbox alone owns raw messages, retention, capture identities and rendering. */
export function createDevOutboxRepository(bucket: R2Bucket, db?: D1Database) {
 let initialized: Promise<unknown> | undefined;
 async function outbox() {
  if(!db)throw new Error('Local Base mail storage is missing.');
  initialized??=db.batch(schema.split(';').map(sql=>sql.trim()).filter(Boolean).map(sql=>db.prepare(sql)));
  await initialized;
  return createD1DevelopmentOutbox({db});
 }
 return {
    async base(){return outbox();},
    async get(id:string){const row=await (await outbox()).get(id);return row?projectCapture(row):null;},
    async list(){return {envelopes:(await (await outbox()).list()).map(projectCapture),cursor:null};},
    async capture(message: MailMessage): Promise<CapturedEnvelope> {
      const key='claims/'+await mailDigest(message.idempotencyKey);
      const envelopeHash=await mailDigest(JSON.stringify({...message,headers:Object.fromEntries(Object.entries(message.headers).sort(([a],[b])=>a.localeCompare(b)))}));
      if(await bucket.get('envelopes/'+await mailDigest(message.idempotencyKey)+'.json'))throw new Error('This message was captured by the prior local outbox; automatic recapture is disabled. Retain the existing local storage.');
      const claim={envelopeHash,state:'capturing',captureId:null as string|null};
      if(!await bucket.put(key,JSON.stringify(claim),{onlyIf:{etagDoesNotMatch:'*'}})){
       let previous=await (await bucket.get(key))?.json<typeof claim>();
       for(let attempt=0;previous?.state==='capturing'&&attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,50));previous=await (await bucket.get(key))?.json<typeof claim>();}
       if(!previous||previous.envelopeHash!==envelopeHash)throw Object.assign(new Error('Mail idempotency key was reused with a different envelope.'),{retryable:false});
       if(previous.state!=='captured'||!previous.captureId)throw Object.assign(new Error('Local capture is unconfirmed; automatic recapture is disabled.'),{retryable:false});
       const row=await (await outbox()).get(previous.captureId);
       if(!row)throw new Error('The captured local message has expired; automatic recapture is disabled.');
       return {...projectCapture(row),envelopeHash};
      }
      const storage=await outbox();
      // Base deliberately returns no receipt from put. Resolve the real row;
      // a durable native claim prevents this adapter creating duplicate rows.
      await sendDevelopment({provider:'development',mode:'development'},{deliveryId:message.idempotencyKey,from:message.from,to:[message.to],subject:message.subject,text:message.text,...(message.html?{html:message.html}:{}),headers:message.headers},{outbox:storage});
      const rows=(await storage.list()).filter(row=>row.message.deliveryId===message.idempotencyKey);
      if(rows.length!==1)throw new Error('Local capture identity is ambiguous; automatic recapture is disabled.');
      const row=rows[0];
      await bucket.put(key,JSON.stringify({...claim,state:'captured',captureId:row.id}));
      return {...projectCapture(row),envelopeHash};
    },
    async publicOrigin(): Promise<string | null> {
      const object = await bucket.get('configuration/public-origin');
      return object ? object.text() : null;
    },
    async claimPublicOrigin(origin: string): Promise<void> {
      const key = 'configuration/public-origin';
      if (await bucket.put(key, origin, { onlyIf: { etagDoesNotMatch: '*' } })) return;
      const existing = await bucket.get(key);
      if (!existing || await existing.text() !== origin) {
        throw new Error('The local mail origin differs from the persisted development origin. Restore the original origin or intentionally reset the local outbox configuration. Stop pnpm dev and run: pnpm exec wrangler r2 object delete lamp-local-development-outbox/configuration/public-origin --local --persist-to .wrangler/state (or your LAMP_WORKERS_STATE_PATH).');
      }
    },
    async subscriberTokenSecret(): Promise<string> {
      const key = 'configuration/subscriber-token-secret';
      const existing = await bucket.get(key);
      if (existing) return existing.text();
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const secret = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (await bucket.put(key, secret, { onlyIf: { etagDoesNotMatch: '*' } })) return secret;
      const winner = await bucket.get(key);
      if (!winner) throw new Error('Development subscriber signing secret could not be persisted.');
      return winner.text();
    },
  };
}
export type DevOutboxRepository = ReturnType<typeof createDevOutboxRepository>;
