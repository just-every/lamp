import { useAppData } from "../../../app/client/ui/api";

type PublicStatus = {
  overall: string;
  incident: { lifecycle: string; message: string } | null;
  maintenance: { reference: string; title: string; state: string } | null;
};

/** Preview the selected appearance using the page's published status. */
export function EmbedPreview({ variant, background, color, hideOperational }: {
  variant: "banner" | "floating" | "dot"; background: string; color: string; hideOperational: boolean;
}) {
  const { data, loading, error } = useAppData<PublicStatus>("/api/app/page-settings/embed-preview");
  const incident = data?.incident?.lifecycle !== "Resolved" ? data?.incident : null;
  const maintenance = data?.maintenance?.state === "In progress" ? data.maintenance : null;
  const hidden = data && ((hideOperational && data.overall === "Operational") || (variant === "floating" && !incident && !maintenance));
  return <section className="embed-preview" aria-label="Embed preview">
    <p className="card-kicker">Preview</p>
    {error ? <p role="alert">The published status could not be loaded. {error}</p>
      : loading || !data ? <p role="status">Loading your published status…</p>
      : hidden ? <p>This embed is hidden with your page’s current status.</p>
      : <div className={`embed-preview-status embed-preview-${variant}`} style={{ background, color }}>
        <span className={`page-preview-dot state-${data.overall.toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true" />
        <strong>{data.overall}</strong>
        {variant !== "dot" && (incident || maintenance) ? <p>{incident ? incident.message : `${maintenance!.reference}: ${maintenance!.title}\n${maintenance!.state}`}</p> : null}
      </div>}
  </section>;
}
