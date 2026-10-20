import { useState } from "react";

import type { PageSettingsView } from "../service";
import type { WebsiteReadResponse } from "../../website";
import { appApi, useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { isVectorMark, markToPng, readFileAsDataUrl, uploadMark } from "../../../app/client/ui/mark-image";

type WebsiteResponse = { website: { url: string; readAt: string } | null };
const shortUrl = (value: string) => value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/** The page's look: mark, favicon, social image and accent, with the website they came from. */
export function BrandCard({ settings, accentColor, footerCreditEnabled, onAccentChange, onFooterCreditChange, onSettings, busy, setBusy, setStatus }: {
  settings: PageSettingsView; accentColor: string; footerCreditEnabled: boolean;
  onAccentChange: (value: string) => void; onFooterCreditChange: (value: boolean) => void; onSettings: (settings: PageSettingsView) => void;
  busy: boolean; setBusy: (value: boolean) => void; setStatus: (value: string | null) => void;
}) {
  const website = useAppData<WebsiteResponse>("/api/app/website");
  const [logo, setLogo] = useState<File | null>(null);
  const [address, setAddress] = useState("");
  const version = encodeURIComponent(settings.updatedAt);
  const known = website.data?.website ?? null;

  async function run(work: () => Promise<string>) {
    setBusy(true); setStatus(null);
    try { setStatus(await work()); }
    catch (cause) { setStatus(cause instanceof Error ? cause.message : "That did not work. Try again."); }
    finally { setBusy(false); }
  }
  const saveMark = async (source: string, vector: boolean) => onSettings(await uploadMark(await markToPng(source, vector)) as PageSettingsView);

  const uploadLogo = () => run(async () => {
    if (!logo) return "Choose a logo file first.";
    if (logo.type === "image/svg+xml") await saveMark(await readFileAsDataUrl(logo), true);
    else onSettings(await uploadMark(logo) as PageSettingsView);
    setLogo(null);
    return "Logo saved and the public snapshot was rebuilt.";
  });
  const removeLogo = () => run(async () => {
    const body = await appApi<{ settings: PageSettingsView | null }>("/api/app/page-settings/logo", { method: "DELETE" });
    if (!body.settings) throw new Error("The logo could not be removed.");
    onSettings(body.settings);
    return "Logo removed and the public snapshot was rebuilt.";
  });
  const readWebsite = (input: string) => run(async () => {
    const result = await appApi<WebsiteReadResponse>("/api/app/website/read", { method: "POST", body: JSON.stringify({ website: input }) });
    website.refresh();
    if (!result.found) return result.message;
    if (result.found.mark) await saveMark(result.found.mark.dataUrl, isVectorMark(result.found.mark.contentType));
    if (result.found.accentColor) onAccentChange(result.found.accentColor);
    return `Read ${result.found.host}: ${[result.found.mark && "mark saved", result.found.accentColor && "accent filled in; save to publish it"].filter(Boolean).join(", ") || "nothing new to use"}.`;
  });

  return <section className="data-card brand-card" aria-labelledby="brand-title">
    <p className="card-kicker" id="brand-title">Brand</p>
    <div className="brand-marks">
      <figure><img className="brand-mark-large" src={settings.logoKey ? `/api/app/page-settings/brand/logo?v=${version}` : `/api/app/page-settings/brand/mark?v=${version}`} alt="Page mark" /></figure>
      <figure><figcaption>Favicon</figcaption><img className="brand-favicon" src={`/api/app/page-settings/brand/favicon?v=${version}`} alt="" /></figure>
      <figure><figcaption>Social image</figcaption><img className="brand-social" src={`/api/app/page-settings/brand/social?v=${version}`} alt="" /></figure>
    </div>
    <label className="form-label">Accent colour<span className="colour-field"><input type="color" className="colour-picker" aria-label="Pick accent colour" value={/^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor : "#000000"} onChange={(event) => onAccentChange(event.target.value.toUpperCase())} /><input required pattern="#[0-9A-Fa-f]{6}" value={accentColor} onChange={(event) => onAccentChange(event.target.value)} /></span></label>
    {known ? <div className="brand-website"><span>Read from {shortUrl(known.url)} on {new Date(known.readAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><Button type="button" variant="secondary" disabled={busy} onClick={() => readWebsite(known.url)}>Read website again</Button></div>
      : <div className="brand-website"><label className="form-label">Website<input type="text" inputMode="url" placeholder="example.com" value={address} onChange={(event) => setAddress(event.target.value)} /></label><Button type="button" variant="secondary" disabled={busy || !address.trim()} onClick={() => readWebsite(address)}>Read website</Button></div>}
    <details className="brand-upload">
      <summary>Upload a different logo</summary>
      <label className="form-label">Logo file<input type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" onChange={(event) => setLogo(event.target.files?.[0] ?? null)} /><small>SVG, PNG, JPEG or WebP. Favicon and social image are made from it.</small></label>
      <div className="form-actions"><Button variant="secondary" type="button" onClick={removeLogo} disabled={busy || !settings.logoKey}>Remove logo</Button><Button type="button" onClick={uploadLogo} disabled={busy || !logo}>{busy ? "Saving…" : "Upload logo"}</Button></div>
    </details>
    <label className="checkbox-label"><input type="checkbox" checked={footerCreditEnabled} onChange={(event) => onFooterCreditChange(event.target.checked)} />Show the Powered by Lamp footer credit</label>
  </section>;
}
