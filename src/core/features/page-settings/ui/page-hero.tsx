import type { LiveStatus } from "../../overview/live-status";
import { Icon } from "../../../app/client/ui/icon";
import { relativeTime } from "../../../app/client/ui/relative-time";
import { PagePreview, type PreviewComponent } from "./page-preview";

const isLocal = (origin: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);

/** Settings opens on the page itself: its mark, where it lives, that it is live, and a small preview. */
export function PageHero({ live, pageName, accentColor, markSrc, components }: { live: LiveStatus | null; pageName: string; accentColor: string; markSrc: string; components: PreviewComponent[] }) {
  const origin = live?.publicOrigin ?? null;
  const problem = live && [live.page, live.subscribe].find((check) => check && !check.ok)?.reason;
  return <section className="data-card page-hero" id="public-address" aria-labelledby="page-hero-address">
    <img className="page-hero-mark" src={markSrc} alt="" width={84} height={84} />
    <div className="page-hero-facts">
      <p className="card-kicker">Your status page</p>
      {origin ? <a id="page-hero-address" className="page-hero-address" href={`${origin}/`} target="_blank" rel="noopener">{new URL(origin).host}<Icon name="external" width={18} height={18} /></a> : <p id="page-hero-address" className="page-hero-address">Loading address…</p>}
      <p className={`page-hero-live${problem ? " is-failing" : ""}`}><span className="live-dot" />{problem ?? (live?.publishedAt ? `Live · published automatically after every change, last ${relativeTime(live.publishedAt)}` : "Publishing…")}</p>
      {origin && isLocal(origin) ? <p className="page-hero-note">This address works only on this computer. Deploy Lamp to give customers a public one.</p> : null}
      <a className="text-link" href="https://github.com/just-every/run-lamp/blob/main/README.md#your-own-domain" target="_blank" rel="noreferrer">Use a custom domain</a>
    </div>
    <div className="page-hero-preview" aria-hidden="true"><PagePreview pageName={pageName} accentColor={accentColor} markSrc={markSrc} components={components.slice(0, 3)} address={null} /></div>
  </section>;
}
