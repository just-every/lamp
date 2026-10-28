import { useRef, useState } from "react";
import { Button } from "../../../app/client/ui/button";
import type { PageSettingsView } from "../service";

export function ThemeAsset({ kind, present, busy, setBusy, onSettings }: {
  kind: "font" | "header"; present: boolean; busy: boolean; setBusy: (busy: boolean) => void;
  onSettings: (settings: PageSettingsView, asset: "font" | "header") => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const name = kind === "font" ? "font" : "header image";

  async function change(remove: boolean) {
    if (!remove && !file) return;
    setBusy(true); setMessage(null); setFailed(false);
    try {
      const body = new FormData();
      if (file) body.set("file", file);
      // The browser supplies the multipart boundary. appApi currently forces JSON
      // for request bodies, so use the same upload door as the page logo.
      const response = await fetch(`/api/app/page-settings/theme-assets/${kind}`, {
        method: remove ? "DELETE" : "POST", headers: { Accept: "application/json" },
        ...(remove ? {} : { body }),
      });
      const result = await response.json().catch(() => null) as { settings?: PageSettingsView; error?: string } | null;
      if (!response.ok || !result?.settings) throw new Error(result?.error ?? `The ${name} could not be ${remove ? "removed" : "uploaded"}.`);
      // A previous autosave can finish while the snapshot is being rebuilt.
      // The successful asset action still selects its own font or image; enqueue
      // that selection after the older save instead of adopting its stale flag.
      const selection = kind === "font"
        ? { font: remove ? "default" as const : "uploaded" as const }
        : { headerImage: !remove };
      onSettings({ ...result.settings, theme: { ...result.settings.theme, ...selection } }, kind);
      setFile(null);
      if (input.current) input.current.value = "";
      setMessage(`${kind === "font" ? "Font" : "Header image"} ${remove ? "removed" : "uploaded"}.`);
    } catch (cause) {
      setFailed(true);
      setMessage(cause instanceof Error ? cause.message : `The ${name} could not be saved. Try again.`);
    } finally { setBusy(false); }
  }

  return <div className="page-stack">
    <label className="form-label">{kind === "font" ? "Upload font" : "Upload header image"}
      <input ref={input} type="file" disabled={busy} accept={kind === "font" ? ".woff2,font/woff2" : "image/png,image/jpeg,image/webp"} onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <small>{kind === "font" ? "WOFF2, served from your page’s own address." : "PNG, JPEG or WebP, served from your page’s own address."}</small>
    </label>
    <div className="form-actions">
      <Button type="button" variant="secondary" disabled={busy || !present} onClick={() => void change(true)}>Remove {name}</Button>
      <Button type="button" disabled={busy || !file} onClick={() => void change(false)}>Upload {name}</Button>
    </div>
    {message && <p className="save-message" role={failed ? "alert" : "status"}>{message}</p>}
  </div>;
}
