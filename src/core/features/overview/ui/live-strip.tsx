import { Link } from "@tanstack/react-router";

import type { LiveStatus } from "../live-status";
import { relativeTime } from "../../../app/client/ui/relative-time";

/** Setup, reduced to one line: the page is live, published and checked. A failing check turns it amber with
 * its reason and the one thing to do; nothing here asks the owner to run a check. */
export function LiveStrip({ live }: { live: LiveStatus }) {
  const host = new URL(live.publicOrigin).host;
  const address = <a className="live-address" href={`${live.publicOrigin}/`} target="_blank" rel="noopener">{host}</a>;
  const problems = [live.page, live.subscribe].flatMap((check) => check && !check.ok && check.reason ? [check.reason] : []);
  if (live.sender.state === "failed" && live.sender.message) problems.push(`Mail sender: ${live.sender.message}`);
  if (!live.publishedAt) return <section className="live-strip" aria-label="Your public page"><span className="live-dot is-pending" />Publishing {address}…</section>;
  const checkedAt = live.page?.checkedAt;
  return <section className={`live-strip${problems.length ? " is-failing" : ""}`} aria-label="Your public page">
    <p><span className={`live-dot${problems.length ? " is-failing" : ""}`} />Live at {address}<span className="live-sep">·</span>published {relativeTime(live.publishedAt)}{checkedAt && !problems.length ? <><span className="live-sep">·</span>page and subscribe form checked {relativeTime(checkedAt)}</> : null}<span className="live-sep">·</span><Link className="live-link" to="/app/page">Review page</Link><span className="live-sep">·</span><Link className="live-link" to="/app/settings">Change address</Link></p>
    {problems.map((problem) => <p key={problem} className="live-problem" role="status">{problem}</p>)}
  </section>;
}
