import { EmailBrandingSettings } from "./email-branding-settings";
import { PublicResources } from "./public-resources";
import { useEffect, useState, type FormEvent } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";

import type { PageSettingsInput } from "../../../shared/schemas";
import type { PageSettingsService } from "../service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { ChannelsCard } from "../../channels/ui/channels-card";
import { OperatorsPanel } from "../../operators/ui/operators-panel";
import { ReadinessSettings } from "../../overview/ui/readiness-settings";
import { WordingSettings } from "./wording-settings";
import { AiAssistanceCard, type AiStatus } from "./ai-assistance-card";
import { PageDataCard } from "../../page-export/ui/page-data-card";

const operatorRoute = getRouteApi("/app");

type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };
type SettingsForm = Omit<Required<PageSettingsInput>, "emailBranding"> & { emailBranding: NonNullable<SettingsResponse["settings"]>["emailBranding"] };

function toSettingsForm(settings: NonNullable<SettingsResponse["settings"]>): SettingsForm {
  return {
    pageName: settings.pageName,
    tagline: settings.tagline,
    accentColor: settings.accentColor,
    timezone: settings.timezone,
    hostname: settings.hostname,
    footerCreditEnabled: settings.footerCreditEnabled,
    widgetAllowedOrigins: settings.widgetAllowedOrigins,
    mailFromAddress: settings.mailFromAddress,
    emailBranding: settings.emailBranding,
    aiToneInstructions: settings.aiToneInstructions,
    wordingBlockedTerms: settings.wordingBlockedTerms,
    wordingFriendlyLength: settings.wordingFriendlyLength,
  };
}

export function SettingsPage() {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const publicOrigin = operatorRoute.useLoaderData().publicPageOrigin;
  const aiStatus = useAppData<AiStatus>("/api/app/ai/status");
  const [settings, setSettings] = useState<SettingsForm | null>(() => data?.settings ? toSettingsForm(data.settings) : null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<File | null>(null);
  useEffect(() => {
    if (data?.settings && !settings) setSettings(toSettingsForm(data.settings));
  }, [data, settings]);
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!settings) return null;

  const update = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => setSettings((current) => current ? { ...current, [field]: value } : current);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setStatus(null);
    try {
      await appApi<SettingsResponse>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(settings) });
      window.dispatchEvent(new Event("lamp:page-settings-changed"));
      setStatus("Settings saved and the public snapshot was rebuilt.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally { setSaving(false); }
  }

  async function uploadLogo() {
    if (!logo) return;
    setSaving(true); setStatus(null);
    try {
      const form = new FormData();
      form.set("logo", logo);
      const response = await fetch("/api/app/page-settings/logo", { method: "POST", body: form, headers: { Accept: "application/json" } });
      const body = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok || !body.settings) throw new Error(body.error ?? "The logo could not be saved.");
      setSettings(toSettingsForm(body.settings));
      setLogo(null);
      setStatus("Logo saved and the public snapshot was rebuilt.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The logo could not be saved.");
    } finally { setSaving(false); }
  }

  async function removeLogo() {
    setSaving(true); setStatus(null);
    try {
      const body = await appApi<SettingsResponse>("/api/app/page-settings/logo", { method: "DELETE" });
      if (!body.settings) throw new Error("The logo could not be removed.");
      setSettings(toSettingsForm(body.settings));
      setLogo(null);
      setStatus("Logo removed and the public snapshot was rebuilt.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "The logo could not be removed.");
    } finally { setSaving(false); }
  }

  return <div className="page-stack"><section className="page-title-row"><div><p className="eyebrow">Public page configuration</p><h1>Settings</h1><p>Set how customers recognize and read your status page.</p><a className="quiet-link" href={publicOrigin} target="_blank" rel="noopener">Open the public status page <Icon name="external" width={15} height={15} /></a></div></section><form className="settings-form" onSubmit={save}><div className="settings-workspace"><section className="data-card settings-card"><div className="settings-grid"><label className="form-label">Page name<input required maxLength={120} value={settings.pageName} onChange={(event) => update("pageName", event.target.value)} /></label><label className="form-label">Host name<input required maxLength={253} value={settings.hostname} onChange={(event) => update("hostname", event.target.value)} /></label><label className="form-label full-width">Tagline<textarea required maxLength={280} value={settings.tagline} onChange={(event) => update("tagline", event.target.value)} /></label><label className="form-label">Accent colour<span className="colour-field"><span className="colour-swatch" style={{ background: settings.accentColor }} aria-hidden="true" /><input required pattern="#[0-9A-Fa-f]{6}" value={settings.accentColor} onChange={(event) => update("accentColor", event.target.value)} /></span></label><label className="form-label">Timezone<input required maxLength={100} value={settings.timezone} onChange={(event) => update("timezone", event.target.value)} /></label><label className="form-label">From email<input required type="email" value={settings.mailFromAddress} onChange={(event) => update("mailFromAddress", event.target.value)} /><small>Notification email is sent only from this configured address.</small></label><label className="form-label full-width">Widget host origins<textarea value={settings.widgetAllowedOrigins.join("\n")} placeholder="https://app.example.com" onChange={(event) => update("widgetAllowedOrigins", event.target.value.split("\n").map((value) => value.trim()).filter(Boolean))} /><small>One full origin per line. The widget refuses every other host.</small></label><label className="checkbox-label full-width"><input type="checkbox" checked={settings.footerCreditEnabled} onChange={(event) => update("footerCreditEnabled", event.target.checked)} />Show the Powered by Lamp footer credit</label></div></section><aside className="settings-sidecar"><AiAssistanceCard toneInstructions={settings.aiToneInstructions} status={aiStatus.data ?? null} loading={aiStatus.loading} error={aiStatus.error} onToneInstructionsChange={(value) => update("aiToneInstructions", value)} /><section className="data-card intake-link-card"><p className="card-kicker">Inbound alerts</p><h2>Alert sources</h2><p>Configure a signed HMAC or bearer-token source, its JSON paths, and receipt visibility in the operator workspace.</p><Link className="text-link" to="/app/alerts">Manage alert sources <Icon name="arrow" width={16} height={16} /></Link></section><section className="data-card intake-link-card"><p className="card-kicker">Moving here</p><h2>Move in</h2><p>Bring components, incident history, maintenance and subscribers, with a dry run first and undo after.</p><Link className="text-link" to="/app/move-in">Start a move-in <Icon name="arrow" width={16} height={16} /></Link><a className="text-link" href="/app/cutover">Cutover preview</a></section></aside></div><EmailBrandingSettings value={settings.emailBranding} onChange={value => update("emailBranding", value)} identityEditable={data?.settings?.mailIdentityEditable ?? false} /><WordingSettings terms={settings.wordingBlockedTerms} friendlyLength={settings.wordingFriendlyLength} onTermsChange={value => update("wordingBlockedTerms", value)} onLengthChange={value => update("wordingFriendlyLength", value)} />{status && <p className="save-message" role="status">{status}</p>}<div className="form-actions"><Button disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button></div></form><section className="data-card branding-card"><div><p className="card-kicker">Brand mark</p><h2>Logo, favicon, and social image</h2><p>The original PNG, JPEG, or WebP logo remains in private deployment storage. The snapshot serves it from this origin and generates a status-marked favicon and Open Graph image.</p></div><label className="form-label">Logo file<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} /></label><div className="form-actions"><Button variant="secondary" type="button" onClick={removeLogo} disabled={saving}>Remove logo</Button><Button type="button" onClick={uploadLogo} disabled={saving || !logo}>{saving ? "Saving…" : "Upload logo"}</Button></div></section><PublicResources publicOrigin={publicOrigin} /><ChannelsCard /><ReadinessSettings /><OperatorsPanel /><PageDataCard /><ClientExtensionSlot id="settings.sections.v1" context={{}} /></div>;
}
