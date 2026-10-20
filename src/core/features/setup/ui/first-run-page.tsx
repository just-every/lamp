import { useEffect, useState, type FormEvent } from "react";

import type { PageSettingsInput } from "../../../shared/schemas";
import type { PageSettingsService } from "../../page-settings/service";
import type { WebsiteReadResponse } from "../../website";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { LitPage } from "../../../app/client/ui/lit-page";
import { LoadingState } from "../../../app/client/ui/states";
import { isVectorMark, markToPng, uploadMark } from "../../../app/client/ui/mark-image";
import { FoundCard, type FoundPage } from "./found-card";

type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };
type Phase = { step: "ask" } | { step: "reading" } | { step: "review"; note: string };

/** The owner's first run: their website first; Lamp fills in what the site gives, the owner checks it,
 * and opening Lamp stores it all. Nothing here is required beyond confirming. */
export function FirstRunPage({ publicPageOrigin }: { publicPageOrigin: string }) {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const [website, setWebsite] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "ask" });
  const [found, setFound] = useState<FoundPage | null>(null);
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null); }, []);
  if (loading) return <LoadingState />;
  if (error || !data?.settings) return <ErrorState onRetry={() => window.location.reload()}>{error ?? "Your page settings could not be loaded."}</ErrorState>;
  const settings = data.settings;
  const plain = (): FoundPage => ({ pageName: settings.pageName, tagline: settings.tagline, accentColor: settings.accentColor.toUpperCase(), timezone: browserZone ?? settings.timezone, mark: null, components: [], statusPage: null });
  const address = new URL(publicPageOrigin).host;

  async function read(event: FormEvent) {
    event.preventDefault();
    setPhase({ step: "reading" });
    const result = await appApi<WebsiteReadResponse>("/api/app/website/read", { method: "POST", body: JSON.stringify({ website }) })
      .catch((cause: unknown) => ({ found: null, message: cause instanceof Error ? cause.message : "We couldn't read that website." }) as WebsiteReadResponse);
    const base = plain();
    if (!result.found) {
      setFound(base);
      setPhase({ step: "review", note: `${result.message} These are plain defaults; change anything now or later in Settings.` });
      return;
    }
    const site = result.found;
    setFound({ ...base, pageName: site.pageName, tagline: site.tagline ?? base.tagline, accentColor: site.accentColor ?? base.accentColor, mark: site.mark ? { src: site.mark.dataUrl, vector: isVectorMark(site.mark.contentType), from: site.mark.url } : null, components: site.components.map((component) => component.name), statusPage: site.statusPage });
    setPhase({ step: "review", note: `We read ${site.host} and filled in what we could. Change anything now or later in Settings.` });
  }

  function skip() {
    setFound(plain());
    setPhase({ step: "review", note: "Change anything now or later in Settings." });
  }

  async function finish() {
    if (!found) return;
    setSaving(true); setMessage(null);
    try {
      const { pageName, tagline, accentColor, timezone } = found;
      const { hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength } = settings;
      const next: Required<PageSettingsInput> = { pageName: pageName.trim(), tagline: tagline.trim(), accentColor, timezone, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength };
      await appApi<SettingsResponse>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(next) });
      if (found.mark) {
        // The page still opens with a letter mark if this browser cannot draw the file.
        const png = await markToPng(found.mark.src, found.mark.vector).catch(() => null);
        if (png) await uploadMark(png);
      }
      await appApi("/api/app/overview/first-run", { method: "POST", body: JSON.stringify({ components: found.components.map((name) => name.trim()).filter(Boolean) }) });
      window.location.assign("/app");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Your page could not be saved.");
      setSaving(false);
    }
  }

  return <LitPage><div className="first-run-page">
    <p className="eyebrow">First run</p>
    <h1>Your status page, from your website</h1>
    <form className="website-form" onSubmit={read}>
      <label className="form-label" htmlFor="first-run-website">Website</label>
      <div className="website-field">
        <input id="first-run-website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="example.com" required value={website} onChange={(event) => setWebsite(event.target.value)} disabled={phase.step === "reading"} />
        {phase.step === "review" ? <Button type="submit" variant="secondary" disabled={!website.trim()}>Read again</Button> : <Button type="submit" disabled={phase.step === "reading"}>{phase.step === "reading" ? "Reading…" : "Read website"}</Button>}
      </div>
      {phase.step === "review" ? <p className="website-note" role="status">{phase.note}</p> : <button type="button" className="website-skip" onClick={skip} disabled={phase.step === "reading"}>Skip, I'll fill it in</button>}
    </form>
    {phase.step === "review" && found ? <>
      <FoundCard page={found} browserZone={browserZone} address={address} onChange={(next) => setFound((current) => current ? { ...current, ...next } : current)} />
      {message && <p className="save-message" role="alert">{message}</p>}
      <div className="first-run-finish">
        <Button type="button" onClick={finish} disabled={saving || !found.pageName.trim() || !found.tagline.trim() || !/^#[0-9a-f]{6}$/i.test(found.accentColor)}>{saving ? "Opening Lamp…" : "Looks right, open Lamp"}</Button>
        <p>Your public page publishes as soon as you open Lamp.</p>
      </div>
    </> : null}
  </div></LitPage>;
}
