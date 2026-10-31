import { Link } from "@tanstack/react-router";

/** Subscribers and the log of what was sent to them: two views of one section, each at its own address so Back works. */
export function SubscribersViews() {
  return <nav className="view-switch" aria-label="Subscribers views">
    <Link to="/app/subscribers" search={{}} activeOptions={{ exact: true }}>Subscribers</Link>
    <Link to="/app/subscribers" search={{ view: "log" }} activeOptions={{ exact: true }}>Delivery log</Link>
  </nav>;
}
