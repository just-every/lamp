import { useState } from "react";

import { CopyBlock } from "../../../app/client/ui/copy-button";

type Variant = "banner" | "floating" | "dot";
const escapeAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function PublicResources({ publicOrigin }: { publicOrigin: string }) {
  const [variant, setVariant] = useState<Variant>("banner");
  const [position, setPosition] = useState("bottom-right");
  const [background, setBackground] = useState("#ffffff");
  const [color, setColor] = useState("#182d24");
  const [hideOperational, setHideOperational] = useState(false);
  const origin = publicOrigin;
  const snippet = `<script defer src="${escapeAttribute(origin)}/widget.js" data-variant="${variant}"${variant === "floating" ? ` data-position="${position}"` : ""} data-background="${background}" data-color="${color}" data-hide-operational="${hideOperational}"></script>`;

  return <section className="data-card" aria-labelledby="public-resources-title">
    <p className="card-kicker">Share your status</p>
    <h2 id="public-resources-title">Public resources and embeds</h2>
    <p>Use your public status in your website, product or feed reader.</p>
    <ul>
      <li><a href={`${origin}/api/v2/summary.json`} target="_blank" rel="noopener">Statuspage summary JSON</a> · <a href={`${origin}/api/public/v1/`} target="_blank" rel="noopener">Native public API</a> · <a href={`${origin}/api/public/status`} target="_blank" rel="noopener">Public status JSON</a></li>
      <li><a href={`${origin}/feed.atom`} target="_blank" rel="noopener">Atom feed</a> · <a href={`${origin}/feed.rss`} target="_blank" rel="noopener">RSS feed</a></li>
      <li><a href={`${origin}/badge.svg`} target="_blank" rel="noopener">Status badge</a></li>
    </ul>
    <div className="settings-grid">
      <label className="form-label">Embed style<select value={variant} onChange={(event) => setVariant(event.target.value as Variant)}>
        <option value="banner">Banner</option><option value="floating">Floating notice</option><option value="dot">Status dot</option>
      </select><small>{variant === "banner" ? "Overall status and the current incident, placed beside the script tag." : variant === "floating" ? "A corner notice while an incident is unresolved or maintenance is in progress." : "A compact status dot and label for your header or footer."}</small></label>
      {variant === "floating" && <label className="form-label">Position<select value={position} onChange={(event) => setPosition(event.target.value)}>
        <option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option>
      </select></label>}
      <label className="form-label">Background colour<input type="color" value={background} onChange={(event) => setBackground(event.target.value)} /></label>
      <label className="form-label">Text colour<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <label className="checkbox-label full-width"><input type="checkbox" checked={hideOperational} onChange={(event) => setHideOperational(event.target.checked)} />Hide when everything is operational</label>
    </div>
    <p>Add the full origin of the website that will show the embed to <strong>Widget host origins</strong> above and save settings. Copy this tag into that website where the embed should appear.</p>
    <CopyBlock text={snippet} label="Copy embed tag" />
    <small className="field-note">The embed refreshes every 30 seconds. Your choices are carried in the tag; paste a new tag to change them.</small>
  </section>;
}
