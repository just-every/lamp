import type { LiveStatus } from "../../overview/live-status";
import type { SettingsForm } from "./settings-form";
import { ClientExtensionSlot } from "../../../app/client/extensions";
import { PageHero } from "./page-hero";

const zones = () => { try { return Intl.supportedValuesOf("timeZone"); } catch { return []; } };

/** Settings › Page under Lamp's drawing of it: where the page lives, then its name, tagline and time zone. */
export function PageSettingsTab({ settings, live, markSrc, update }: {
  settings: SettingsForm; live: LiveStatus | null; markSrc: string;
  update: <K extends keyof SettingsForm>(field: K, value: SettingsForm[K], immediate?: boolean) => void;
}) {
  const timezones = zones();
  return <>
    <PageHero live={live} markSrc={markSrc} />
    <section className="data-card page-card" aria-labelledby="page-card-title">
      <p className="card-kicker" id="page-card-title">Page</p>
      <label className="form-label">Page name<input required maxLength={120} value={settings.pageName} onChange={event => update("pageName", event.target.value)} /></label>
      <label className="form-label">Tagline<textarea required maxLength={280} value={settings.tagline} onChange={event => update("tagline", event.target.value)} /></label>
      <label className="form-label">Time zone{timezones.length ? <select value={settings.timezone} onChange={event => update("timezone", event.target.value, true)}>{(timezones.includes(settings.timezone) ? timezones : [settings.timezone, ...timezones]).map(zone => <option key={zone} value={zone}>{zone}</option>)}</select> : <input required maxLength={100} value={settings.timezone} onChange={event => update("timezone", event.target.value)} />}</label>
    </section>
    <ClientExtensionSlot id="settings.sections.v1" context={{}} />
  </>;
}
