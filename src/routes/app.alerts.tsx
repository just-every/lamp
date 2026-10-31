import { createFileRoute, redirect } from "@tanstack/react-router";

// Alerts is Settings › Connected tools now (L19). Old links land there for one release, keeping a linked receipt.
export const Route = createFileRoute("/app/alerts")({
  beforeLoad: ({ location }) => { throw redirect({ href: `/app/settings${location.searchStr}#tools` }); },
});
