import { useState, type FormEvent } from "react";

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
import { foundLayout } from "./found-components";
import { bringHistory } from "./bring-history";
import { useSetupDraft } from "./setup-draft";
import { acceptedZone } from "./time-zone";

type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };

/** The owner's first run: their website first; Lamp fills in what the site gives, the owner checks it,
 * and opening Lamp stores it all. Nothing here is required beyond confirming. */
export function FirstRunPage({ publicPageOrigin, ownerId }: { publicPageOrigin: string; ownerId: string }) {
  const { data, error, loading } = useAppData<SettingsResponse>("/api/app/page-settings");
  const { draft, setDraft, ready, storageError, clear } = useSetupDraft(ownerId);
  const { website, found, review } = draft;
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<"publishing" | "history" | "checking" | "opening" | null>(null);
  const saving = progress !== null;
  if ((loading && !data) || !ready) return <LoadingState />;
  if (error || !data?.settings) return <ErrorState onRetry={() => window.location.reload()}>{error ?? "Your page settings could not be loaded."}</ErrorState>;
  const settings = data.settings;
  const plain = (): FoundPage => ({ pageName: settings.pageName, tagline: settings.tagline, accentColor: settings.accentColor.toUpperCase(), mark: null, components: [], groups: [], statusPage: null, existing: null, history: false });
  const address = new URL(publicPageOrigin).host;

  async function read(event: FormEvent) {
    event.preventDefault();
    setReading(true);
    const result = await appApi<WebsiteReadResponse>("/api/app/website/read", { method: "POST", body: JSON.stringify({ website }) })
      .catch((cause: unknown) => ({ found: null, message: cause instanceof Error ? cause.message : "We couldn't read that website." }) as WebsiteReadResponse);
    const base = plain();
    setReading(false);
    if (!result.found) {
      setDraft({ website, found: { ...base, pageName: result.pageName ?? base.pageName }, review: { kind: "failed", note: result.message } });
      return;
    }
    const site = result.found;
    // The business's own status page lists its real components: they take the place of the navigation's.
    const page = site.existingPage;
    const components = page
      ? { components: page.components.filter((component) => !component.groupId).map((component) => component.name), groups: page.groups.map((group) => ({ id: group.id, name: group.name, components: page.components.filter((component) => component.groupId === group.id).map((component) => component.name) })),
        existing: { url: page.url, host: page.host, source: page.source, pastIncidents: page.pastIncidents, components: page.components.map((component) => ({ id: component.id, name: component.name, groupId: component.groupId })) } }
      : { components: site.components.map((component) => component.name), groups: [], existing: null };
    setDraft({ website, found: { ...base, pageName: site.pageName, tagline: site.tagline ?? base.tagline, accentColor: site.accentColor ?? base.accentColor, mark: site.mark ? { src: site.mark.dataUrl, vector: isVectorMark(site.mark.contentType), from: site.mark.url } : null, ...components, history: false, statusPage: site.statusPage }, review: { kind: "read", note: `We read ${site.host}. Change anything now or later in Settings.` } });
  }

  function skip() {
    setDraft({ website: "", found: plain(), review: { kind: "skipped", note: "Fill in your page below, or change it later in Settings." } });
  }

  async function finish() {
    if (!found) return;
    setProgress("publishing"); setMessage(null);
    try {
      const { pageName, tagline, accentColor } = found;
      // Setup does not ask for the time zone: the page takes this browser's, and Settings → Page changes it.
      const timezone = acceptedZone(Intl.DateTimeFormat().resolvedOptions().timeZone, settings.timezone);
      const { hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength } = settings;
      const next: Required<PageSettingsInput> = { template: settings.template, widgetAppearance: settings.widgetAppearance, pageName: pageName.trim(), tagline: tagline.trim(), accentColor, timezone, hostname, footerCreditEnabled, widgetAllowedOrigins, mailFromAddress, emailBranding, aiToneInstructions, wordingBlockedTerms, wordingFriendlyLength };
      await appApi<SettingsResponse>("/api/app/page-settings", { method: "PUT", body: JSON.stringify(next) });
      if (found.mark) {
        // The page still opens with a letter mark if this browser cannot draw the file.
        const png = await markToPng(found.mark.src, found.mark.vector).catch(() => null);
        if (png) await uploadMark(png);
      }
      if (found.existing && found.history) {
        setProgress("history");
        await bringHistory(found, found.existing);
      }
      // Whatever the history brought already stands; first run adds the rest.
      await appApi("/api/app/overview/first-run", { method: "POST", body: JSON.stringify(foundLayout(found)) });
      setProgress("checking");
      await appApi("/api/app/overview/live");
      setProgress("opening");
      clear();
      window.location.assign("/app");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Your page could not be saved.");
      setProgress(null);
    }
  }

  return <LitPage><div className="first-run-page">
    <p className="eyebrow">Welcome</p>
    <h1>Your status page, from your website</h1>
    <form className="website-form" onSubmit={read}>
      <label className="form-label" htmlFor="first-run-website">Website</label>
      <div className="website-field">
        <input id="first-run-website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="example.com" required value={website} onChange={(event) => setDraft((current) => ({ ...current, website: event.target.value }))} disabled={reading || saving} aria-invalid={review?.kind === "failed" || undefined} aria-describedby={review ? "website-result" : undefined} />
        <Button type="submit" variant={review ? "secondary" : "primary"} disabled={reading || saving || !website.trim()}>{reading ? "Reading…" : review?.kind === "failed" ? "Try again" : review?.kind === "read" ? "Read again" : "Read website"}</Button>
      </div>
      {review ? <p id="website-result" className={`website-note${review.kind === "failed" ? " website-warning" : ""}`} role={review.kind === "failed" ? "alert" : "status"}>{review.note}</p> : <button type="button" className="website-skip" onClick={skip} disabled={reading}>Skip, I'll fill it in</button>}
    </form>
    {storageError && <p className="website-note website-warning" role="alert">{storageError}</p>}
    {review && found ? <>
      <fieldset className="first-run-details" aria-label="Your page details" disabled={saving || reading}><FoundCard page={found} address={address} onChange={(next) => setDraft((current) => ({ ...current, found: current.found ? { ...current.found, ...next } : null }))} /></fieldset>
      {message && <p className="save-message" role="alert">{message}</p>}
      <div className="first-run-finish">
        <Button type="button" onClick={finish} disabled={saving || reading || !found.pageName.trim() || !found.tagline.trim() || !/^#[0-9a-f]{6}$/i.test(found.accentColor)}>{saving ? "Opening Lamp…" : review.kind === "read" ? "Looks right, open Lamp" : "Open Lamp"}</Button>
        {progress ? <ol className="first-run-progress" role="status" aria-label="Opening your page"><li>{progress === "publishing" ? "Publishing your page…" : "Page published"}</li>{found.existing && found.history ? <li>{progress === "publishing" ? "Then bringing in its incident history" : progress === "history" ? "Bringing in its incident history…" : "Incident history brought in"}</li> : null}<li>{progress === "publishing" || progress === "history" ? "Then checking the subscribe form" : progress === "checking" ? "Checking the subscribe form…" : "Opening your workspace…"}</li></ol> : null}
      </div>
    </> : null}
  </div></LitPage>;
}
