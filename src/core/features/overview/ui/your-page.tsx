import { Link } from "@tanstack/react-router";

import type { LiveStatus } from "../live-status";
import { PagePreview, type PreviewComponent } from "../../page-settings/ui/page-preview";
import { Icon } from "../../../app/client/ui/icon";
import { useRelativeTime } from "../../../app/client/ui/relative-time";

function Fact({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return <li className={`checked-fact${ok === false ? " is-failing" : ok === null ? " is-pending" : ""}`}><span className="checked-icon"><Icon name={ok === false ? "warning" : ok === null ? "clock" : "check"} width={16} height={16} /></span><span><strong>{label}</strong><small>{detail}</small></span></li>;
}

/** The page customers see, at the top of Settings › Page: Lamp's drawing of it, what Lamp checked on its own, and ways
 * to try the real one. */
export function YourPageFacts({ live, pageName, accentColor, components }: { live: LiveStatus; pageName: string; accentColor: string; components: PreviewComponent[] }) {
  const relativeTime = useRelativeTime();
  const origin = live.publicOrigin;
  const host = new URL(origin).host;
  return <div className="your-page-grid">
    <div className="data-card your-page-preview">
      <PagePreview size="large" pageName={pageName} accentColor={accentColor} markSrc={`/api/app/page-settings/brand/mark?v=${encodeURIComponent(live.publishedAt ?? "")}`} components={components} address={host} />
    </div>
    <aside className="your-page-side">
      <section className="data-card" aria-labelledby="checked-title">
        <p className="card-kicker" id="checked-title">What Lamp checked</p>
        <ul className="checked-list">
          <Fact ok={live.publishedAt ? true : null} label="Page published" detail={live.publishedAt ? relativeTime(live.publishedAt) : "Publishing now"} />
          <Fact ok={live.page ? live.page.ok : null} label="Address answering" detail={live.page?.reason ?? host} />
          <Fact ok={live.subscribe ? live.subscribe.ok : null} label="Subscribe form working" detail={live.subscribe?.reason ?? (live.subscribe ? `checked ${relativeTime(live.subscribe.checkedAt)}` : "Checking soon")} />
          {live.sender.state === "local" ? null : <Fact ok={live.sender.state === "verified" ? true : live.sender.state === "failed" ? false : null} label="Mail sender" detail={live.sender.message ?? (live.sender.state === "verified" ? "Verified by your mail provider" : "Checking soon")} />}
        </ul>
        <p className="checked-note">Lamp checks these every minute and says so here if one stops working.</p>
      </section>
      <section className="data-card" aria-labelledby="try-title">
        <p className="card-kicker" id="try-title">Try it yourself</p>
        <ul className="try-list">
          <li><a className="text-link" href={`${origin}/#subscribe`} target="_blank" rel="noopener">Subscribe with your email <Icon name="external" width={15} height={15} /></a></li>
          <li><a className="text-link" href={`${origin}/history`} target="_blank" rel="noopener">View history <Icon name="external" width={15} height={15} /></a></li>
          <li><Link className="text-link" to="/app/settings" hash="embeds">Feeds, badge and embeds <Icon name="arrow" width={15} height={15} /></Link></li>
        </ul>
      </section>
    </aside>
  </div>;
}
