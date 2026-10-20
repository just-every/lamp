import { Link } from "@tanstack/react-router";

import type { OverviewService } from "../service";
import type { PageSettingsService } from "../../page-settings/service";
import { PagePreview } from "../../page-settings/ui/page-preview";
import { useAppData } from "../../../app/client/ui/api";
import { Button } from "../../../app/client/ui/button";
import { Icon } from "../../../app/client/ui/icon";
import { ErrorState } from "../../../app/client/ui/lit-states";
import { LoadingState } from "../../../app/client/ui/states";
import { relativeTime } from "../../../app/client/ui/relative-time";

type OverviewResponse = { overview: Awaited<ReturnType<OverviewService["get"]>> };
type SettingsResponse = { settings: Awaited<ReturnType<PageSettingsService["get"]>> };

function Fact({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return <li className={`checked-fact${ok === false ? " is-failing" : ok === null ? " is-pending" : ""}`}><span className="checked-icon"><Icon name={ok === false ? "warning" : ok === null ? "clock" : "check"} width={16} height={16} /></span><span><strong>{label}</strong><small>{detail}</small></span></li>;
}

/** Where the owner reviews the page customers see: Lamp's drawing of it, the real one a click away, and
 * what Lamp checked on its own. */
export function YourPage() {
  const overview = useAppData<OverviewResponse>("/api/app/overview");
  const settings = useAppData<SettingsResponse>("/api/app/page-settings");
  if ((overview.loading && !overview.data) || (settings.loading && !settings.data)) return <LoadingState />;
  if (overview.error || settings.error || !overview.data || !settings.data?.settings) return <ErrorState onRetry={() => window.location.reload()}>{overview.error ?? settings.error ?? "Your page could not be loaded."}</ErrorState>;
  const { live, components } = overview.data.overview;
  const page = settings.data.settings;
  const origin = live.publicOrigin;
  const host = new URL(origin).host;
  const visible = components.filter((component) => !component.internal);
  return <div className="page-stack your-page">
    <section className="page-title-row">
      <div><p className="eyebrow">Public page</p><h1>Your page</h1><p>This is what your customers see at <a className="quiet-link" href={`${origin}/`} target="_blank" rel="noopener">{host}</a>.</p></div>
      <div className="your-page-actions"><Button asChild variant="secondary"><Link to="/app/settings">Edit look</Link></Button><Button asChild><a href={`${origin}/`} target="_blank" rel="noopener">Open in a new tab <Icon name="external" width={16} height={16} /></a></Button></div>
    </section>
    <div className="your-page-grid">
      <div className="data-card your-page-preview">
        <PagePreview size="large" pageName={page.pageName} accentColor={page.accentColor} markSrc={`/api/app/page-settings/brand/mark?v=${encodeURIComponent(live.publishedAt ?? "")}`} components={visible.map((component) => ({ name: component.name, state: component.publicState }))} address={host} />
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
    </div>
  </div>;
}
