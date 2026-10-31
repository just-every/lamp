import type { LiveStatus } from "../../overview/live-status";
import { Icon } from "../../../app/client/ui/icon";
import { useRelativeTime } from "../../../app/client/ui/relative-time";

const isLocal = (origin: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);

/** The page itself: its mark, where it lives and that it is live. Lamp's drawing of it sits above, in YourPageFacts. */
export function PageHero({ live, markSrc }: { live: LiveStatus | null; markSrc: string }) {
  const relativeTime = useRelativeTime();
  const origin = live?.publicOrigin ?? null;
  const problem = live && [live.page, live.subscribe].find((check) => check && !check.ok)?.reason;
  return <section className="data-card page-hero" id="public-address" aria-labelledby="page-hero-address">
    <img className="page-hero-mark" src={markSrc} alt="" width={84} height={84} />
    <div className="page-hero-facts">
      <p className="card-kicker">Your status page</p>
      {origin ? <a id="page-hero-address" className="page-hero-address" href={`${origin}/`} target="_blank" rel="noopener">{new URL(origin).host}<Icon name="external" width={18} height={18} /></a> : <p id="page-hero-address" className="page-hero-address">Loading address…</p>}
      <p className={`page-hero-live${problem ? " is-failing" : ""}`}><span className="live-dot" />{problem ?? (live?.publishedAt ? `Live · last published ${relativeTime(live.publishedAt)}. Changes publish automatically.` : "Publishing…")}</p>
      {origin && isLocal(origin) ? <p className="page-hero-note">This address works only on this computer. <a className="text-link" href="/docs/deploy">Deploy Lamp</a> to give customers a public one.</p> : null}
      <a className="text-link" href="/docs/domains">Use a custom domain</a>
    </div>
  </section>;
}
