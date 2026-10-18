import { useEffect, useState, type FormEvent } from "react";

import type { PageSettingsInput } from "../../../shared/schemas";
import type { PageSettingsService } from "../../page-settings/service";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { LitPage } from "../../../app/client/ui/lit-page";
import { LoadingState } from "../../../app/client/ui/states";

type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };

/** The owner's first run: name the page, describe it, and choose its time zone
 * and colour. Saving stores first-run completion and opens the app. */
export function FirstRunPage({ publicPageOrigin }: { publicPageOrigin: string }) {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const [form, setForm] = useState<Required<PageSettingsInput> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data?.settings || form) return;
    const { pageName, tagline, accentColor, timezone, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength } = data.settings;
    setForm({ pageName, tagline, accentColor, timezone, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength });
  }, [data, form]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!form) return null;
  const update = <K extends keyof PageSettingsInput>(field: K, value: PageSettingsInput[K]) => setForm((current) => current ? { ...current, [field]: value } : current);
  async function finish(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(null);
    try {
      await appApi<SettingsResponse>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(form) });
      await appApi("/api/app/overview/first-run", { method: "POST", body: "{}" });
      window.location.assign("/app");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Your page could not be saved.");
      setSaving(false);
    }
  }
  return <LitPage><div className="first-run-page page-stack">
    <section className="page-title-row"><div><p className="eyebrow">First run</p><h1>Set up your status page</h1><p>Name the page your customers will read. You can change all of this later in Settings.</p></div></section>
    <form className="settings-form data-card" onSubmit={finish}>
      <label className="form-label">Page name<input required maxLength={120} value={form.pageName} onChange={(event) => update("pageName", event.target.value)} /></label>
      <label className="form-label">Tagline<textarea required maxLength={280} value={form.tagline} onChange={(event) => update("tagline", event.target.value)} /></label>
      <label className="form-label">Time zone<input required maxLength={100} value={form.timezone} onChange={(event) => update("timezone", event.target.value)} /><small>An IANA name such as Europe/London. Every time on your page uses it.</small></label>
      <label className="form-label">Accent colour<input required pattern="#[0-9A-Fa-f]{6}" value={form.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></label>
      {message && <p className="save-message" role="alert">{message}</p>}
      <div className="form-actions"><Button disabled={saving}>{saving ? "Saving…" : "Save and open Lamp"}</Button></div>
    </form>
    <p>Your public page will be at <span className="keep-together"><a className="quiet-link" href={`${publicPageOrigin}/`}>{publicPageOrigin}</a>.</span></p>
  </div></LitPage>;
}
