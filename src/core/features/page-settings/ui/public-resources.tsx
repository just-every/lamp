import { useState } from "react";

import { CopyBlock } from "../../../app/client/ui/copy-button";
import { EmbedPreview } from "./embed-preview";

type Variant = "banner" | "floating" | "dot";
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function PublicResources({ publicOrigin, allowedOrigins, onOriginsChange }: { publicOrigin: string; allowedOrigins: string[]; onOriginsChange: (origins: string[]) => void }) {
  const [variant, setVariant] = useState<Variant>("banner");
  const [position, setPosition] = useState("bottom-right");
  const [background, setBackground] = useState("#ffffff");
  const [color, setColor] = useState("#182d24");
  const [hideOperational, setHideOperational] = useState(false);
  const [originsText, setOriginsText] = useState(allowedOrigins.join("\n"));
  const origin = publicOrigin;
  const snippet = `<script defer src="${escapeAttribute(origin)}/widget.js" data-variant="${variant}"${variant === "floating" ? ` data-position="${position}"` : ""} data-background="${escapeAttribute(background)}" data-color="${escapeAttribute(color)}" data-hide-operational="${hideOperational}"></script>`;

  return <section className="data-card" aria-labelledby="public-resources-title">
    <h2 id="public-resources-title">Share your status</h2>
    <p>Use your public status in your website, product or feed reader.</p>
    <div className="settings-grid">
      <label className="form-label">Embed style<select value={variant} onChange={(event) => setVariant(event.target.value as Variant)}>
        <option value="banner">Banner</option><option value="floating">Floating notice</option><option value="dot">Status dot</option>
      </select><small>{variant === "banner" ? "Overall status and the current incident, placed beside the script tag." : variant === "floating" ? "A corner notice while an incident is unresolved or maintenance is in progress." : "A compact status dot and label for your header or footer."}</small></label>
      {variant === "floating" && <label className="form-label">Position<select value={position} onChange={(event) => setPosition(event.target.value)}>
        <option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option>
      </select></label>}
      <label className="form-label">Background colour<span className="colour-field"><input className="colour-picker" type="color" aria-label="Pick background colour" value={/^#[0-9a-f]{6}$/i.test(background) ? background : "#ffffff"} onChange={(event) => setBackground(event.target.value)} /><input aria-label="Background colour" required pattern="#[0-9A-Fa-f]{6}" value={background} onChange={(event) => setBackground(event.target.value)} /></span></label>
      <label className="form-label">Text colour<span className="colour-field"><input className="colour-picker" type="color" aria-label="Pick text colour" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#182d24"} onChange={(event) => setColor(event.target.value)} /><input aria-label="Text colour" required pattern="#[0-9A-Fa-f]{6}" value={color} onChange={(event) => setColor(event.target.value)} /></span></label>
      <label className="checkbox-label full-width"><input type="checkbox" checked={hideOperational} onChange={(event) => setHideOperational(event.target.checked)} />Hide when everything is operational</label>
    </div>
    <EmbedPreview variant={variant} background={background} color={color} hideOperational={hideOperational} />
    <label className="form-label">Allowed websites<textarea value={originsText} placeholder="https://app.example.com" onChange={(event) => { setOriginsText(event.target.value); onOriginsChange(event.target.value.split("\n").map((value) => value.trim()).filter(Boolean)); }} /><small>One full address per line, such as https://app.example.com. Save settings to allow the embed on these websites.</small></label>
    <p>Copy this tag into an allowed website where the embed should appear.</p>
    <CopyBlock text={snippet} label="Copy embed tag" />
    <small className="field-note">The embed refreshes every 30 seconds. Your choices are carried in the tag; paste a new tag to change them.</small>
    <ul>
      <li><a href={`${origin}/api/v2/summary.json`} target="_blank" rel="noopener">Status JSON (Statuspage-compatible)</a> · <a href="/docs/public-resources">API docs</a></li>
      <li><a href={`${origin}/feed.atom`} target="_blank" rel="noopener">Atom feed</a> · <a href={`${origin}/feed.rss`} target="_blank" rel="noopener">RSS feed</a></li>
      <li><a href={`${origin}/badge.svg`} target="_blank" rel="noopener">Status badge</a></li>
    </ul>
  </section>;
}
