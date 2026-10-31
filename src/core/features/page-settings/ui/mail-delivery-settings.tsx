import { useRef,useState } from 'react';
import { appApi,useAppData } from '../../../app/client/ui/api';
import { Button } from '../../../app/client/ui/button';
import { leaveWhenSaved,useLeaveGuard } from '../../../app/client/ui/leave-guard';
import { FormError } from '../../../app/client/ui/states';
import { saveFailureReason,useReportPhase,type SavePhase } from './settings-save-state';

type MailSettings={primaryProvider:string;configuredSecondaryProvider:string|null;secondaryProvider:string|null};
const names:Record<string,string>={rer:'RER',resend:'Resend',sendgrid:'SendGrid',mailgun:'Mailgun',ses:'Amazon SES',postmark:'Postmark'};
const label=(provider:string)=>names[provider]??provider;

/** The secondary provider saves as it changes, and its state joins the pane's one save note through `onPhase`. A choice
 * that could not be saved stays in the select with its reason and Retry. */
export function MailDeliverySettings({onPhase}:{onPhase:(phase:SavePhase)=>void}){
  const settings=useAppData<MailSettings>('/api/app/mail-settings');
  const [phase,setPhase]=useState<SavePhase>('saved'),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<string|null|undefined>(undefined);
  const queue=useRef({revision:0,completed:0,stopped:-1,leaving:0,released:false,answered:new Set<()=>void>()});
  useReportPhase(onPhase,phase);
  // The select waits while a choice saves, so leaving only waits for that answer; a refused choice is left behind only when the owner agrees.
  useLeaveGuard(()=>leaveWhenSaved(queue.current,()=>undefined,'Email delivery changes have not saved. Leave them behind?'),()=>queue.current.completed!==queue.current.revision&&!queue.current.released);
  async function change(value:string|null){
    const q=queue.current,revision=++q.revision;q.released=false;
    setPhase('saving');setError(null);setSelected(value);
    try{const saved=await appApi<MailSettings>('/api/app/mail-settings',{method:'PATCH',body:JSON.stringify({secondaryProvider:value})});q.completed=revision;setSelected(saved.secondaryProvider);setPhase('saved');settings.refresh();}
    catch(cause){q.stopped=revision;setPhase('error');setError(`Email delivery could not be saved: ${saveFailureReason(cause)} Your change is kept here.`);}
    finally{for(const answer of [...q.answered])answer();}
  }
  return <section className="data-card" aria-labelledby="email-delivery-title">
    <p className="card-kicker" id="email-delivery-title">Email delivery</p>
    {settings.data?<>
      <p>Primary provider: {label(settings.data.primaryProvider)}</p>
      <label className="form-label">Secondary provider<select value={selected===undefined?settings.data.secondaryProvider??'':selected??''} disabled={phase==='saving'} onChange={event=>void change(event.target.value||null)}>
        <option value="">None</option>{settings.data.configuredSecondaryProvider&&<option value={settings.data.configuredSecondaryProvider}>{label(settings.data.configuredSecondaryProvider)}</option>}
      </select></label>
      {settings.data.configuredSecondaryProvider?<p>A secondary takes over after five minutes of retryable primary rejections. An unconfirmed send stays with its original provider.</p>:<p>Connect a secondary provider in your hosting settings to make it available here.</p>}
      {error&&<p className="save-message" role="alert">{error} <Button type="button" variant="secondary" className="table-action" onClick={()=>void change(selected??null)}>Retry</Button></p>}
    </>:<p>Loading email providers…</p>}
    {settings.error&&<FormError>{settings.error}</FormError>}
  </section>;
}
