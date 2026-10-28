import { z } from 'zod';
import { constantTimeEqual } from '../../platform/security/opaque-tokens';
import type { DeliveriesService } from './service';
const eventSchema=z.object({RecordType:z.enum(['Bounce','SpamComplaint','Delivery']),ID:z.union([z.string(),z.number()]).optional(),MessageID:z.string().min(1).max(1000),Type:z.string().optional(),Metadata:z.object({lamp_message_id:z.string()})});

/** Postmark supports HTTPS Basic authentication, not a native payload signature.
 * This verifies that documented authentication without claiming signed events. */
export async function handlePostmarkEvents(request:Request,secret:string|undefined,service:DeliveriesService){
  if(!secret)return new Response('Mail delivery webhooks are not configured.',{status:503});
  const expected=`Basic ${btoa(`lamp:${secret}`)}`;
  if(!constantTimeEqual(request.headers.get('authorization')??'',expected))return new Response('Invalid mail provider authentication.',{status:401});
  const raw=await request.text();if(new TextEncoder().encode(raw).length>256*1024)return new Response('Mail provider event is too large.',{status:413});
  let value:unknown;try{value=JSON.parse(raw);}catch{return new Response('Malformed mail provider event.',{status:400});}
  const parsed=eventSchema.safeParse(value);if(!parsed.success)return new Response('Malformed mail provider event.',{status:400});
  const event=parsed.data,providerMessageId=event.Metadata.lamp_message_id;
  if(providerMessageId.startsWith('postmark-'))await service.handleProviderEvent({id:`postmark/${event.RecordType}/${event.ID??event.MessageID}`,providerMessageId,type:event.RecordType==='Delivery'?'delivered':event.RecordType==='SpamComplaint'?'complained':'bounced',hardBounce:event.Type==='HardBounce'||event.Type==='BadEmailAddress'});
  return new Response(null,{status:200});
}
