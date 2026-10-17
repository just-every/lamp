import { useState } from "react";

export function useCsvDownload() {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const download = async (path: string, filename: string) => {
    setDownloading(true); setError(null);
    try {
      const response = await fetch(path, { headers: { Accept: "text/csv" } });
      if (!response.ok) { const body = await response.json().catch(() => null) as { error?: string } | null; throw new Error(body?.error ?? `CSV download returned ${response.status}.`); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "CSV could not be downloaded."); }
    finally { setDownloading(false); }
  };
  return { download, error, downloading };
}
