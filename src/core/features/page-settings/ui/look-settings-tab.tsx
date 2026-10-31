import type { PageSettingsView } from "../service";
import type { PreviewComponent } from "./page-preview";
import type { SettingsForm } from "./settings-form";
import { TemplateChoice } from "./template-choice";
import { BrandCard } from "./brand-card";
import { ThemeSettings } from "./theme-settings";

/** Settings › Look: the page's template, its brand (with the website it came from) and its theme. */
export function LookSettingsTab({ settings, saved, components, update, adoptSaved, busy, setBusy, status, setStatus }: {
  settings: SettingsForm; saved: PageSettingsView; components: Array<PreviewComponent & { id: string }>;
  update: <K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate?: boolean) => void;
  adoptSaved: (settings: PageSettingsView, asset?: "font" | "header") => void; busy: boolean; setBusy: (busy: boolean) => void;
  status: string | null; setStatus: (status: string | null) => void;
}) {
  return <>
    <TemplateChoice value={settings.template} showing={saved.template} regionsAvailable={saved.regionsAvailable} onChange={value => update("template", value, true)} />
    <BrandCard settings={saved} accentColor={settings.accentColor} footerCreditEnabled={settings.footerCreditEnabled} onAccentChange={(value, immediate) => update("accentColor", value, immediate)} onFooterCreditChange={value => update("footerCreditEnabled", value, true)} onSettings={adoptSaved} busy={busy} setBusy={setBusy} setStatus={setStatus} />
    {status && <p className="save-message" role="status">{status}</p>}
    <ThemeSettings value={settings.theme} saved={saved} components={components} onChange={theme => update("theme", theme)} onSettings={adoptSaved} busy={busy} setBusy={setBusy} />
  </>;
}
