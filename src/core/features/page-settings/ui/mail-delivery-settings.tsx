import { useState } from 'react';
import { appApi,useAppData } from '../../../app/client/ui/api';
import { FormError } from '../../../app/client/ui/states';
import { saveFailureReason,useReportSave,type CardSave,type SavePhase } from './settings-save-state';

type MailSettings={primaryProvider:string;configuredSecondaryProvider:string|null;secondaryProvider:string|null};
const names:Record<string,string>={rer:'RER',resend:'Resend',sendgrid:'SendGrid',mailgun:'Mailgun',ses:'Amazon SES',postmark:'Postmark'};
const label=(provider:string)=>names[provider]??provider;

/** The secondary provider saves as it changes; its state, failure and Retry join the tabs' one save note through `onSave`. */
export function MailDeliverySettings({onSave}:{onSave:(save:CardSave)=>void}){
  const settings=useAppData<MailSettings>('/api/app/mail-settings');
  const [phase,setPhase]=useState<SavePhase>('saved'),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null|undefined>(undefined);
  // A choice that could not be saved stays in the select, so Retry sends it again.
  async function change(value:string|null){
    setPhase('saving');setError(null);setSelected(value);
    try{const next=await appApi<MailSettings>('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:value})});setSelected(next.secondaryProvider);setPhase('saved');settings.refresh();}
    catch(cause){setPhase('error');setError(`Email delivery could not be saved: ${saveFailureReason(cause)} Your change is kept here.`);}
  }
  useReportSave(onSave,phase,error,()=>void change(selected??null));
  return <section className="data-card" aria-labelledby="email-delivery-title">
    <p className="card-kicker" id="email-delivery-title">Email delivery</p>
    {settings.data?<>
      <p>Primary provider: {label(settings.data.primaryProvider)}</p>
      <label className="form-label">Secondary provider<select value={selected===undefined?settings.data.secondaryProvider??'':selected??''} disabled={phase==='saving'} onChange={event=>void change(event.target.value||null)}>
        <option value="">None</option>{settings.data.configuredSecondaryProvider&&<option value={settings.data.configuredSecondaryProvider}>{label(settings.data.configuredSecondaryProvider)}</option>}
      </select></label>
      {settings.data.configuredSecondaryProvider?<p>A secondary takes over after five minutes of retryable primary rejections. An unconfirmed send stays with its original provider.</p>:<p>Connect a secondary provider in your hosting settings to make it available here.</p>}
    </>:<p>Loading email providers…</p>}
    {settings.error&&<FormError>{settings.error}</FormError>}
  </section>;
}
