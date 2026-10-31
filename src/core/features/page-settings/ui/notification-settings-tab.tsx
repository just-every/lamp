import { TrafficAlertSettings, type TrafficSavePhase } from "./traffic-alert-settings";
import type { LiveStatus } from "../../overview/live-status";
import type { SettingsForm } from "./settings-form";
import { Button } from "../../../app/client/ui/button";
import { SenderStatusLine } from "./sender-status";
import { MailDeliverySettings } from "./mail-delivery-settings";
import { EmailBrandingSettings } from "./email-branding-settings";
import { SmsSettings } from "./sms-settings";
import { IncidentFollowSettings } from "./incident-follow-settings";
import { MaintenanceAutomationCard } from "../../maintenance/ui/automation-default-card";

export function NotificationSettingsTab({ settings, live, identityEditable, update, needsConfirm, confirm, onTrafficPhase }: {
  settings: SettingsForm; live: LiveStatus | null; identityEditable: boolean;
  update: <K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate?: boolean) => void;
  needsConfirm: boolean; confirm: () => void; onTrafficPhase: (phase: TrafficSavePhase) => void;
}) {
  return <>
    <section className="data-card" aria-labelledby="sender-title">
      <p className="card-kicker" id="sender-title">Sender</p>
      <label className="form-label">From email<input aria-label="From email" required type="email" value={settings.mailFromAddress} onChange={event => update("mailFromAddress", event.target.value)} /><small>Notification email is sent only from this configured address.</small></label>
      {needsConfirm && <div className="settings-confirm"><small>This address is not live until you confirm.</small><Button type="button" variant="secondary" className="table-action" onClick={confirm}>Confirm</Button></div>}
      <SenderStatusLine sender={live?.sender ?? null} />
    </section>
    <TrafficAlertSettings onPhase={onTrafficPhase} />
    <MailDeliverySettings />
    <SmsSettings />
    <IncidentFollowSettings />
    <EmailBrandingSettings value={settings.emailBranding} onChange={(value, immediate) => update("emailBranding", value, immediate)} identityEditable={identityEditable} />
    <MaintenanceAutomationCard />
  </>;
}
