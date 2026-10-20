import { EmailBrandingSettings } from "./email-branding-settings";
import { AuditLog } from "../../audit-log/ui/audit-log";
import { PublicResources } from "./public-resources";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";

import type { PageSettingsInput } from "../../../shared/schemas";
import type { PageSettingsService, PageSettingsView } from "../service";
import type { OverviewService } from "../../overview/service";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { LoadingState } from "../../../app/client/ui/states";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { ChannelsCard } from "../../channels/ui/channels-card";
import { OperatorsPanel } from "../../operators/ui/operators-panel";
import { WordingSettings } from "./wording-settings";
import { ImportDoorSetting } from "./import-door-setting";
import { AiAssistanceCard, type AiStatus } from "./ai-assistance-card";
import { PageDataCard } from "../../page-export/ui/page-data-card";
import { PageHero } from "./page-hero";
import { BrandCard } from "./brand-card";
import { SenderStatusLine } from "./sender-status";
import { SettingsTabs, useSettingsTab } from "./settings-tabs";

const operatorRoute = getRouteApi("/app");

type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };
type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };
type SettingsForm = Omit<Required<PageSettingsInput>, "emailBranding"> & { emailBranding: PageSettingsView["emailBranding"] };

function toSettingsForm(settings: PageSettingsView): SettingsForm {
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

const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } };

export function SettingsPage() {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const overview = useAppData<OverviewResponse>("/api/app/overview");
  const publicOrigin = operatorRoute.useLoaderData().publicPageOrigin;
  const aiStatus = useAppData<AiStatus>("/api/app/ai/status");
  const tab = useSettingsTab();
  const [saved, setSaved] = useState<PageSettingsView | null>(data?.settings ?? null);
  const [settings, setSettings] = useState<SettingsForm | null>(() => data?.settings ? toSettingsForm(data.settings) : null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data?.settings && !settings) { setSettings(toSettingsForm(data.settings)); setSaved(data.settings); }
  }, [data, settings]);
  if (loading && !data) return <LoadingState />;
  if (error) return <ErrorState onRetry={() => window.location.reload()}>{error}</ErrorState>;
  if (!settings || !saved) return null;

  const live = overview.data?.overview.live ?? null;
  const components = (overview.data?.overview.components ?? []).filter((component) => !component.internal).map((component) => ({ name: component.name, state: component.publicState }));
  const markSrc = saved.logoKey ? `/api/app/page-settings/brand/logo?v=${encodeURIComponent(saved.updatedAt)}` : `/api/app/page-settings/brand/favicon?v=${encodeURIComponent(saved.updatedAt)}`;
  const update = <K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) => setSettings((current) => current ? { ...current, [field]: value } : current);
  // A logo change saves on its own; the form keeps any unsaved edits.
  const adoptSaved = (next: PageSettingsView) => { setSaved(next); window.dispatchEvent(new Event("lamp:page-settings-changed")); };
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setStatus(null);
    try {
      const body = await appApi<SettingsResponse>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(settings) });
      if (body.settings) setSaved(body.settings);
      window.dispatchEvent(new Event("lamp:page-settings-changed"));
      overview.refresh();
      setStatus("Settings saved and the public snapshot was rebuilt.");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Settings could not be saved.");
    } finally { setSaving(false); }
  }
  const timezones = zones();
  const saveBar = <div className="settings-save-bar">
    {status ? <p className="save-message" role="status">{status}</p> : <p className="settings-save-note"><Icon name="check" width={16} height={16} />Changes publish as soon as you save.</p>}
    <Button disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
  </div>;
  const form = (children: ReactNode) => <form className="settings-form page-stack" onSubmit={save}>{children}{saveBar}</form>;

  return <div className="page-stack settings-page">
    <section className="page-title-row"><div><p className="eyebrow">Public page configuration</p><h1>Settings</h1><p>What your status page is, where it lives, and how it looks.</p></div></section>
    <SettingsTabs current={tab} />
    {tab === "page" ? form(<>
      <PageHero live={live} pageName={settings.pageName} accentColor={settings.accentColor} markSrc={markSrc} components={components} />
      <div className="settings-pair">
        <section className="data-card page-card" aria-labelledby="page-card-title">
          <p className="card-kicker" id="page-card-title">Page</p>
          <label className="form-label">Page name<input required maxLength={120} value={settings.pageName} onChange={(event) => update("pageName", event.target.value)} /></label>
          <label className="form-label">Tagline<textarea required maxLength={280} value={settings.tagline} onChange={(event) => update("tagline", event.target.value)} /></label>
          <label className="form-label">Time zone{timezones.length ? <select value={settings.timezone} onChange={(event) => update("timezone", event.target.value)}>{(timezones.includes(settings.timezone) ? timezones : [settings.timezone, ...timezones]).map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select> : <input required maxLength={100} value={settings.timezone} onChange={(event) => update("timezone", event.target.value)} />}</label>
        </section>
        <BrandCard settings={saved} accentColor={settings.accentColor} footerCreditEnabled={settings.footerCreditEnabled} onAccentChange={(value) => update("accentColor", value)} onFooterCreditChange={(value) => update("footerCreditEnabled", value)} onSettings={adoptSaved} busy={saving} setBusy={setSaving} setStatus={setStatus} />
      </div>
      <ClientExtensionSlot id="settings.sections.v1" context={{}} />
    </>) : null}
    {tab === "notifications" ? form(<>
      <section className="data-card" aria-labelledby="sender-title">
        <p className="card-kicker" id="sender-title">Sender</p>
        <label className="form-label">From email<input required type="email" value={settings.mailFromAddress} onChange={(event) => update("mailFromAddress", event.target.value)} /><small>Notification email is sent only from this configured address.</small></label>
        <SenderStatusLine sender={live?.sender ?? null} />
      </section>
      <EmailBrandingSettings value={settings.emailBranding} onChange={(value) => update("emailBranding", value)} identityEditable={saved.mailIdentityEditable} />
    </>) : null}
    {tab === "writing" ? form(<>
      <AiAssistanceCard toneInstructions={settings.aiToneInstructions} status={aiStatus.data ?? null} loading={aiStatus.loading} error={aiStatus.error} onToneInstructionsChange={(value) => update("aiToneInstructions", value)} />
      <WordingSettings terms={settings.wordingBlockedTerms} friendlyLength={settings.wordingFriendlyLength} onTermsChange={(value) => update("wordingBlockedTerms", value)} onLengthChange={(value) => update("wordingFriendlyLength", value)} />
    </>) : null}
    {tab === "embeds" ? form(<>
      <section className="data-card">
        <label className="form-label">Widget host origins<textarea value={settings.widgetAllowedOrigins.join("\n")} placeholder="https://app.example.com" onChange={(event) => update("widgetAllowedOrigins", event.target.value.split("\n").map((value) => value.trim()).filter(Boolean))} /><small>One full origin per line. The widget refuses every other host.</small></label>
      </section>
      <PublicResources publicOrigin={publicOrigin} />
    </>) : null}
    {tab === "channels" ? <>
      <ChannelsCard />
    </> : null}
    {tab === "operators" ? <OperatorsPanel /> : null}
    {tab === "data" ? <>
      <section className="data-card intake-link-card"><p className="card-kicker">Moving here</p><h2>Move in</h2><p>Bring components, incident history, maintenance and subscribers, with a dry run first and undo after.</p><ImportDoorSetting /><Link className="text-link" to="/app/move-in">Start a move-in <Icon name="arrow" width={16} height={16} /></Link><a className="text-link" href="/app/cutover">Cutover preview</a></section>
      <PageDataCard />
      <AuditLog />
    </> : null}
  </div>;
}
