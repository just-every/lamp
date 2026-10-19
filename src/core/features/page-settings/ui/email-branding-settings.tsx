import type { EmailBranding } from "../../../shared/email-branding";

export function EmailBrandingSettings({ value, onChange, identityEditable }: {
  value: EmailBranding; onChange: (value: EmailBranding) => void; identityEditable: boolean;
}) {
  const update = <K extends keyof EmailBranding>(key: K, next: EmailBranding[K]) => onChange({ ...value, [key]: next });
  return <section className="data-card email-branding-settings" aria-labelledby="email-branding-title">
    <p className="card-kicker">Subscriber notifications</p><h2 id="email-branding-title">Notification email</h2>
    <p>The authenticated From address stays the one configured above. Preview your saved branding in an incident’s Email preview.</p>
    {!identityEditable && <p>Managed mail controls From and Reply-To. You can still brand the subject and message below.</p>}
    <div className="settings-grid">
      <label className="form-label">Sender display name<input maxLength={120} disabled={!identityEditable} value={value.displayName} onChange={event => update("displayName", event.target.value)} /></label>
      <label className="form-label">Reply-to address<input type="email" disabled={!identityEditable} value={value.replyTo} onChange={event => update("replyTo", event.target.value)} /></label>
      <label className="form-label full-width">Subject prefix<input maxLength={80} value={value.subjectPrefix} onChange={event => update("subjectPrefix", event.target.value)} placeholder="[Acme status]" /></label>
      <label className="form-label full-width">Email header<textarea maxLength={500} value={value.header} onChange={event => update("header", event.target.value)} /><small>Plain text, shown above the update.</small></label>
      <label className="form-label full-width">Email footer<textarea maxLength={1000} value={value.footer} onChange={event => update("footer", event.target.value)} /><small>You can include your business’s postal address. Management, unsubscribe and List headers are always added and cannot be removed.</small></label>
      <label className="checkbox-label full-width"><input type="checkbox" checked={value.usePageLogo} onChange={event => update("usePageLogo", event.target.checked)} />Use the uploaded page logo in email</label>
    </div><p>Upload the logo in Brand mark below. Email loads it only from your public status host; the text part has no image reference.</p>
  </section>;
}
