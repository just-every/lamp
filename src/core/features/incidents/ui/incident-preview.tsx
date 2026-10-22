import { useState, type Ref } from "react";

import type { RenderedIncidentUpdate } from "../renderer";
import { FormError, LoadingState } from "../../../app/client/ui/states";
import { PreviewCard } from "./incident-composer-tools";

/** UPDATE-004: the draft as the public page and as the notification email render it, one view at a time. */
export function IncidentPreview({ preview, error, headingRef }: { preview: RenderedIncidentUpdate | null; error: string | null; headingRef?: Ref<HTMLHeadingElement> }) {
  const [view, setView] = useState<"page" | "email">("page");
  return <aside className="preview-panel" aria-labelledby="preview-title">
    <div className="preview-heading">
      <h2 id="preview-title" className="eyebrow" ref={headingRef}>Preview</h2>
      <div className="preview-switch" role="group" aria-label="Preview as">
        <button type="button" aria-pressed={view === "page"} onClick={() => setView("page")}>Page</button>
        <button type="button" aria-pressed={view === "email"} onClick={() => setView("email")}>Email</button>
      </div>
    </div>
    {error ? <FormError>{error}</FormError> : !preview ? <LoadingState>Rendering this draft…</LoadingState> : view === "page"
      ? <PreviewCard title="Public page" heading={preview.public.heading} lifecycle={preview.public.lifecycle} fields={preview.public.fields} />
      : <PreviewCard title="Notification email" heading={preview.email.subject} lifecycle={null} logoUrl={preview.email.logoUrl} logoAlt={preview.email.logoAlt} fields={[...(preview.email.from ? [{ label: "From", value: preview.email.from }] : []), ...(preview.email.replyTo ? [{ label: "Reply-To", value: preview.email.replyTo }] : []), ...preview.email.plainText.split("\n\n").slice(1).map(value => ({ label: "Message", value }))]} />}
  </aside>;
}
