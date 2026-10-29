import type { PageSettingsView } from "../service";
import type { LiveStatus } from "../../overview/live-status";
import type { PreviewComponent } from "./page-preview";
import type { SettingsForm } from "./settings-form";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { PageHero } from "./page-hero";
import { TemplateChoice } from "./template-choice";
import { BrandCard } from "./brand-card";
import { ThemeSettings } from "./theme-settings";

const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } };

export function PageSettingsTab({ settings, saved, live, markSrc, components, update, adoptSaved, busy, setBusy, setStatus }: {
  settings: SettingsForm; saved: PageSettingsView; live: LiveStatus | null; markSrc: string; components: Array<PreviewComponent & { id?: string }>;
  update: <K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate?: boolean) => void;
  adoptSaved: (settings: PageSettingsView, asset?: "font" | "header") => void; busy: boolean; setBusy: (busy: boolean) => void; setStatus: (status: string | null) => void;
}) {
  const timezones = zones();
  return <>
    <PageHero live={live} pageName={settings.pageName} accentColor={settings.accentColor} markSrc={markSrc} components={components} />
    <TemplateChoice value={settings.template} showing={saved.template} regionsAvailable={saved.regionsAvailable} onChange={value => update("template", value, true)} />
    <div className="settings-pair">
      <section className="data-card page-card" aria-labelledby="page-card-title">
        <p className="card-kicker" id="page-card-title">Page</p>
        <label className="form-label">Page name<input required maxLength={120} value={settings.pageName} onChange={event => update("pageName", event.target.value)} /></label>
        <label className="form-label">Tagline<textarea required maxLength={280} value={settings.tagline} onChange={event => update("tagline", event.target.value)} /></label>
        <label className="form-label">Time zone{timezones.length ? <select value={settings.timezone} onChange={event => update("timezone", event.target.value, true)}>{(timezones.includes(settings.timezone) ? timezones : [settings.timezone, ...timezones]).map(zone => <option key={zone} value={zone}>{zone}</option>)}</select> : <input required maxLength={100} value={settings.timezone} onChange={event => update("timezone", event.target.value)} />}</label>
      </section>
      <BrandCard settings={saved} accentColor={settings.accentColor} footerCreditEnabled={settings.footerCreditEnabled} onAccentChange={(value, immediate) => update("accentColor", value, immediate)} onFooterCreditChange={value => update("footerCreditEnabled", value, true)} onSettings={adoptSaved} busy={busy} setBusy={setBusy} setStatus={setStatus} />
    </div>
    <ThemeSettings value={settings.theme} saved={saved} components={components.filter((component): component is PreviewComponent & { id: string } => Boolean(component.id))} onChange={theme => update("theme", theme)} onSettings={adoptSaved} busy={busy} setBusy={setBusy} />
    <ClientExtensionSlot id="settings.sections.v1" context={{}} />
  </>;
}
