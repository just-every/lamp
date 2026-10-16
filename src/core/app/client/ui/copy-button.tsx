import { useState } from "react";

import { Button } from "./button";

/** Copies exact setup text; when the browser refuses, the text stays selectable beside it. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState("copied"); }
    catch { setState("failed"); }
  }
  return <Button type="button" variant="secondary" className="copy-button" onClick={() => void copy()} aria-live="polite">
    {state === "copied" ? "Copied" : state === "failed" ? "Select and copy the text" : label}
  </Button>;
}

/** A block of text to paste somewhere else, with its copy button. */
export function CopyBlock({ text, label }: { text: string; label?: string }) {
  return <div className="copy-block"><pre><code>{text}</code></pre><CopyButton text={text} label={label} /></div>;
}
