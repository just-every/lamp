import { useState } from 'react';
import { appApi,useAppData } from '../../../app/client/ui/api';
import { FormError } from '../../../app/client/ui/states';
import { CardSaveNote } from './settings-save-state';

type MailSettings={primaryProvider:string;configuredSecondaryProvider:string|null;secondaryProvider:string|null};
const names:Record<string,string>={rer:'RER',resend:'Resend',sendgrid:'SendGrid',mailgun:'Mailgun',ses:'Amazon SES',postmark:'Postmark'};
const label=(provider:string)=>names[provider]??provider;

export function MailDeliverySettings(){
  const settings=useAppData<MailSettings>('/api/app/mail-settings');
  const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null|undefined>(undefined);
  async function change(value:string){
    setSaving(true);setSaved(false);setError(null);setSelected(value||null);
    try{const next=await appApi<MailSettings>('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:value||null})});setSelected(next.secondaryProvider);setSaved(true);settings.refresh();}
    catch(cause){setSelected(undefined);setError(cause instanceof Error?cause.message:'The secondary provider could not be saved.');}
    finally{setSaving(false);}
  }
  return <section className="data-card" aria-labelledby="email-delivery-title">
    <p className="card-kicker" id="email-delivery-title">Email delivery</p>
    {settings.data?<>
      <p>Primary provider: {label(settings.data.primaryProvider)}</p>
      <label className="form-label">Secondary provider<select value={selected===undefined?settings.data.secondaryProvider??'':selected??''} disabled={saving} onChange={event=>void change(event.target.value)}>
        <option value="">None</option>{settings.data.configuredSecondaryProvider&&<option value={settings.data.configuredSecondaryProvider}>{label(settings.data.configuredSecondaryProvider)}</option>}
      </select></label>
      {settings.data.configuredSecondaryProvider?<p>A secondary takes over after five minutes of retryable primary rejections. An unconfirmed send stays with its original provider.</p>:<p>Connect a secondary provider in your hosting settings to make it available here.</p>}
      <CardSaveNote saving={saving} saved={saved}/>
    </>:<p>Loading email providers…</p>}
    {(error||settings.error)&&<FormError>{error||settings.error}</FormError>}
  </section>;
}
